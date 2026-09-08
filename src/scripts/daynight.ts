// Day-night cycle + the M2 art-direction decision, implemented.
//
// The decision: filmic-vivid hybrid keyed to time of day — ACES filmic base
// at high sun, ramping into the vivid grade (warm key, saturated fog, colored
// rim) as sun elevation drops, then into a cool dark night. So the "grade" is
// a curve over sun elevation, evaluated every frame; noon and golden hour are
// its two endpoints, exactly as picked from the M2 batch.
//
// The Sky addon lives in the main scene (visible sky) and is re-baked into a
// PMREM environment map whenever the sun has moved enough to matter.
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { SkyEnvironment } from './sky-env'

export const DAY_LENGTH_S = 600 // one full day-night in 10 real minutes

interface Grade {
  exposure: number
  fog: THREE.Color
  fogNear: number
  fogFar: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  sun: THREE.Color
  sunIntensity: number
  rimIntensity: number
  turbidity: number
  rayleigh: number
}

const NOON: Grade = {
  exposure: 0.52, // dark, contrasty (user: real-leaf greens, strong shadows)
  fog: new THREE.Color(0x8fb2cf),
  fogNear: 140, fogFar: 1500, // subtle onset, real distance: the volcano is NOT in view from the beach any more — you find it (user)
  hemiSky: new THREE.Color(0x8fb6dc),
  hemiGround: new THREE.Color(0x1d2719),
  hemiIntensity: 0.3, // ARK reference: canopy shadow pools go properly dark
  sun: new THREE.Color(0xffefcf),
  sunIntensity: 2.9,
  rimIntensity: 0,
  // a deep noon blue (turbidity 6 / rayleigh 1.8 washed the zenith nearly
  // white, and the clouds read as grey smudges against it — M18)
  turbidity: 2.6,
  rayleigh: 1.1,
}

const GOLDEN: Grade = {
  exposure: 0.6,
  fog: new THREE.Color(0xdd9a68),
  fogNear: 130, fogFar: 1300,
  hemiSky: new THREE.Color(0xf2b27a),
  hemiGround: new THREE.Color(0x2c3a26),
  hemiIntensity: 1.0,
  // less magenta in the key: grey rock went pink at 17:00 (user screenshot 20)
  sun: new THREE.Color(0xff9c58),
  sunIntensity: 3.2,
  rimIntensity: 0.6,
  turbidity: 7,
  rayleigh: 2.2,
}

const NIGHT: Grade = {
  // brighter than it was (user: "moonlight, brighter, slightly more
  // visibility"): a real moonlit night — blue key, lifted fill, readable fog
  // (a notch darker again — user screenshot 27: "a little darker, not too dark")
  // (darker again M23 — "night a little more darker" — so a campfire matters:
  // the fill and the moon key both drop, the fog goes near-black blue)
  exposure: 0.58,
  fog: new THREE.Color(0x141e33),
  fogNear: 110, fogFar: 1150,
  hemiSky: new THREE.Color(0x33447a),
  hemiGround: new THREE.Color(0x131a12),
  hemiIntensity: 0.62,
  sun: new THREE.Color(0xa8c0ff), // the "sun" light doubles as moonlight
  sunIntensity: 0.95,
  rimIntensity: 0,
  turbidity: 4,
  rayleigh: 0.6,
}

const scratch: Grade = {
  exposure: 1,
  fog: new THREE.Color(),
  fogNear: 90, fogFar: 900,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 1,
  sun: new THREE.Color(),
  sunIntensity: 1,
  rimIntensity: 0,
  turbidity: 6,
  rayleigh: 2,
}

function lerpGrade(a: Grade, b: Grade, t: number, out: Grade): Grade {
  out.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t)
  out.fog.lerpColors(a.fog, b.fog, t)
  out.fogNear = THREE.MathUtils.lerp(a.fogNear, b.fogNear, t)
  out.fogFar = THREE.MathUtils.lerp(a.fogFar, b.fogFar, t)
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t)
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t)
  out.hemiIntensity = THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, t)
  out.sun.lerpColors(a.sun, b.sun, t)
  out.sunIntensity = THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, t)
  out.rimIntensity = THREE.MathUtils.lerp(a.rimIntensity, b.rimIntensity, t)
  out.turbidity = THREE.MathUtils.lerp(a.turbidity, b.turbidity, t)
  out.rayleigh = THREE.MathUtils.lerp(a.rayleigh, b.rayleigh, t)
  return out
}

/**
 * Cheaper PCF far from the camera. three r185's PCF takes 5 hardware-filtered
 * taps for every pixel inside the shadow box; on a Retina screen the terrain
 * alone was 11 ms of that (M26 GPU ablation: receiveShadow on 13.8 ms, off
 * 2.3). Past 30 m the penumbra is under a pixel, so one tap is the same
 * picture. Patched into the shared chunk once, before any material compiles.
 */
function patchShadowChunk(): void {
  const key = 'shadowmap_pars_fragment'
  const src = THREE.ShaderChunk[key]
  if (!src || src.includes('vShadowDistCheap')) return
  const from = `				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +`
  if (!src.includes(from)) return
  const patched = src.replace(from, `				// vShadowDistCheap: one tap beyond 30 m from the camera (jurassic-stack)
				if ( gl_FragCoord.w < 1.0 / 30.0 ) {
					shadow = texture( shadowMap, vec3( shadowCoord.xy, shadowCoord.z ) );
					return mix( 1.0, shadow, shadowIntensity );
				}
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +`)
  ;(THREE.ShaderChunk as Record<string, string>)[key] = patched
}
patchShadowChunk()

export class DayNight {
  /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  time = 0.34 // spawn in mid-morning
  /** days lived on the island (fractional, saved) — the finale's tally */
  elapsedDays = 0
  private sky = new Sky()
  private sunLight = new THREE.DirectionalLight()
  private rimLight = new THREE.DirectionalLight(0xff5588)
  private hemi = new THREE.HemisphereLight()
  private sunDir = new THREE.Vector3()
  /** eight skies baked at load, blended through the day (M45) */
  readonly env: SkyEnvironment
  /** THE SKY IS BAKED, NOT SHADED (PERFORMANCE.md lever D). The Sky addon is
   *  per-pixel Rayleigh/Mie scattering — ~1.1 ms of a 6.5 ms frame at
   *  2560×1440 (the M31 profile) for a sun that moves a quarter of a degree a
   *  second. So it lives in a scene of its own, is rendered into a 512² cube
   *  whenever its sun has moved half a degree, and the world reads that cube
   *  as its background: one texture fetch per pixel instead of a scattering
   *  integral. A re-bake is six 512² faces, ~0.4 ms, about once every two
   *  seconds of the ten-minute day. */
  private skyScene = new THREE.Scene()
  private skyTarget: THREE.WebGLCubeRenderTarget
  private skyCam: THREE.CubeCamera
  private bakedSun = new THREE.Vector3(99, 99, 99)
  private bakedTurbidity = -1

  /** Shadow follow-focus (the player/mount), set per frame from the game loop. */
  private focus = new THREE.Vector3()
  /** for the sky furniture: where the key light comes from, how deep the night is, the key colour */
  readonly keyDir = new THREE.Vector3()
  nightness = 0
  readonly keyColor = new THREE.Color()
  fogFar = 1500

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
  ) {
    this.sky.scale.setScalar(45000)
    this.sky.name = 'sky'
    this.skyScene.add(this.sky)
    // half-float: the Sky shader's output is HDR and the ACES curve is applied
    // when the background is drawn, exactly as it was for the mesh
    this.skyTarget = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType })
    this.skyCam = new THREE.CubeCamera(1, 100000, this.skyTarget)
    this.skyScene.add(this.skyCam)
    scene.background = this.skyTarget.texture
    scene.add(this.sunLight, this.sunLight.target, this.rimLight, this.hemi)
    this.rimLight.position.set(-300, 140, -260)

    // one directional shadow map following the player (CSM comes at M6 proper)
    this.sunLight.castShadow = true
    const sc = this.sunLight.shadow
    sc.mapSize.set(1024, 1024)
    const EXTENT = 85
    sc.camera.left = -EXTENT
    sc.camera.right = EXTENT
    sc.camera.top = EXTENT
    sc.camera.bottom = -EXTENT
    sc.camera.near = 1
    sc.camera.far = 800
    sc.camera.updateProjectionMatrix() // without this the default ±5 m box stays
    sc.radius = 2 // soften PCF edges
    sc.bias = -0.0003
    // normalBias is in WORLD METERS — 1.6 erased every caster thinner than
    // 1.6 m (trunks, the player). ~2× texel size (170 m / 2048 ≈ 8 cm) is right.
    sc.normalBias = 0.18
    scene.fog = new THREE.Fog(0x87b5d9, 420, 5200)
    // the Sky PMREM is HDR-bright; at full strength it washes every material
    // to pastel. IBL is a subtle fill here, the direct lights carry the look.
    scene.environmentIntensity = 0.13
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.env = new SkyEnvironment(renderer)
  }

  advance(dt: number): void {
    this.time = (this.time + dt / DAY_LENGTH_S) % 1
    this.elapsedDays += dt / DAY_LENGTH_S
    this.apply()
  }

  /** Keep the shadow frustum centered on the action (snapped to reduce shimmer). */
  /** QA: stretch the fog (aerial shots need to see the whole island) */
  fogScale = 1
  /** the main camera, so its far plane can follow the fog */
  camera: THREE.PerspectiveCamera | null = null

  /** Widen the shadow box (metres each way) for one frame. The warm-up's
   *  shadow render only compiles the DEPTH variant of materials inside the
   *  box — 85 m around spawn — so every material first entering the box
   *  later compiled its depth program mid-frame, which is why a new region
   *  cost 3-5 program compiles and a 60-100 ms hitch (M31 hitch hunt). One
   *  island-wide shadow frame at load compiles them all. */
  setShadowExtent(metres: number): void {
    const c = this.sunLight.shadow.camera
    c.left = -metres
    c.right = metres
    c.top = metres
    c.bottom = -metres
    c.far = Math.max(800, metres * 4)
    c.updateProjectionMatrix()
  }

  /** Resize the shadow map — and its REACH with it. A 1024 map over 85 m is
   *  8 cm a texel; the same texel density buys 170 m at 2048, and the middle
   *  distance stops looking flat (M44). Low trades reach for speed instead. */
  setShadowSize(size: number): void {
    const sc = this.sunLight.shadow
    sc.mapSize.set(size, size)
    sc.map?.dispose()
    sc.map = null
    this.baseExtent = size >= 2048 ? 150 : size >= 1024 ? 100 : 70
    this.setShadowExtent(this.baseExtent)
    // the softening radius follows the texel size, or High comes out crunchy
    sc.radius = size >= 2048 ? 3 : 2
    sc.normalBias = (this.baseExtent / size) * 2.2
  }
  private baseExtent = 85

  /** the reach the game plays at (the warm-up widens it temporarily) */
  get shadowReach(): number {
    return this.baseExtent
  }

  /** the current shadow focus (for a warm-up render that moves it and puts it back) */
  shadowFocus(): { x: number; z: number } {
    return { x: this.focus.x, z: this.focus.z }
  }

  /** move the shadow box now (setFocus + re-aim), for the warm-up renders */
  focusShadow(x: number, z: number): void {
    this.setFocus(x, z)
    this.sunLight.position.copy(this.focus).addScaledVector(this.sunDir, 420)
    this.sunLight.target.position.copy(this.focus)
    this.sunLight.target.updateMatrixWorld()
  }

  setFocus(x: number, z: number): void {
    this.focus.set(Math.round(x / 2) * 2, 0, Math.round(z / 2) * 2)
  }

  setTime(t: number): void {
    this.time = ((t % 1) + 1) % 1
    this.apply()
  }

  /** Sun elevation in degrees (negative at night). */
  get sunElevationDeg(): number {
    return Math.sin((this.time - 0.25) * Math.PI * 2) * 78
  }

  /** The sky's own parameters at a time of day — the live sky and the eight
   *  baked environments read the same curve, so a reflection and the sky it
   *  reflects can never disagree (M45). */
  skyParamsAt(time: number): { sunPosition: THREE.Vector3; turbidity: number; rayleigh: number } {
    const elev = Math.sin((time - 0.25) * Math.PI * 2) * 78
    const azimuth = (time - 0.25) * Math.PI * 2 * 0.5 + Math.PI * 0.15
    let grade: Grade
    if (elev >= 30) grade = lerpGrade(NOON, NOON, 0, scratch)
    else if (elev >= 2) grade = lerpGrade(GOLDEN, NOON, (elev - 2) / 28, scratch)
    else grade = lerpGrade(GOLDEN, NIGHT, THREE.MathUtils.clamp((2 - elev) / 12, 0, 1), scratch)
    const nightness = THREE.MathUtils.clamp((2 - elev) / 12, 0, 1)
    const skyElev = elev >= 2
      ? elev + 3.5 * (1 - THREE.MathUtils.smoothstep(elev, 2, 30))
      : THREE.MathUtils.lerp(5.5, -1.5, THREE.MathUtils.smoothstep(nightness, 0.35, 1))
    const e = THREE.MathUtils.degToRad(skyElev)
    return {
      sunPosition: new THREE.Vector3(Math.cos(e) * Math.sin(azimuth), Math.sin(e), Math.cos(e) * Math.cos(azimuth)),
      turbidity: grade.turbidity,
      rayleigh: grade.rayleigh,
    }
  }

  /** Bake the day's environments (once, at load, behind the boot card). */
  bakeEnvironments(): void {
    this.env.bake((t) => this.skyParamsAt(t))
    if (this.env.texture) this.scene.environment = this.env.texture
  }

  private apply(): void {
    const elev = this.sunElevationDeg
    const azimuth = (this.time - 0.25) * Math.PI * 2 * 0.5 + Math.PI * 0.15

    // sun direction (also used for the moon at night, mirrored up)
    const e = THREE.MathUtils.degToRad(Math.max(elev, -(elev * 0.6)))
    this.sunDir.set(
      Math.cos(e) * Math.sin(azimuth),
      Math.sin(e),
      Math.cos(e) * Math.cos(azimuth),
    )

    // grade curve over elevation:
    //   >= 30°: pure NOON (filmic) · 30°..2°: NOON→GOLDEN · 2°..-10°: GOLDEN→NIGHT
    let grade: Grade
    if (elev >= 30) {
      grade = lerpGrade(NOON, NOON, 0, scratch)
    } else if (elev >= 2) {
      grade = lerpGrade(GOLDEN, NOON, (elev - 2) / 28, scratch)
    } else {
      const t = THREE.MathUtils.clamp((2 - elev) / 12, 0, 1)
      grade = lerpGrade(GOLDEN, NIGHT, t, scratch)
    }

    this.renderer.toneMappingExposure = grade.exposure
    const fog = this.scene.fog as THREE.Fog
    fog.color.copy(grade.fog)
    fog.near = grade.fogNear * this.fogScale
    fog.far = grade.fogFar * this.fogScale
    // the camera's far plane sits just past the fog: everything beyond is
    // fog-coloured anyway, so the far half of the island stops costing draws
    if (this.camera && Math.abs(this.camera.far - fog.far * 1.08) > 1) {
      this.camera.far = fog.far * 1.08
      this.camera.updateProjectionMatrix()
    }
    this.hemi.color.copy(grade.hemiSky)
    this.hemi.groundColor.copy(grade.hemiGround)
    this.hemi.intensity = grade.hemiIntensity
    this.sunLight.color.copy(grade.sun)
    this.sunLight.intensity = grade.sunIntensity
    this.sunLight.position.copy(this.focus).addScaledVector(this.sunDir, 420)
    this.sunLight.target.position.copy(this.focus)
    this.rimLight.intensity = grade.rimIntensity
    this.keyDir.copy(this.sunDir)
    this.keyColor.copy(grade.sun)
    this.nightness = THREE.MathUtils.clamp((2 - elev) / 12, 0, 1)
    this.fogFar = fog.far

    // sky shader follows the real sun even when the lights have switched to moon
    const u = this.sky.material.uniforms
    u.turbidity.value = grade.turbidity
    u.rayleigh.value = grade.rayleigh
    u.mieCoefficient.value = 0.004
    u.mieDirectionalG.value = 0.85
    // the Sky shader goes black within a degree or two of the sun setting, while
    // the light grade takes 12° to reach night — at 18:07 the sky was starry over
    // an orange, fully-lit island (user screenshot 26). The sky's sun now sinks
    // WITH the grade: it reaches −6° (dark) exactly when nightness reaches 1
    // The shader's whole sky scales with its sun-intensity curve, which is
    // near-black by 0° — so the sky's sun rides above the real one through the
    // evening: +3.5° at sunset, then it sinks with nightness so that it is
    // still a lit dusk (3°) when the star dome starts fading in (nightness
    // 0.55) and only reaches the horizon as the dome covers it
    const skyElev = elev >= 2
      ? elev + 3.5 * (1 - THREE.MathUtils.smoothstep(elev, 2, 30))
      : THREE.MathUtils.lerp(5.5, -1.5, THREE.MathUtils.smoothstep(this.nightness, 0.35, 1))
    const realE = THREE.MathUtils.degToRad(skyElev)
    u.sunPosition.value.set(
      Math.cos(realE) * Math.sin(azimuth),
      Math.sin(realE),
      Math.cos(realE) * Math.cos(azimuth),
    )

    // re-bake the sky cube when its sun has moved half a degree (or the
    // turbidity/rayleigh curve has stepped enough to see)
    if (this.bakedSun.angleTo(u.sunPosition.value) > 0.0087 || this.bakedTurbidity !== grade.turbidity) {
      this.bakedSun.copy(u.sunPosition.value)
      this.bakedTurbidity = grade.turbidity
      const prevTarget = this.renderer.getRenderTarget()
      this.skyCam.update(this.renderer, this.skyScene)
      this.renderer.setRenderTarget(prevTarget)
    }

    // THE ENVIRONMENT FOLLOWS THE DAY (M45). Eight skies are baked at load and
    // the two either side of now are blended — a full-screen mix of two 2D
    // images, because a PMREM is a packed 2D texture and not a live cubemap,
    // so nothing is re-filtered. M19's re-bake cost 20-40 ms and jumped; this
    // costs one quad and moves continuously.
    this.env.update(this.time)
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.13, 0.025, this.nightness)
  }
}
