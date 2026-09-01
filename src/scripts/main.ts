import * as THREE from 'three'

// Boot scene: proves the toolchain (tsc + vite + three) end to end.
// Everything here is placeholder; real systems land per CHECKLIST.md.

const app = document.getElementById('app')!
const status = document.getElementById('status')!

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87b5d9)
scene.fog = new THREE.Fog(0x87b5d9, 40, 160)

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500)
camera.position.set(0, 6, 14)
camera.lookAt(0, 1, 0)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
app.appendChild(renderer.domElement)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x54713f, 1.2))
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4)
sun.position.set(40, 60, 25)
scene.add(sun)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(80, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x5e8c4f, flatShading: true })
)
scene.add(ground)

// Placeholder inhabitant until the first real dino clears the intake gate.
const placeholder = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 1.2, 2.6),
  new THREE.MeshStandardMaterial({ color: 0xc0563e, flatShading: true })
)
placeholder.position.y = 1.4
scene.add(placeholder)

status.textContent = `jurassic-stack boot OK · three r${THREE.REVISION}`

const clock = new THREE.Clock()
function loop() {
  requestAnimationFrame(loop)
  if (document.hidden) return
  const t = clock.getElapsedTime()
  placeholder.rotation.y = t * 0.5
  placeholder.position.y = 1.4 + Math.sin(t * 2) * 0.15
  renderer.render(scene, camera)
}
loop()
