// Navmesh bake: recast/detour over the baked heightmap, exported for runtime,
// PLUS the reachability validator — a path must exist from spawn to every
// ruin site, or the bake fails (the sculpt pass must never wall off the arc).
//   node tools/bake-navmesh.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { init as initRecast, exportNavMesh, NavMeshQuery } from 'recast-navigation'
import { generateTiledNavMesh } from '@recast-navigation/generators'

await initRecast()

import { readWorld } from './world-io.mjs'
const { meta, grid } = readWorld()
const { side, res, scale, half, sea } = meta

// terrain mesh at bake resolution (2 m) — same data the game renders/collides
const STEP = 2 // sample every grid cell (2 m)
const vside = Math.floor((side - 1) / STEP) + 1
const positions = new Float32Array(vside * vside * 3)
for (let iz = 0; iz < vside; iz++) {
  for (let ix = 0; ix < vside; ix++) {
    const gx = ix * STEP
    const gz = iz * STEP
    const o = (iz * vside + ix) * 3
    positions[o] = -half + gx * res
    positions[o + 1] = grid[gz * side + gx] * scale
    positions[o + 2] = -half + gz * res
  }
}
const indices = new Uint32Array((vside - 1) * (vside - 1) * 6)
let w = 0
for (let iz = 0; iz < vside - 1; iz++) {
  for (let ix = 0; ix < vside - 1; ix++) {
    const a = iz * vside + ix
    const b = a + 1
    const c = a + vside
    const d = c + 1
    indices[w++] = a; indices[w++] = c; indices[w++] = b
    indices[w++] = b; indices[w++] = c; indices[w++] = d
  }
}

console.time('navmesh')
const { success, navMesh } = generateTiledNavMesh(positions, indices, {
  cs: 1.2,
  ch: 0.25,
  tileSize: 128,
  walkableSlopeAngle: 50,
  walkableRadius: Math.ceil(0.5 / 1.2),
  walkableHeight: Math.ceil(1.9 / 0.25),
  walkableClimb: Math.ceil(0.7 / 0.25),
  minRegionArea: 8,
  mergeRegionArea: 20,
})
console.timeEnd('navmesh')
if (!success) {
  console.error('NAVMESH FAIL: generation failed')
  process.exit(1)
}

// ---------- reachability validation ----------
// 4 km paths need a deep A* node pool: the default ran out mid-island and
// reported reachable sites as "stops short"
const query = new NavMeshQuery(navMesh, { maxNodes: 65535 })
const HALF_EXT = { x: 8, y: 30, z: 8 }
const start = { x: meta.spawn.x, y: 3, z: meta.spawn.z }
let failed = false
// Every ruin site must be walkable from spawn. The volcano SUMMIT is
// deliberately NOT here: the cone's upper flanks exceed walkable slope, so the
// crater is sealed until M8's caldera door opens — the arc's final gate is
// enforced by geometry, not just scripting. (Verified unreachable 2026-09-02.)
const targets = meta.ruinSites.map((r) => ({ name: r.tag, x: r.x, y: r.y, z: r.z }))
for (const t of targets) {
  const { success: ok, path } = query.computePath(start, { x: t.x, y: t.y, z: t.z }, { halfExtents: HALF_EXT })
  if (!ok || !path || path.length === 0) {
    console.error(`REACHABILITY FAIL: no path spawn → ${t.name} (${t.x},${t.z})`)
    failed = true
    continue
  }
  const end = path[path.length - 1]
  const gap = Math.hypot(end.x - t.x, end.z - t.z)
  if (gap > 20) {
    console.error(`REACHABILITY FAIL: path to ${t.name} stops ${gap.toFixed(0)}m short, at (${end.x.toFixed(0)},${end.z.toFixed(0)})`)
    failed = true
  } else {
    console.log(`PASS spawn → ${t.name}: ${path.length} waypoints`)
  }
}
if (failed) process.exit(1)

const data = exportNavMesh(navMesh)
writeFileSync('public/world/navmesh.bin', Buffer.from(data))
console.log(`navmesh: ${(data.byteLength / 1024).toFixed(0)} KB → public/world/navmesh.bin`)
