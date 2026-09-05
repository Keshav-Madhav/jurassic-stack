// Impostors: a tree beyond the near band is drawn as three textured quads —
// two crossed uprights and a horizontal crown card — carrying pictures of the
// real model rendered once at load (side and top views). Six triangles
// instead of 220–1500, a silhouette with every leaf mass in it, and a crown
// disc that still reads from the air (a pure camera-facing billboard turns
// into a sliver when you look down on a forest). The classic cross-card far
// LOD, done at load so any prop — built or GLB — gets one for free.
import * as THREE from 'three'

export interface Impostor {
  /** three quads, unit height, width = the model's width/height aspect */
  geometry: THREE.BufferGeometry
  /** side sprite on the two uprights */
  sideMaterial: THREE.MeshLambertMaterial
  /** top sprite on the crown card */
  topMaterial: THREE.MeshLambertMaterial
  /** vertex index range of the crown card (its own draw: different texture) */
  topStart: number
}

const SIDE_PX = 192
const TOP_PX = 128

let captureScene: THREE.Scene | null = null
let captureCam: THREE.OrthographicCamera | null = null

/**
 * Render `root` (already normalized to 1 m tall with its base at y=0, the way
 * InstancedProp does) from the side and from above into two small textures,
 * and build the cross-card geometry sized to its silhouette.
 */
export function captureImpostor(renderer: THREE.WebGLRenderer, root: THREE.Object3D, baseY: number, height: number, width: number): Impostor {
  if (!captureScene) {
    captureScene = new THREE.Scene()
    // neutral daylight: the sprite carries shape and colour; the scene's own
    // sun/ambient relight the card through MeshLambert at draw time
    captureScene.add(new THREE.AmbientLight(0xffffff, 1.35))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(0.4, 1, 0.9)
    captureScene.add(sun)
    captureCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  }
  const scene = captureScene
  const cam = captureCam!
  const prevTarget = renderer.getRenderTarget()
  const prevClear = renderer.getClearAlpha()
  const prevColor = new THREE.Color()
  renderer.getClearColor(prevColor)
  const prevTone = renderer.toneMapping
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0x000000, 0)

  scene.add(root)
  root.updateMatrixWorld(true)
  const halfW = width / 2

  // side view: looking along -z at the tree, frame [-halfW, halfW] × [baseY, baseY+height]
  const side = new THREE.WebGLRenderTarget(SIDE_PX, SIDE_PX, { format: THREE.RGBAFormat })
  cam.left = -halfW; cam.right = halfW; cam.top = baseY + height; cam.bottom = baseY
  cam.position.set(0, 0, 50); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix()
  renderer.setRenderTarget(side)
  renderer.clear()
  renderer.render(scene, cam)

  // top view: looking down, frame [-halfW, halfW]²
  const top = new THREE.WebGLRenderTarget(TOP_PX, TOP_PX, { format: THREE.RGBAFormat })
  cam.left = -halfW; cam.right = halfW; cam.top = halfW; cam.bottom = -halfW
  cam.position.set(0, 60, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix()
  renderer.setRenderTarget(top)
  renderer.clear()
  renderer.render(scene, cam)

  scene.remove(root)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevColor, prevClear)
  renderer.toneMapping = prevTone
  side.texture.colorSpace = THREE.SRGBColorSpace
  top.texture.colorSpace = THREE.SRGBColorSpace
  side.texture.generateMipmaps = false
  top.texture.generateMipmaps = false
  side.texture.minFilter = THREE.LinearFilter
  top.texture.minFilter = THREE.LinearFilter

  // geometry: two uprights crossing at the trunk + a crown card at ~2/3 height
  // (normals straight up so the sun shades the card like ground-facing foliage)
  const pos: number[] = []
  const uv: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const quad = (corners: [number, number, number][], uvs: [number, number][]) => {
    const base = pos.length / 3
    for (let i = 0; i < 4; i++) { pos.push(...corners[i]); uv.push(...uvs[i]); nor.push(0, 1, 0) }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const y0 = baseY, y1 = baseY + height
  quad([[-halfW, y0, 0], [halfW, y0, 0], [halfW, y1, 0], [-halfW, y1, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]])
  quad([[0, y0, -halfW], [0, y0, halfW], [0, y1, halfW], [0, y1, -halfW]], [[0, 0], [1, 0], [1, 1], [0, 1]])
  const topStart = idx.length
  const cy = baseY + height * 0.66
  quad([[-halfW, cy, halfW], [halfW, cy, halfW], [halfW, cy, -halfW], [-halfW, cy, -halfW]], [[0, 0], [1, 0], [1, 1], [0, 1]])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geometry.setIndex(idx)
  geometry.addGroup(0, topStart, 0)
  geometry.addGroup(topStart, idx.length - topStart, 1)

  const mat = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, transparent: false })
  return { geometry, sideMaterial: mat(side.texture), topMaterial: mat(top.texture), topStart }
}
