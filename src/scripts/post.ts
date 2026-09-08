// The look, finished in post (PLAN decision 12: one visual identity, graded).
//
// PERFORMANCE.md said "no post-processing until the budget is met with
// headroom". It is met — 3.5-5 ms of a 12 ms contract at 2560×1440 (M40) — so
// this is that headroom spent on the three things a flat-lit low-poly island
// is most obviously missing:
//
//  · BLOOM, on a high threshold, so the fires, the beacon and the sun bleed
//    light and nothing else does.
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

export class Post {
  readonly composer: EffectComposer
  private renderPass: RenderPass
  private bloom: UnrealBloomPass
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
    this.grade.enabled = q !== 'off'
    this.fxaa.enabled = q !== 'off'
  }

  get enabled(): boolean {
    return this.quality !== 'off'
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
