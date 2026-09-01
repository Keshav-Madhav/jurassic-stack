// Turntable screenshots for a GLB: 4 angles + (if animated) a mid-clip pose.
//   node tools/turntable.mjs <file.glb> [outDir=shots/turntable]
// Serves the model over a throwaway localhost server, renders with three from
// node_modules via an inline ESM bundle (esbuild-free: three ships ESM, served
// straight from node_modules).
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { extname, basename, resolve, join } from 'node:path'
import { chromium } from 'playwright-core'

const file = process.argv[2]
const outDir = process.argv[3] ?? 'shots/turntable'
if (!file || !existsSync(file)) {
  console.error('usage: node tools/turntable.mjs <model.glb> [outDir]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' }

const VIEWER = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#3a4a3a}</style><canvas id="c"></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x3a4a3a)
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true })
renderer.setSize(720, 720)
renderer.toneMapping = THREE.ACESFilmicToneMapping
scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.6))
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2); sun.position.set(3, 5, 2); scene.add(sun)
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const gltf = await loader.loadAsync('/model.glb')
const obj = gltf.scene
scene.add(obj)
let mixer = null
if (gltf.animations.length) {
  mixer = new THREE.AnimationMixer(obj)
  mixer.clipAction(gltf.animations[0]).play()
}
const box = new THREE.Box3().setFromObject(obj)
const center = box.getCenter(new THREE.Vector3())
const radius = box.getSize(new THREE.Vector3()).length() * 0.65 || 1
window.shoot = (angleDeg, animT) => {
  if (mixer && animT != null) { mixer.setTime(animT) }
  const a = (angleDeg * Math.PI) / 180
  camera.position.set(center.x + Math.sin(a) * radius * 1.6, center.y + radius * 0.55, center.z + Math.cos(a) * radius * 1.6)
  camera.lookAt(center)
  renderer.render(scene, camera)
  return { clips: gltf.animations.map(c => c.name), dur: gltf.animations[0]?.duration ?? 0 }
}
window.ready = true
</script>`

const threeRoot = resolve('node_modules/three')
const server = createServer((req, res) => {
  const url = req.url.split('?')[0]
  try {
    let body, type
    if (url === '/' || url === '/viewer.html') { body = VIEWER; type = 'text/html' }
    else if (url === '/model.glb') { body = readFileSync(resolve(file)); type = 'model/gltf-binary' }
    else if (url.startsWith('/three/')) {
      const p = join(threeRoot, url.slice('/three/'.length))
      if (!p.startsWith(threeRoot)) throw new Error('path escape')
      body = readFileSync(p); type = MIME[extname(p)] ?? 'application/octet-stream'
    } else throw new Error('not found')
    res.writeHead(200, { 'content-type': type })
    res.end(body)
  } catch {
    res.writeHead(404); res.end()
  }
})
await new Promise((ok) => server.listen(0, ok))
const port = server.address().port

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 720, height: 720 } })
page.on('pageerror', (e) => { console.error('viewer error:', e.message); process.exitCode = 1 })
await page.goto(`http://localhost:${port}/viewer.html`)
await page.waitForFunction('window.ready === true', null, { timeout: 30000 })

const name = basename(file).replace(/\.(glb|gltf)$/i, '')
let meta = null
for (const angle of [0, 90, 180, 270]) {
  meta = await page.evaluate((a) => window.shoot(a, 0), angle)
  await page.screenshot({ path: `${outDir}/${name}-${angle}.png` })
}
if (meta?.dur > 0) {
  await page.evaluate((t) => window.shoot(45, t), meta.dur / 2)
  await page.screenshot({ path: `${outDir}/${name}-anim.png` })
}
console.log(`${name}: ${meta?.clips.length ?? 0} clips [${meta?.clips.join(', ') ?? ''}] → ${outDir}/${name}-*.png`)

await browser.close()
server.close()
