// The sky's furniture: a moon disc that rides the night light's direction,
// and a drifting field of soft cloud cards a few hundred metres up that
// follows the viewer (wrapping, so the sky never runs out). Both fog-aware so
// they fade into the haze like everything else.
import * as THREE from 'three'

const CLOUD_COUNT = 70
const CLOUD_FIELD = 2600 // the field repeats every this many metres
const CLOUD_ALT = [420, 760]

/**
 * A cumulus card. `upright` paints the side view — a flat shaded base, a
 * bright lumpy top — for the billboard; the plain variant is the top-down
 * card. Every puff stays well inside the canvas and the whole thing is
 * multiplied by an elliptical falloff, so no card ever shows an edge (the
 * first clouds were hard white lozenges: puffs ran off the canvas).
 */
function puffTexture(upright: boolean, seed: number): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S; c.height = S
  const g = c.getContext('2d')!
  g.clearRect(0, 0, S, S)
  let a = seed
  const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 }
  const puffs = 70
  for (let i = 0; i < puffs; i++) {
    // upright: puffs cluster on a flat base line (y≈0.62) and heap upward
    const x = S * (0.22 + rand() * 0.56)
    const y = upright ? S * (0.6 - Math.pow(rand(), 1.5) * 0.36) : S * (0.28 + rand() * 0.44)
    const r = S * (0.045 + rand() * 0.075)
    // shade: white at the top of the heap, blue-grey toward the flat base
    const t = upright ? THREE.MathUtils.clamp((y / S - 0.24) / 0.38, 0, 1) : 0
    const lr = Math.round(255 - t * 95), lg = Math.round(255 - t * 85), lb = Math.round(255 - t * 60)
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(${lr},${lg},${lb},1)`)
    grad.addColorStop(0.78, `rgba(${lr},${lg},${lb},0.92)`)
    grad.addColorStop(1, `rgba(${lr},${lg},${lb},0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, S, S)
  }
  // elliptical falloff mask — alpha → 0 well before the canvas edge
  const img = g.getImageData(0, 0, S, S)
  const d = img.data
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x / S - 0.5) / 0.46
      const ny = ((y / S) - (upright ? 0.48 : 0.5)) / (upright ? 0.34 : 0.42)
      const rr = nx * nx + ny * ny
      const m = rr >= 1 ? 0 : Math.pow(1 - rr, 0.9)
      d[(y * S + x) * 4 + 3] = Math.round(d[(y * S + x) * 4 + 3] * m)
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function starTexture(): THREE.CanvasTexture {
  // an equirect night sky: deep blue zenith → slate horizon, salted with stars
  const W = 2048, H = 1024
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#0a1024')
  grad.addColorStop(0.45, '#101a36')
  grad.addColorStop(0.5, '#233250')
  grad.addColorStop(1, '#0a1024')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  let a = 7777
  const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 }
  for (let i = 0; i < 1400; i++) {
    const x = rand() * W, y = rand() * H * 0.5 // upper half = above the horizon
    const r = rand() < 0.06 ? 1.3 : 0.7
    g.fillStyle = `rgba(${220 + rand() * 35},${220 + rand() * 35},255,${0.5 + rand() * 0.5})`
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class SkyExtras {
  readonly group = new THREE.Group()
  private moon: THREE.Mesh
  private moonMat: THREE.MeshBasicMaterial
  private dome: THREE.Mesh
  private domeMat: THREE.MeshBasicMaterial
  private clouds: THREE.InstancedMesh
  private cloudMat: THREE.MeshBasicMaterial
  /** the upright billboards (one per cloud) that give them a body from below */
  private uprights: THREE.InstancedMesh
  private uprightMat: THREE.MeshBasicMaterial
  private seeds: { x: number; z: number; y: number; s: number; rot: number; speed: number }[] = []
  private dummy = new THREE.Object3D()
  private t = 0

  constructor() {
    this.moonMat = new THREE.MeshBasicMaterial({ color: 0xe8eefc, fog: false, depthWrite: false, transparent: true, opacity: 0 })
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(1, 32), this.moonMat)
    this.moon.renderOrder = -10
    this.moon.frustumCulled = false
    this.group.add(this.moon)
    // the night dome: the Sky shader goes black once the sun is under the
    // horizon; a starry gradient fades in over it
    this.domeMat = new THREE.MeshBasicMaterial({ map: starTexture(), side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, opacity: 0 })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.domeMat)
    this.dome.renderOrder = -20
    this.dome.frustumCulled = false
    this.group.add(this.dome)

    // no fog on clouds: at 600 m the haze greyed them to overcast; they fade
    // by their own alpha instead. Two cards a cloud: a flat top-down card (the
    // shape from the air) and an upright billboard (the heap from the ground)
    this.cloudMat = new THREE.MeshBasicMaterial({ map: puffTexture(false, 99991), transparent: true, depthWrite: false, opacity: 0.7, side: THREE.DoubleSide, fog: false })
    this.clouds = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.cloudMat, CLOUD_COUNT)
    this.clouds.frustumCulled = false
    this.clouds.matrixAutoUpdate = false
    this.clouds.renderOrder = 5
    this.uprightMat = new THREE.MeshBasicMaterial({ map: puffTexture(true, 4711), transparent: true, depthWrite: false, opacity: 0.9, side: THREE.DoubleSide, fog: false })
    this.uprights = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.uprightMat, CLOUD_COUNT)
    this.uprights.frustumCulled = false
    this.uprights.matrixAutoUpdate = false
    this.uprights.renderOrder = 6
    this.group.add(this.uprights)
    let a = 4242
    const rand = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 }
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this.seeds.push({
        x: rand() * CLOUD_FIELD, z: rand() * CLOUD_FIELD,
        y: CLOUD_ALT[0] + rand() * (CLOUD_ALT[1] - CLOUD_ALT[0]),
        s: 110 + Math.pow(rand(), 1.6) * 460, rot: rand() * Math.PI * 2, speed: 0.6 + rand() * 0.8,
      })
    }
    this.group.add(this.clouds)
  }

  /**
   * @param cam         the camera (clouds and moon are placed around it)
   * @param moonDir     unit direction TO the moon (the night light's direction)
   * @param nightness   0 by day → 1 at night (moon fades in, clouds go dark)
   * @param sunTint     the current key light colour (clouds are lit by it)
   * @param fogFar      cloud alpha fades toward the fog distance
   */
  update(dt: number, cam: THREE.Camera, moonDir: THREE.Vector3, nightness: number, sunTint: THREE.Color, fogFar: number): void {
    this.t += dt
    const camPos = cam.position
    // the moon: 1.3° across, parked just inside the fog-bound far plane
    const dist = fogFar * 1.02
    this.moon.position.copy(camPos).addScaledVector(moonDir, dist)
    this.moon.lookAt(camPos)
    this.moon.scale.setScalar(dist * 0.012)
    this.moonMat.opacity = THREE.MathUtils.clamp((nightness - 0.15) * 1.6, 0, 1) * (moonDir.y > -0.05 ? 1 : 0)
    this.dome.position.copy(camPos)
    this.dome.scale.setScalar(fogFar * 1.04)
    this.dome.rotation.y = this.t * 0.002 // the stars wheel, barely
    this.domeMat.opacity = THREE.MathUtils.clamp((nightness - 0.35) * 1.8, 0, 1)

    // clouds: drift with the wind, wrap around the camera so the field is endless
    const wind = this.t * 6
    const half = CLOUD_FIELD / 2
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const s = this.seeds[i]
      let x = s.x + wind * s.speed - camPos.x
      let z = s.z + wind * 0.35 * s.speed - camPos.z
      x = ((x % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD - half
      z = ((z % CLOUD_FIELD) + CLOUD_FIELD * 1.5) % CLOUD_FIELD - half
      const wx = camPos.x + x, wz = camPos.z + z
      this.dummy.position.set(wx, s.y, wz)
      this.dummy.rotation.set(0, s.rot, 0)
      this.dummy.scale.set(s.s, 1, s.s * 0.7)
      this.dummy.updateMatrix()
      this.clouds.setMatrixAt(i, this.dummy.matrix)
      // the upright: a billboard (yaw to the camera), its base on the flat card
      this.dummy.position.set(wx, s.y + s.s * 0.16, wz)
      this.dummy.rotation.set(0, Math.atan2(camPos.x - wx, camPos.z - wz), 0)
      this.dummy.scale.set(s.s * 0.9, s.s * 0.42, 1)
      this.dummy.updateMatrix()
      this.uprights.setMatrixAt(i, this.dummy.matrix)
    }
    this.clouds.instanceMatrix.needsUpdate = true
    this.uprights.instanceMatrix.needsUpdate = true
    // lit by the key light by day, moon-blue and dim at night (the shading is
    // in the upright texture; MeshBasic under the filmic exposure wants ~1.4×)
    const tint = this.cloudMat.color.copy(sunTint).lerp(new THREE.Color(0xffffff), 0.75).multiplyScalar(THREE.MathUtils.lerp(1.9, 0.5, nightness))
    this.uprightMat.color.copy(tint)
    // the flat card is the shape from the air; from underneath it only blurs
    // the heap, so it thins out as the viewer drops below the cloud deck
    const below = THREE.MathUtils.clamp((CLOUD_ALT[0] - camPos.y) / 200, 0, 1)
    this.cloudMat.opacity = THREE.MathUtils.lerp(0.6, 0.45, nightness) * THREE.MathUtils.lerp(1, 0.4, below)
    this.uprightMat.opacity = THREE.MathUtils.lerp(0.95, 0.7, nightness)
  }
}
