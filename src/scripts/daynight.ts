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
  exposure: 0.78,
  fog: new THREE.Color(0x22304c),
  fogNear: 120, fogFar: 1250,
  hemiSky: new THREE.Color(0x44598a),
  hemiGround: new THREE.Color(0x1c2418),
  hemiIntensity: 1.0,
  sun: new THREE.Color(0xb0c8ff), // the "sun" light doubles as moonlight
  sunIntensity: 1.35,
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
  private pmrem: THREE.PMREMGenerator
  private envTarget: THREE.WebGLRenderTarget | null = null

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
    scene.add(this.sky, this.sunLight, this.sunLight.target, this.rimLight, this.hemi)
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
    this.pmrem = new THREE.PMREMGenerator(renderer)
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

  /** QA: resize the shadow map at runtime */
  setShadowSize(size: number): void {
    const sc = this.sunLight.shadow
    sc.mapSize.set(size, size)
    sc.map?.dispose()
    sc.map = null
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
    const realE = THREE.MathUtils.degToRad(elev)
    u.sunPosition.value.set(
      Math.cos(realE) * Math.sin(azimuth),
      Math.sin(realE),
      Math.cos(realE) * Math.cos(azimuth),
    )

    // the environment map is baked ONCE, from a mid-morning sky, and only its
    // intensity follows the day. It used to re-bake every 3° of sun — every
    // ~5 s of the 10-minute day — and each bake was both a 20–40 ms stall and
    // a visible jump in every reflection (the water most of all): the
    // "flashing" (user, M19). The sun light itself still carries the colour.
    if (!this.envTarget) {
      const skyOnly = new THREE.Scene()
      const skyClone = this.sky.clone()
      const su = (skyClone.material as THREE.ShaderMaterial).uniforms
      su.sunPosition.value.set(0.55, 0.62, 0.55)
      su.turbidity.value = 3
      su.rayleigh.value = 1.2
      skyOnly.add(skyClone)
      this.envTarget = this.pmrem.fromScene(skyOnly as unknown as THREE.Scene, 0, 0.1, 1000)
      this.scene.environment = this.envTarget.texture
      skyOnly.remove(skyClone)
    }
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.13, 0.025, this.nightness)
  }
}
