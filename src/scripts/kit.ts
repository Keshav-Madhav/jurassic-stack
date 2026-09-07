// The kit: downloaded CC0 props for items and buildables (Kenney Survival +
// Food kits, Quaternius/poly.pizza tools — see ASSETS.md), loaded once, and
// the item ICONS rendered from those same models at load (three-quarter view,
// lit like the world) so the hotbar shows the thing itself, not an emoji.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { ItemId } from './items'
import { registerWarmRoot } from './uploads'

/** item → kit model (public/models/kit/<file>.glb) */
export const ITEM_MODEL: Record<ItemId, string> = {
  wood: 'kenney-tree-log',
  stone: 'kenney-resource-stone',
  fiber: 'pp-Rope',
  flint: 'pp-AxeStone', // the knapped head is the flint; the icon frames the head (see ICON_FRAME)
  berry: 'kenney-grapes',
  rawmeat: 'kenney-meat-raw',
  cookedmeat: 'kenney-meat-cooked',
  hide: 'pp-AnimalHide',
  hatchet: 'pp-AxeStone',
  spear: 'pp-Spear',
  torch: 'pp-WoodenTorch',
  campfire: 'kenney-campfire-pit',
  foundation: 'kenney-floor',
  wall: 'kenney-fence-fortified',
  ceiling: 'kenney-floor', // planks: a flat ceiling you can stand on (the kit's roof piece is a whole frame on posts)
  saddle: 'kenney-bedroll',
}

/** per-icon framing tweaks: yaw/pitch, zoom, and a vertical offset (fraction of the model's extent) */
const ICON_FRAME: Partial<Record<ItemId, { yaw?: number; pitch?: number; roll?: number; zoom?: number; dy?: number; tint?: number; lift?: number }>> = {
  // thin/tall things lie diagonally across the frame and zoom to fill it
  flint: { zoom: 2.4, dy: -0.34, tint: 0x8a9098, roll: 0.3 }, // the axe head only, grey
  hatchet: { roll: -0.6, zoom: 1.05 },
  // the spear and torch are 1 : 12 sticks: frame their heads at 2× and lift the dark models
  spear: { roll: -0.9, zoom: 2.6, dy: -0.36, lift: 2.4 }, // a 1:19 stick: the head third, lying diagonal
  torch: { roll: -0.3, zoom: 1.9, dy: -0.32, lift: 1.7 },
  wood: { roll: -0.5, yaw: 0.3, zoom: 1.15 },
  fiber: { pitch: 1.0, tint: 0xd6c08a, zoom: 1.1 }, // a coil of straw-coloured rope
  hide: { pitch: 0.5, zoom: 1.1 },
  ceiling: { pitch: 0.6 },
  foundation: { pitch: 0.6 },
  wall: { yaw: 0.5 },
  stone: { zoom: 1.1 },
  berry: { zoom: 1.05 },
}

export class Kit {
  private models = new Map<string, THREE.Group>()
  readonly icons = new Map<ItemId, string>()

  async load(): Promise<void> {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const files = [...new Set(Object.values(ITEM_MODEL))]
    await Promise.all(files.map(async (f) => {
      const gltf = await loader.loadAsync(`models/kit/${f}.glb`)
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true
          o.receiveShadow = true
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            const mm = m as THREE.MeshStandardMaterial
            mm.roughness = Math.max(mm.roughness, 0.8)
            mm.metalness = 0
            // Kenney's colormap is saturated toy-orange; under the island's warm
            // 2.9 sun a hut glowed like a traffic cone. Pull the map toward a
            // weathered timber: darker, less red (the tint multiplies the map)
            if (f.startsWith('kenney-')) mm.color.setRGB(0.62, 0.58, 0.55)
          }
        }
      })
      registerWarmRoot(gltf.scene)
      this.models.set(f, gltf.scene)
    }))
  }

  /** a fresh clone of a kit model, normalised so its base sits at y=0 and it is `height` m tall
   *  (or, with `width`, that wide) */
  instance(file: string, size: { height?: number; width?: number } = {}): THREE.Group {
    const src = this.models.get(file)
    if (!src) throw new Error(`kit model ${file} not loaded`)
    const g = src.clone(true)
    const box = new THREE.Box3().setFromObject(g)
    const ext = box.getSize(new THREE.Vector3())
    const s = size.height ? size.height / (ext.y || 1) : size.width ? size.width / (Math.max(ext.x, ext.z) || 1) : 1
    g.scale.setScalar(s)
    g.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s)
    const wrap = new THREE.Group()
    wrap.add(g)
    return wrap
  }

  /** Render every item's model into a 96×96 sprite (data URL). */
  captureIcons(renderer: THREE.WebGLRenderer): void {
    const S = 96
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const key = new THREE.DirectionalLight(0xfff4e4, 3.2)
    key.position.set(1.2, 2.0, 1.6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xc4d4ff, 1.4)
    fill.position.set(-1.5, 0.6, -1)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 1.2)
    rim.position.set(0, 1.5, -2.5)
    scene.add(rim)
    const cam = new THREE.OrthographicCamera(-0.72, 0.72, 0.72, -0.72, 0.1, 50)
    const rt = new THREE.WebGLRenderTarget(S, S, { format: THREE.RGBAFormat })
    const prevTarget = renderer.getRenderTarget()
    const prevColor = new THREE.Color()
    renderer.getClearColor(prevColor)
    const prevAlpha = renderer.getClearAlpha()
    const prevTone = renderer.toneMapping
    const prevExp = renderer.toneMappingExposure
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.35
    renderer.setClearColor(0x000000, 0)
    const pixels = new Uint8Array(S * S * 4)
    const canvas = document.createElement('canvas')
    canvas.width = S; canvas.height = S
    const ctx = canvas.getContext('2d')!
    for (const [id, file] of Object.entries(ITEM_MODEL) as [ItemId, string][]) {
      const src = this.models.get(file)
      if (!src) continue
      const frame = ICON_FRAME[id] ?? {}
      const model = src.clone(true)
      if (frame.tint !== undefined) {
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) o.material = new THREE.MeshStandardMaterial({ color: frame.tint, roughness: 0.85 })
        })
      } else if (frame.lift) {
        // a very dark model (the Quaternius spear/torch are near-black): brighten its colours for the sprite
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const m = (o.material as THREE.MeshStandardMaterial).clone()
            m.color.multiplyScalar(frame.lift!)
            if (m.map) { m.emissive = m.color.clone().multiplyScalar(0.25); m.emissiveMap = m.map }
            o.material = m
          }
        })
      }
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const ext = Math.max(size.x, size.y, size.z) || 1
      const k = (1.2 * (frame.zoom ?? 1)) / ext
      const holder = new THREE.Group()
      model.position.sub(center)
      model.position.y += (frame.dy ?? 0) * ext
      holder.add(model)
      holder.scale.setScalar(k)
      holder.rotation.y = frame.yaw ?? 0
      holder.rotation.x = frame.pitch ?? 0
      holder.rotation.z = frame.roll ?? 0
      scene.add(holder)
      cam.position.set(1.6, 1.25, 2.2)
      cam.lookAt(0, 0, 0)
      renderer.setRenderTarget(rt)
      renderer.clear()
      renderer.render(scene, cam)
      renderer.readRenderTargetPixels(rt, 0, 0, S, S, pixels)
      scene.remove(holder)
      const img = ctx.createImageData(S, S)
      for (let y = 0; y < S; y++) img.data.set(pixels.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4)
      ctx.putImageData(img, 0, 0)
      this.icons.set(id, canvas.toDataURL('image/png'))
    }
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevColor, prevAlpha)
    renderer.toneMapping = prevTone
    renderer.toneMappingExposure = prevExp
    rt.dispose()
  }
}
