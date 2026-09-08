// The look, finished in post (PLAN decision 12: one visual identity, graded).
//
// PERFORMANCE.md said "no post-processing until the budget is met with
// headroom". It is met — 3.5-5 ms of a 12 ms contract at 2560×1440 (M40) — so
// this is that headroom spent on the three things a flat-lit low-poly island
// is most obviously missing:
//
//  · BLOOM, on a high threshold, so the fires, the beacon and the sun bleed
//    light and nothing else does.
//  · ATMOSPHERE — height fog that pools in the hollows, thins as you climb and
//    glows toward the sun, reconstructed from the depth the scene already
//    wrote. No second geometry pass, which is the rule the AO broke.
//  · A GRADE — a warm-shadow / cool-highlight split, a little saturation, and
//    a vignette — that runs on a curve with the time of day, so noon, dusk and
//    a moonlit night are one family rather than three exposures.
//
// AMBIENT OCCLUSION WAS BUILT, MEASURED AND CUT. GTAO looked right — real
// contact under the rocks and the canopy — and cost 5 ms at half resolution
// and still 7-10 at quarter, because its price is not the AO maths but the
// SECOND SCENE RENDER it does for normals: 350 draw calls and 3 Mtri again,
// which no resolution change touches. Against a 12 ms contract that is the
// whole budget for an effect you have to look for. If it comes back it has to
// read the depth buffer the main pass already wrote (a custom 8-tap pass) and
// never render geometry twice.
//
// Every layer is switchable and measured on its own (`tools/qa-post.mjs`,
// `settings.ts`), because a pass you cannot turn off is a pass you cannot
// budget.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'

export type PostQuality = 'off' | 'basic' | 'full'

/** The grade, applied after tone mapping in display space: lift the shadows
 *  toward the sky's colour, push the highlights toward the sun's, then a gentle
 *  vignette. Cheap — one texture fetch and a dozen instructions. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    shadowTint: { value: new THREE.Color(0.42, 0.5, 0.62) },
    highlightTint: { value: new THREE.Color(1.0, 0.95, 0.86) },
    strength: { value: 0.18 },
    saturation: { value: 1.06 },
    vignette: { value: 0.22 },
    lift: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;
    uniform float strength;
    uniform float saturation;
    uniform float vignette;
    uniform float lift;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      float lum = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      // split tone: shadows one way, highlights the other, hinged on luminance
      vec3 tint = mix( shadowTint, highlightTint, smoothstep( 0.15, 0.75, lum ) );
      c.rgb = mix( c.rgb, c.rgb * tint * 2.0, strength );
      c.rgb = mix( vec3( lum ), c.rgb, saturation );
      c.rgb += lift * ( 1.0 - lum );            // a little air in the darks
      // vignette: darken the corners, never the middle
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot( d, d ) * 1.6;
      gl_FragColor = vec4( max( c.rgb, 0.0 ), c.a );
    }`,
}

/** Height fog, from the depth buffer. World position is reconstructed per
 *  pixel from depth and the inverse view-projection; the fog thickens with
 *  distance and with how low the ground is, and picks up the sun's colour
 *  where you are looking toward it — the cheap half of aerial perspective, and
 *  the half that reads. */
const AirShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    invViewProj: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    fogColor: { value: new THREE.Color(0.55, 0.66, 0.78) },
    sunColor: { value: new THREE.Color(1, 0.86, 0.62) },
    density: { value: 0.0016 },
    heightFalloff: { value: 0.028 },
    baseHeight: { value: 2.0 },
    maxFog: { value: 0.82 },
    near: { value: 0.6 },
    far: { value: 1600 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 invViewProj;
    uniform vec3 camPos;
    uniform vec3 sunDir;
    uniform vec3 fogColor;
    uniform vec3 sunColor;
    uniform float density;
    uniform float heightFalloff;
    uniform float baseHeight;
    uniform float maxFog;
    uniform float near;
    uniform float far;
    varying vec2 vUv;

    void main() {
      vec4 src = texture2D( tDiffuse, vUv );
      float d = texture2D( tDepth, vUv ).x;
      // the sky (depth 1) keeps its own colour: the fog belongs to the land
      if ( d >= 0.9999 ) { gl_FragColor = src; return; }

      vec4 clip = vec4( vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
      vec4 world = invViewProj * clip;
      vec3 pos = world.xyz / world.w;

      vec3 toPixel = pos - camPos;
      float dist = length( toPixel );
      vec3 dir = toPixel / max( dist, 0.0001 );

      // exponential height fog, integrated along the ray (the standard closed
      // form): thick in the hollows, thin on the ridges
      float hCam = max( camPos.y - baseHeight, -50.0 );
      float hDir = dir.y;
      float fogAmount;
      if ( abs( hDir ) < 0.0001 ) {
        fogAmount = density * dist * exp( -heightFalloff * hCam );
      } else {
        fogAmount = ( density / heightFalloff ) * exp( -heightFalloff * hCam ) * ( 1.0 - exp( -heightFalloff * hDir * dist ) ) / hDir;
      }
      float f = clamp( 1.0 - exp( -max( fogAmount, 0.0 ) ), 0.0, maxFog );

      // looking toward the sun, the haze glows: in-scattering, approximated
      float sunAmount = max( dot( dir, sunDir ), 0.0 );
      vec3 air = mix( fogColor, sunColor, pow( sunAmount, 6.0 ) * 0.65 );

      gl_FragColor = vec4( mix( src.rgb, air, f ), src.a );
    }`,
}

export class Post {
  readonly composer: EffectComposer
  private renderPass: RenderPass
  private bloom: UnrealBloomPass
  private air: ShaderPass
  private grade: ShaderPass
  private fxaa: ShaderPass
  private output: OutputPass
  private quality: PostQuality = 'full'
  private w = 1
  private h = 1

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.w = size.x
    this.h = size.y
    // NO MSAA IN THE COMPOSER. Resolving a 4× half-float target at 3.7 Mpx
    // cost 2.5 ms on its own — more than the grade and bloom together — so the
    // edges are handled by FXAA at the end instead, for about 0.3 (M42 price
    // list, tools/qa-post.mjs). Half-float is kept: bloom needs the HDR.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType })
    // the depth the scene already wrote, kept for the atmosphere pass — no
    // second geometry render, which is the rule GTAO broke (M42)
    target.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType)
    this.composer = new EffectComposer(renderer, target)
    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)

    // AO at half resolution and denoised — full res costs three times as much
    // for a difference you cannot see under a canopy
    // bloom: the threshold is in LINEAR HDR, not display space — at 0.92 the
    // midday sky (5-20 in linear) bloomed as one white sheet and the first
    // screenshot came back unreadable. 2.4 lets fire, the beacon and the sun's
    // own disc through and nothing else (M42)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.65, 2.4)
    this.composer.addPass(this.bloom)

    this.output = new OutputPass()
    this.composer.addPass(this.output)

    // ATMOSPHERE. Height fog that pools in the low ground and thins as you
    // climb, brightening toward the sun — the depth buffer the scene already
    // wrote is all it needs (M43).
    this.air = new ShaderPass(AirShader)
    this.air.material.uniforms.tDepth.value = target.depthTexture
    this.composer.addPass(this.air)

    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.grade)

    // the edges MSAA is no longer smoothing
    this.fxaa = new ShaderPass(FXAAShader)
    this.fxaa.renderToScreen = true
    this.composer.addPass(this.fxaa)
    this.setFxaaSize(size.x, size.y)
  }

  private setFxaaSize(w: number, h: number): void {
    ;(this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / w, 1 / h)
  }

  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.composer.setSize(w, h)
    const dt2 = (this.composer.renderTarget1 as THREE.WebGLRenderTarget).depthTexture
    if (dt2) { dt2.image.width = w; dt2.image.height = h; dt2.needsUpdate = true }
    this.bloom.setSize(w, h)
    this.setFxaaSize(w, h)
  }

  /** QA: drive one layer at a time while tuning (tools/_post.mjs) */
  debugSet(layer: 'bloom' | 'grade', on: boolean): void {
    if (layer === 'bloom') this.bloom.enabled = on
    if (layer === 'grade') this.grade.enabled = on
  }

  /** QA: bloom knobs, for tuning against HDR values rather than guesses */
  tuneBloom(strength: number, radius: number, threshold: number): void {
    this.bloom.strength = strength
    this.bloom.radius = radius
    this.bloom.threshold = threshold
  }

  /** off = the plain renderer path · basic = grade + FXAA · full = + bloom */
  setQuality(q: PostQuality): void {
    this.quality = q
    this.bloom.enabled = q === 'full'
    this.air.enabled = q !== 'off'
    this.grade.enabled = q !== 'off'
    this.fxaa.enabled = q !== 'off'
  }

  get enabled(): boolean {
    return this.quality !== 'off'
  }

  /** Feed the atmosphere pass the camera it is reconstructing from, and the
   *  day's colours. Called once a frame, before render(). */
  air_update(camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, fog: THREE.Color, sun: THREE.Color, nightness: number): void {
    const u = this.air.material.uniforms
    camera.updateMatrixWorld()
    ;(u.invViewProj.value as THREE.Matrix4)
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .invert()
    ;(u.camPos.value as THREE.Vector3).copy(camera.position)
    ;(u.sunDir.value as THREE.Vector3).copy(sunDir).normalize()
    ;(u.fogColor.value as THREE.Color).copy(fog)
    ;(u.sunColor.value as THREE.Color).copy(sun)
    u.near.value = camera.near
    u.far.value = camera.far
    // dawn and night hold more water in the air than midday does
    u.density.value = THREE.MathUtils.lerp(0.0013, 0.0026, nightness)
    u.maxFog.value = THREE.MathUtils.lerp(0.8, 0.62, nightness)
  }

  /** The grade rides the day: warm and open at noon, amber at dusk, cool and
   *  closed at night — one identity, three moods (PLAN decision 12). */
  gradeFor(nightness: number, keyColor: THREE.Color): void {
    const u = this.grade.uniforms
    ;(u.shadowTint.value as THREE.Color).setRGB(
      THREE.MathUtils.lerp(0.44, 0.3, nightness),
      THREE.MathUtils.lerp(0.5, 0.4, nightness),
      THREE.MathUtils.lerp(0.62, 0.72, nightness),
    )
    ;(u.highlightTint.value as THREE.Color).copy(keyColor).lerp(new THREE.Color(1, 1, 1), 0.45)
    u.strength.value = THREE.MathUtils.lerp(0.18, 0.3, nightness)
    u.saturation.value = THREE.MathUtils.lerp(1.07, 0.9, nightness)
    u.vignette.value = THREE.MathUtils.lerp(0.2, 0.34, nightness)
    u.lift.value = THREE.MathUtils.lerp(0, 0.02, nightness)
  }

  render(): void {
    this.composer.render()
  }
}
