// Dino impostors: an awake animal in the mid band (120–260 m) is drawn as a
// cross-card sprite of its species — the same trick as the trees — instead
// of a skinned rig. Two thirds of the attached rigs at the wood line sat in
// that band, each ~45 bones walked every frame; at 120 m a 3 m animal is
// 20 px tall and a card is indistinguishable (M25).
//
// One island-wide InstancedMesh per species; a dino claims a slot when it
// enters the band and releases it when it leaves. Cards are yawed to the
// dino's heading (the side sprite faces the way the animal faces).
import * as THREE from 'three'

const SLOTS = 96
const SIDE_PX = 160

interface SpeciesSet { mesh: THREE.InstancedMesh; free: number[]; used: Map<number, number>; pos: Map<number, THREE.Vector3> }

let captureScene: THREE.Scene | null = null
let captureCam: THREE.OrthographicCamera | null = null

/** Render the rig's side view into a texture. The rig is rendered IN PLACE
 *  (a cloned SkinnedMesh keeps the original skeleton, whose bones sit at the
 *  animal's world position — a clone at the origin drew nothing, M25): the
 *  ortho camera is placed beside the animal, looking across its flank. */
function captureSide(renderer: THREE.WebGLRenderer, root: THREE.Object3D, center: THREE.Vector3, heading: number, height: number, length: number): THREE.Texture {
  if (!captureScene) {
    captureScene = new THREE.Scene()
    // lit brighter than the tree capture: MeshLambert under the filmic
    // exposure and the cards read as dark cut-outs at 140 m
    captureScene.add(new THREE.AmbientLight(0xffffff, 2.2))
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4)
    sun.position.set(0.6, 1, 1.2)
    captureScene.add(sun)
    captureCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  }
  const scene = captureScene, cam = captureCam!
  const prevTarget = renderer.getRenderTarget()
  const prevAlpha = renderer.getClearAlpha()
  const prevColor = new THREE.Color()
  renderer.getClearColor(prevColor)
  const prevTone = renderer.toneMapping
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0x000000, 0)
  // borrow the rig: reparent into the capture scene (keeping its world matrix), render, give it back
  const parent = root.parent
  scene.attach(root)
  root.updateMatrixWorld(true)
  const w = Math.round(SIDE_PX * Math.max(1, length / height))
  const rt = new THREE.WebGLRenderTarget(w, SIDE_PX, { format: THREE.RGBAFormat })
  cam.left = -length / 2; cam.right = length / 2; cam.top = height / 2; cam.bottom = -height / 2
  // the animal faces `heading` (+z at 0): its flank is along the heading's right vector
  const rx = Math.cos(heading), rz = -Math.sin(heading)
  const mid = new THREE.Vector3(center.x, center.y + height / 2, center.z)
  cam.position.set(mid.x + rx * 50, mid.y, mid.z + rz * 50)
  cam.up.set(0, 1, 0)
  cam.lookAt(mid)
  cam.updateProjectionMatrix()
  renderer.setRenderTarget(rt)
  renderer.clear()
  renderer.render(scene, cam)
  if (parent) parent.attach(root)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevColor, prevAlpha)
  renderer.toneMapping = prevTone
  rt.texture.colorSpace = THREE.SRGBColorSpace
  rt.texture.generateMipmaps = false
  rt.texture.minFilter = THREE.LinearFilter
  return rt.texture
}

export class DinoImpostors {
  readonly group = new THREE.Group()
  private sets = new Map<string, SpeciesSet>()
  private dummy = new THREE.Object3D()
  private hidden = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001)

  /** Capture a species from its first calibrated rig (attached to the scene, idle pose). */
  capture(renderer: THREE.WebGLRenderer, speciesId: string, model: THREE.Object3D, height: number, facingOffset = 0): void {
    if (this.sets.has(speciesId)) return
    // the rig as it stands: its object's heading is its facing (+z at 0) plus the species offset
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const length = Math.min(Math.max(size.x, size.z) || height, height * 3.2) // (a scale track on the apato's root gave it a 36 m box)
    const center = new THREE.Vector3(box.min.x + size.x / 2, box.min.y, box.min.z + size.z / 2)
    const heading = (model.parent?.rotation.y ?? 0) - facingOffset + facingOffset // the object's yaw IS the facing incl. offset
    const tex = captureSide(renderer, model, center, heading, height, length)
    // one camera-facing quad per animal, its base at the feet
    const geo = new THREE.PlaneGeometry(length, height)
    geo.translate(0, height / 2, 0)
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide })
    const mesh = new THREE.InstancedMesh(geo, mat, SLOTS)
    mesh.count = SLOTS
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    for (let i = 0; i < SLOTS; i++) mesh.setMatrixAt(i, this.hidden)
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = false
    this.group.add(mesh)
    this.sets.set(speciesId, { mesh, free: Array.from({ length: SLOTS }, (_, i) => SLOTS - 1 - i), used: new Map(), pos: new Map() })
  }

  has(speciesId: string): boolean {
    return this.sets.has(speciesId)
  }

  private camX = 0
  private camZ = 0

  /** Show dino `id` of `species` as a card at (x, y, z). `heading` picks which way the flank faces (mirrored past 90°). */
  set(species: string, id: number, x: number, y: number, z: number, heading: number): void {
    const s = this.sets.get(species)
    if (!s) return
    let slot = s.used.get(id)
    if (slot === undefined) {
      slot = s.free.pop()
      if (slot === undefined) return // out of slots: the animal stays a rig
      s.used.set(id, slot)
    }
    let p = s.pos.get(id)
    if (!p) { p = new THREE.Vector3(); s.pos.set(id, p) }
    p.set(x, y, z)
    this.place(s, slot, p, heading)
  }

  private place(s: SpeciesSet, slot: number, p: THREE.Vector3, heading: number): void {
    // billboard toward the camera; mirror the sprite when the animal faces the other way
    const yaw = Math.atan2(this.camX - p.x, this.camZ - p.z)
    let rel = heading - yaw
    while (rel > Math.PI) rel -= Math.PI * 2
    while (rel < -Math.PI) rel += Math.PI * 2
    const flip = Math.sin(rel) < 0 ? -1 : 1
    this.dummy.position.copy(p)
    this.dummy.rotation.set(0, yaw, 0)
    this.dummy.scale.set(flip, 1, 1)
    this.dummy.updateMatrix()
    s.mesh.setMatrixAt(slot, this.dummy.matrix)
    s.mesh.instanceMatrix.addUpdateRange(slot * 16, 16)
    s.mesh.instanceMatrix.needsUpdate = true
  }

  /** re-yaw every card toward the camera (called when the camera has moved/turned enough) */
  face(camX: number, camZ: number, headings: (id: number) => number): void {
    this.camX = camX
    this.camZ = camZ
    for (const s of this.sets.values()) {
      for (const [id, slot] of s.used) {
        const p = s.pos.get(id)
        if (p) this.place(s, slot, p, headings(id))
      }
    }
  }

  /** Release dino `id`'s card (it left the band, went dormant, or died). */
  clear(species: string, id: number): void {
    const s = this.sets.get(species)
    if (!s) return
    const slot = s.used.get(id)
    if (slot === undefined) return
    s.used.delete(id)
    s.pos.delete(id)
    s.free.push(slot)
    s.mesh.setMatrixAt(slot, this.hidden)
    s.mesh.instanceMatrix.addUpdateRange(slot * 16, 16)
    s.mesh.instanceMatrix.needsUpdate = true
  }

  /** is dino `id` currently a card? */
  showing(species: string, id: number): boolean {
    return this.sets.get(species)?.used.has(id) ?? false
  }

  debug(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, s] of this.sets) out[k] = s.used.size
    return out
  }
}
