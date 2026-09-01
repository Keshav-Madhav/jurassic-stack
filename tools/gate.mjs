// Asset intake gate — no model enters src/ or public/models without passing this.
//   node tools/gate.mjs <file.glb|.gltf> [...more files]
//   node tools/gate.mjs public/models/_raw/**/*.glb
//
// Reports per model: tris, bones, animation clips (+durations), texture sizes,
// material count, file size. Exits non-zero if any FAIL threshold is hit.
// Thresholds are intake sanity bounds, not final budgets (final budgets are
// enforced after the gltf-transform pass).
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { statSync } from 'node:fs'

const LIMITS = {
  maxTris: 250_000,      // beyond this even decimation is a project
  maxBones: 120,
  maxTextureDim: 4096,
  maxFileMB: 100,
  warnTris: 30_000,      // above tier-(a) game-ready budget → decimate
  warnBones: 40,         // above skinned-crowd LOD0 budget
  warnTextureDim: 2048,
  minClips: 1,           // rigged-but-unanimated → needs clip authoring
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node tools/gate.mjs <model.glb> [...]')
  process.exit(2)
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
let anyFail = false

for (const file of files) {
  const notes = []
  const fail = (m) => { notes.push(`FAIL ${m}`); anyFail = true }
  const warn = (m) => notes.push(`warn ${m}`)

  let doc
  try {
    doc = await io.read(file)
  } catch (e) {
    console.log(`\n=== ${file}\n  FAIL unreadable: ${e.message}`)
    anyFail = true
    continue
  }
  const root = doc.getRoot()

  let tris = 0
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices()
      const pos = prim.getAttribute('POSITION')
      const count = idx ? idx.getCount() : pos ? pos.getCount() : 0
      if (prim.getMode() === 4 /* TRIANGLES */) tris += count / 3
    }
  }
  tris = Math.round(tris)

  const bones = new Set()
  for (const skin of root.listSkins()) for (const j of skin.listJoints()) bones.add(j)
  const clips = root.listAnimations().map((a) => {
    let dur = 0
    for (const sampler of a.listSamplers()) {
      const input = sampler.getInput()
      if (input) dur = Math.max(dur, input.getMax([0])[0] ?? 0)
    }
    return { name: a.getName() || '(unnamed)', dur: +dur.toFixed(2) }
  })

  const textures = root.listTextures().map((t) => {
    const size = t.getSize() // [w, h] or null
    const bytes = t.getImage()?.byteLength ?? 0
    return { name: t.getName() || t.getURI() || '(embedded)', size, kb: Math.round(bytes / 1024) }
  })

  const fileMB = +(statSync(file).size / 1024 / 1024).toFixed(1)

  if (tris > LIMITS.maxTris) fail(`tris ${tris} > ${LIMITS.maxTris}`)
  else if (tris > LIMITS.warnTris) warn(`tris ${tris} — decimate before use (tier-b)`)
  if (bones.size > LIMITS.maxBones) fail(`bones ${bones.size} > ${LIMITS.maxBones}`)
  else if (bones.size > LIMITS.warnBones) warn(`bones ${bones.size} — over LOD0 crowd budget (${LIMITS.warnBones})`)
  if (bones.size === 0) warn('no skin — static mesh')
  if (clips.length < LIMITS.minClips) warn('no animation clips — needs clip authoring')
  for (const t of textures) {
    const dim = Math.max(...(t.size ?? [0, 0]))
    if (dim > LIMITS.maxTextureDim) fail(`texture ${t.name} ${dim}px > ${LIMITS.maxTextureDim}`)
    else if (dim > LIMITS.warnTextureDim) warn(`texture ${t.name} ${dim}px — downscale in transform pass`)
  }
  if (fileMB > LIMITS.maxFileMB) fail(`file ${fileMB}MB > ${LIMITS.maxFileMB}MB`)

  console.log(`\n=== ${file}`)
  console.log(`  file: ${fileMB} MB · tris: ${tris} · bones: ${bones.size} · materials: ${root.listMaterials().length}`)
  console.log(`  clips (${clips.length}): ${clips.map((c) => `${c.name} ${c.dur}s`).join(' · ') || '—'}`)
  console.log(`  textures (${textures.length}): ${textures.map((t) => `${t.name} ${t.size ? t.size.join('x') : '?'} ${t.kb}KB`).join(' · ') || '—'}`)
  console.log(`  verdict: ${notes.length ? notes.join(' | ') : 'PASS'}`)
}

process.exit(anyFail ? 1 : 0)
