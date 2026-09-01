// M2 art-direction test: one tier-A PBR raptor idling in a Quaternius low-poly
// forest, shot under 3 grades × 2 times of day → shots/artdir/.
//   node tools/artdir.mjs
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const OUT = 'shots/artdir'
mkdirSync(OUT, { recursive: true })

const MODELS = {
  'raptor.glb': 'public/models/dinos/Velociraptor.glb',
  'pine1.glb': 'public/models/_raw/nature/Pine1.glb',
  'tree1.glb': 'public/models/_raw/nature/Tree1.glb',
  'tree2.glb': 'public/models/_raw/nature/Tree2.glb',
  'tree3.glb': 'public/models/_raw/nature/Tree3.glb',
  'rock1.glb': 'public/models/_raw/nature/Rock1.glb',
  'rock2.glb': 'public/models/_raw/nature/Rock2.glb',
  'grass1.glb': 'public/models/_raw/nature/Grass1.glb',
  'bush1.glb': 'public/models/_raw/nature/Bush1.glb',
}

const VIEWER = `<!doctype html><meta charset="utf-8">
<style>body{margin:0}</style><canvas id="c"></canvas>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true })
renderer.setSize(1280, 720)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 400)
camera.position.set(6.5, 2.0, 9)
camera.lookAt(0, 1.2, 0)

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const load = (u) => loader.loadAsync(u)

// deterministic scatter
let seed = 42
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647

// ground: gently displaced grid (CircleGeometry fans from center → radial facet artifacts)
const gGeo = new THREE.PlaneGeometry(140, 140, 90, 90).rotateX(-Math.PI / 2)
const gPos = gGeo.attributes.position
for (let i = 0; i < gPos.count; i++) {
  const x = gPos.getX(i), z = gPos.getZ(i)
  if (Math.hypot(x, z) > 4) gPos.setY(i, Math.sin(x * 0.3) * Math.cos(z * 0.25) * 0.5)
}
gGeo.computeVertexNormals()
const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ color: 0x53764a, flatShading: true }))
scene.add(ground)

const [raptor, pine1, tree1, tree2, tree3, rock1, rock2, grass1, bush1] = await Promise.all(
  ['raptor','pine1','tree1','tree2','tree3','rock1','rock2','grass1','bush1'].map(n => load('/models/' + n + '.glb')))

// star of the show
const dino = raptor.scene
// normalize raptor to ~1.8m tall at origin
const rBox = new THREE.Box3().setFromObject(dino)
const rSize = rBox.getSize(new THREE.Vector3())
dino.scale.setScalar(1.8 / rSize.y)
const rBox2 = new THREE.Box3().setFromObject(dino)
dino.position.y -= rBox2.min.y
dino.rotation.y = Math.PI * 0.7
scene.add(dino)
const mixer = new THREE.AnimationMixer(dino)
const idle = raptor.animations.find(a => /idle/i.test(a.name)) ?? raptor.animations[0]
mixer.clipAction(idle).play()
mixer.setTime(0.8)

// kill the plasticky specular sheen on low-poly props
for (const g of [pine1, tree1, tree2, tree3, rock1, rock2, grass1, bush1]) {
  g.scene.traverse((o) => { if (o.material) { o.material.roughness = 1; o.material.metalness = 0 } })
}

// forest scatter: ring outside a clearing
const props = [
  [pine1, 10, 3.5, 6.5], [tree1, 8, 3, 5.5], [tree2, 7, 3, 5.5], [tree3, 7, 3, 6],
  [rock1, 6, 0.7, 1.6], [rock2, 6, 0.6, 1.4], [grass1, 40, 0.7, 1.3], [bush1, 10, 0.9, 1.6],
]
for (const [gltf, count, sMin, sMax] of props) {
  for (let i = 0; i < count; i++) {
    const o = gltf.scene.clone(true)
    const a = rand() * Math.PI * 2
    const r = 6 + rand() * 45
    o.position.set(Math.sin(a) * r, 0, Math.cos(a) * r)
    // keep the camera lane clearer
    if (o.position.z > 5 && Math.abs(o.position.x) < 5) o.position.x += 8
    const box = new THREE.Box3().setFromObject(o)
    const h = box.getSize(new THREE.Vector3()).y || 1
    o.scale.setScalar((sMin + rand() * (sMax - sMin)) / h)
    o.rotation.y = rand() * Math.PI * 2
    const b2 = new THREE.Box3().setFromObject(o)
    o.position.y -= b2.min.y
    scene.add(o)
  }
}

// lighting rig, rebuilt per look
let rig = []
function look(grade, time) {
  for (const l of rig) scene.remove(l)
  rig = []
  const add = (l) => { rig.push(l); scene.add(l); return l }

  const noon = time === 'noon'
  const sunPos = noon ? [30, 60, 20] : [45, 10, -30]

  if (grade === 'filmic') {
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = noon ? 1.0 : 0.9
    scene.background = new THREE.Color(noon ? 0x87b5d9 : 0xd9905e)
    scene.fog = new THREE.Fog(scene.background, 45, 160)
    add(new THREE.HemisphereLight(noon ? 0xbfd9ff : 0xe8b088, 0x4a5d3f, noon ? 1.0 : 1.1))
    const s = add(new THREE.DirectionalLight(noon ? 0xfff4e0 : 0xff9448, noon ? 2.6 : 2.8))
    s.position.set(...sunPos)
  } else if (grade === 'vivid') {
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = noon ? 1.25 : 1.1
    scene.background = new THREE.Color(noon ? 0x6fc0e8 : 0xe8793e)
    scene.fog = new THREE.Fog(scene.background, 40, 140)
    add(new THREE.HemisphereLight(noon ? 0x9fdcff : 0xffb066, 0x3f6b35, noon ? 1.3 : 1.3))
    const s = add(new THREE.DirectionalLight(noon ? 0xffedc4 : 0xff7a2e, noon ? 3.4 : 3.6))
    s.position.set(...sunPos)
    const rim = add(new THREE.DirectionalLight(noon ? 0x88bbff : 0xff5588, 0.8))
    rim.position.set(-20, 15, -25)
  } else { // flat
    renderer.toneMapping = THREE.NoToneMapping
    renderer.toneMappingExposure = 1.0
    scene.background = new THREE.Color(noon ? 0xa8d4e8 : 0xf0b490)
    scene.fog = new THREE.Fog(scene.background, 30, 110)
    add(new THREE.AmbientLight(0xffffff, noon ? 1.9 : 1.5))
    const s = add(new THREE.DirectionalLight(noon ? 0xfff8ee : 0xffc9a0, noon ? 1.1 : 1.0))
    s.position.set(...sunPos)
  }
  renderer.render(scene, camera)
}
window.look = look
window.ready = true
</script>`

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary' }
const threeRoot = resolve('node_modules/three')
const server = createServer((req, res) => {
  const url = req.url.split('?')[0]
  try {
    let body, type
    if (url === '/' || url === '/viewer.html') { body = VIEWER; type = 'text/html' }
    else if (url.startsWith('/models/')) { body = readFileSync(resolve(MODELS[url.slice(8)])); type = 'model/gltf-binary' }
    else if (url.startsWith('/three/')) {
      const p = join(threeRoot, url.slice(7))
      if (!p.startsWith(threeRoot)) throw new Error('escape')
      body = readFileSync(p); type = MIME[extname(p)] ?? 'application/octet-stream'
    } else throw new Error('404')
    res.writeHead(200, { 'content-type': type }); res.end(body)
  } catch { res.writeHead(404); res.end() }
})
await new Promise((ok) => server.listen(0, ok))
const port = server.address().port

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('viewer error:', e.message); process.exitCode = 1 })
await page.goto(`http://localhost:${port}/viewer.html`)
await page.waitForFunction('window.ready === true', null, { timeout: 60000 })

for (const grade of ['filmic', 'vivid', 'flat']) {
  for (const time of ['noon', 'golden']) {
    await page.evaluate(([g, t]) => window.look(g, t), [grade, time])
    await page.screenshot({ path: `${OUT}/${grade}-${time}.png` })
    console.log(`${OUT}/${grade}-${time}.png`)
  }
}
await browser.close()
server.close()
