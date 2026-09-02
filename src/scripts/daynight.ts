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
  fogNear: 260, fogFar: 2450,
  hemiSky: new THREE.Color(0x8fb6dc),
  hemiGround: new THREE.Color(0x1d2719),
  hemiIntensity: 0.42, // shadow pools stay dark; the sun carries the frame
  sun: new THREE.Color(0xffefcf),
  sunIntensity: 2.9,
  rimIntensity: 0,
  turbidity: 6,
  rayleigh: 1.8,
}

const GOLDEN: Grade = {
  exposure: 0.6,
  fog: new THREE.Color(0xe8884e),
  fogNear: 240, fogFar: 1900,
  hemiSky: new THREE.Color(0xffa858),
  hemiGround: new THREE.Color(0x2c3a26),
  hemiIntensity: 1.05,
  sun: new THREE.Color(0xff7a2e),
  sunIntensity: 3.6,
  rimIntensity: 0.8,
  turbidity: 10,
  rayleigh: 3.2,
}

const NIGHT: Grade = {
  exposure: 0.5,
  fog: new THREE.Color(0x141c2c),
  fogNear: 160, fogFar: 1300,
  hemiSky: new THREE.Color(0x2a3a5a),
  hemiGround: new THREE.Color(0x141c14),
  hemiIntensity: 0.4,
  sun: new THREE.Color(0x9db8e8), // the "sun" light doubles as moonlight
  sunIntensity: 0.35,
  rimIntensity: 0,
  turbidity: 4,
  rayleigh: 0.6,
}

const scratch: Grade = {
  exposure: 1,
  fog: new THREE.Color(),
  fogNear: 100, fogFar: 1000,
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
  private sky = new Sky()
  private sunLight = new THREE.DirectionalLight()
  private rimLight = new THREE.DirectionalLight(0xff5588)
  private hemi = new THREE.HemisphereLight()
  private sunDir = new THREE.Vector3()
  private pmrem: THREE.PMREMGenerator
  private envTarget: THREE.WebGLRenderTarget | null = null
  private lastBakedElevation = Number.POSITIVE_INFINITY

  /** Shadow follow-focus (the player/mount), set per frame from the game loop. */
  private focus = new THREE.Vector3()

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
    sc.mapSize.set(2048, 2048)
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
    scene.fog = new THREE.Fog(0x87b5d9, 350, 2450)
    // the Sky PMREM is HDR-bright; at full strength it washes every material
    // to pastel. IBL is a subtle fill here, the direct lights carry the look.
    scene.environmentIntensity = 0.13
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.pmrem = new THREE.PMREMGenerator(renderer)
  }

  advance(dt: number): void {
    this.time = (this.time + dt / DAY_LENGTH_S) % 1
    this.apply()
  }

  /** Keep the shadow frustum centered on the action (snapped to reduce shimmer). */
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
    fog.near = grade.fogNear
    fog.far = grade.fogFar
    this.hemi.color.copy(grade.hemiSky)
    this.hemi.groundColor.copy(grade.hemiGround)
    this.hemi.intensity = grade.hemiIntensity
    this.sunLight.color.copy(grade.sun)
    this.sunLight.intensity = grade.sunIntensity
    this.sunLight.position.copy(this.focus).addScaledVector(this.sunDir, 420)
    this.sunLight.target.position.copy(this.focus)
    this.rimLight.intensity = grade.rimIntensity

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

    // re-bake environment when the sun has moved enough (cheap: sky-only scene)
    if (Math.abs(elev - this.lastBakedElevation) > 3) {
      this.lastBakedElevation = elev
      this.envTarget?.dispose()
      const skyOnly = new THREE.Scene()
      const skyClone = this.sky.clone()
      skyOnly.add(skyClone)
      this.envTarget = this.pmrem.fromScene(skyOnly as unknown as THREE.Scene, 0, 0.1, 1000)
      this.scene.environment = this.envTarget.texture
      skyOnly.remove(skyClone)
    }
  }
}
