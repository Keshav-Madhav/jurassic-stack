// A contact sheet of GLBs: each rendered once, three-quarter view, lit like
// the world, into one PNG grid — for picking assets by eye at intake.
//   node tools/contact-sheet.mjs out.png a.glb b.glb …
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
const [out, ...files] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto('http://localhost:4173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction('window.__g && window.__g.ready === true', null, { timeout: 60000 })
const models = files.map((f) => ({ name: basename(f, '.glb'), b64: readFileSync(f).toString('base64') }))
const dataUrl = await page.evaluate(async (models) => {
  const THREE = window.__g.THREE
  const { GLTFLoader } = window.__g.loaders
  const renderer = window.__g.renderer
  const S = 220, cols = 5, rows = Math.ceil(models.length / cols)
  const canvas = document.createElement('canvas'); canvas.width = S * cols; canvas.height = (S + 22) * rows
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2a3a48'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 0.8))
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2); key.position.set(1.2, 2, 1.6); scene.add(key)
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.7); fill.position.set(-1.5, 0.6, -1); scene.add(fill)
  const cam = new THREE.OrthographicCamera(-0.75, 0.75, 0.75, -0.75, 0.1, 50); cam.position.set(1.6, 1.3, 2.2); cam.lookAt(0, 0, 0)
  const rt = new THREE.WebGLRenderTarget(S, S)
  const px = new Uint8Array(S * S * 4)
  const loader = new GLTFLoader()
  if (window.__g.loaders.MeshoptDecoder) loader.setMeshoptDecoder(window.__g.loaders.MeshoptDecoder)
  const prevTM = renderer.toneMapping, prevExp = renderer.toneMappingExposure
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1
  renderer.setClearColor(0x2a3a48, 1)
  for (let i = 0; i < models.length; i++) {
    const m = models[i]
    const bytes = Uint8Array.from(atob(m.b64), (c) => c.charCodeAt(0))
    const gltf = await new Promise((res, rej) => loader.parse(bytes.buffer, '', res, rej))
    const root = gltf.scene
    const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3())
    const ext = Math.max(size.x, size.y, size.z) || 1
    root.position.sub(c); root.scale.multiplyScalar(1.25 / ext); root.position.multiplyScalar(1.25 / ext)
    scene.add(root)
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam)
    renderer.readRenderTargetPixels(rt, 0, 0, S, S, px)
    scene.remove(root)
    const img = ctx.createImageData(S, S)
    for (let y = 0; y < S; y++) img.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4)
    const cx = (i % cols) * S, cy = Math.floor(i / cols) * (S + 22)
    ctx.putImageData(img, cx, cy)
    ctx.fillStyle = '#fff'; ctx.font = '13px monospace'; ctx.fillText(m.name, cx + 6, cy + S + 15)
  }
  renderer.setRenderTarget(null); renderer.toneMapping = prevTM; renderer.toneMappingExposure = prevExp
  return canvas.toDataURL('image/png')
}, models)
const { writeFileSync } = await import('node:fs')
writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
console.log(out)
await browser.close()
