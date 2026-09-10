// Navmesh bake: recast/detour over the baked heightmap, exported for runtime,
// PLUS the reachability validator — a path must exist from spawn to every
// ruin site, or the bake fails (the sculpt pass must never wall off the arc).
//   node tools/bake-navmesh.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { init as initRecast, exportNavMesh, NavMeshQuery } from 'recast-navigation'
import { generateTiledNavMesh } from '@recast-navigation/generators'

await initRecast()

import { readWorld } from './world-io.mjs'
import { RAVINE, SHELVES, shoreDist, distToPath } from './hand-geometry.mjs'
const { meta, grid } = readWorld()
const CRATER = SHELVES.find((s) => s.name === 'crater')
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
// The volcano's cone (inside 330 m of the vent) is left OUT of the input: it
// is unreachable by design (M8's gate is the way in), and its rippled flanks
// fragmented into so many polygons that the whole volcano TILE failed
// ("Failed to create Detour navmesh data") and vanished — taking the gate's
// apron at its foot with it. The sea floor is left out too.
const VENT = meta.volcano
const skipVertex = (i) => {
  const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
  if (y < -1.5) return true
  if (Math.hypot(x - VENT.x, z - VENT.z) >= 330) return false
  // inside the cone only the Ravine's floor and the crater bench are walkable
  if (distToPath(x, z, RAVINE.path).d < RAVINE.halfWidth + 3) return false
  if (CRATER && shoreDist(x, z, CRATER.shore) < 4) return false
  return true
}
const tmp = []
for (let iz = 0; iz < vside - 1; iz++) {
  for (let ix = 0; ix < vside - 1; ix++) {
    const a = iz * vside + ix
    const b = a + 1
    const c = a + vside
    const d = c + 1
    if (skipVertex(a) && skipVertex(b) && skipVertex(c) && skipVertex(d)) continue
    tmp.push(a, c, b, b, c, d)
  }
}
const indices = new Uint32Array(tmp)

console.time('navmesh')
const { success, navMesh } = generateTiledNavMesh(positions, indices, {
  cs: Number(process.env.NAV_CS ?? 1.2),
  ch: Number(process.env.NAV_CH ?? 0.25),
  tileSize: 256, // bigger tiles → more polys allowed per tile (the id space is 22 bits shared between tiles and polys)
  walkableSlopeAngle: Number(process.env.NAV_SLOPE ?? 50),
  walkableRadius: Math.ceil(0.5 / 1.2),
  walkableHeight: Math.ceil(1.9 / 0.25),
  // WALKABLE CLIMB IS A SLOPE CAP IN DISGUISE (M75). Recast connects two
  // neighbouring voxel columns only if their tops differ by less than this,
  // so on a CONTINUOUS slope it caps the gradient at atan(climb / cs) — with
  // 1.0 against cs 1.2 that is 39.8°, tighter than the walkableSlopeAngle of
  // 50 that was supposed to govern. The whole alpine world was unreachable
  // because of it, and no amount of reshaping the mountains touched it:
  // raising walkableSlopeAngle to 65 changed the coverage by nothing at all,
  // while raising this to 2.0 took the island from 83% to 92%.
  // 1.5 m = cs × tan(50°), so the slope angle is now the thing that governs.
  walkableClimb: Math.ceil(Number(process.env.NAV_CLIMB ?? 1.5) / Number(process.env.NAV_CH ?? 0.25)),
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
// NAV_PROBE="x,z;x,z" adds throwaway targets (height read from the grid) — for finding where a corridor breaks
if (process.env.NAV_PROBE) {
  for (const s of process.env.NAV_PROBE.split(';')) {
    const [x, z] = s.split(',').map(Number)
    targets.push({ name: `probe(${x},${z})`, x, y: grid[Math.round((z + half) / res) * side + Math.round((x + half) / res)] * scale, z })
  }
}
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
// ---------- WHAT SHARE OF THE ISLAND CAN ANYTHING ACTUALLY REACH? (M74)
//
// The reachability validator only ever asked about the ~24 ruin sites, and
// they all passed, so nothing ever reported that the ANSWER ELSEWHERE was
// mostly "no". Measured this round: of fourteen well-spread high points that
// a slope-only flood fill called walkable, recast admits exactly ONE — the
// crater bench, and only because the Ravine was carved to it. Both mountain
// ranges are navmesh voids: no polygons at all, so no path, no dino, no
// player route. The keystones are all under 92 m on a map whose peaks pass
// 400 because the lowlands are all there is to place them in.
//
// That was invisible for seventy rounds because nothing counted it. This
// samples the island on a 32 m lattice and reports the reachable share by
// altitude band, so the next bake that walls something off says so.
{
  const STEP = 32
  const bands = [[0, 25], [25, 50], [50, 100], [100, 150], [150, 250], [250, 999]]
  const tally = bands.map(() => ({ land: 0, ok: 0 }))
  for (let z = -half; z <= half; z += STEP) {
    for (let x = -half; x <= half; x += STEP) {
      const h = grid[Math.round((z + half) / res) * side + Math.round((x + half) / res)] * scale
      if (h < 1) continue // sea
      const bi = bands.findIndex(([lo, hi]) => h >= lo && h < hi)
      if (bi < 0) continue
      tally[bi].land++
      // a polygon within 8 m horizontally is the same test the validator uses
      const { success: near } = query.findClosestPoint({ x, y: h, z }, { halfExtents: HALF_EXT })
      if (near) tally[bi].ok++
    }
  }
  // NB this counts whether a polygon EXISTS under a sample, not whether it
  // is connected to spawn — one computePath per sample would cost minutes.
  // Presence is the generous reading, so the true figure is worse, and the
  // alpine bands are damning even so.
  console.log('\nland with navmesh under it, by altitude (32 m lattice):')
  let tl = 0, tk = 0
  for (let i = 0; i < bands.length; i++) {
    const { land, ok } = tally[i]
    if (!land) continue
    tl += land; tk += ok
    const pct = Math.round((ok / land) * 100)
    const bar = '#'.repeat(Math.round(pct / 5)).padEnd(20, '.')
    console.log(`  ${String(bands[i][0]).padStart(3)}-${String(bands[i][1] === 999 ? '+' : bands[i][1]).padEnd(3)} m  ${bar} ${String(pct).padStart(3)}%  (${ok}/${land} samples)`)
  }
  console.log(`  island total: ${Math.round((tk / tl) * 100)}% of dry land has navmesh under it`)
}

// written even when reachability fails, so the failing mesh can be probed
// (a stale navmesh.bin sent one debugging session down the wrong hole)
const data = exportNavMesh(navMesh)
writeFileSync('public/world/navmesh.bin', Buffer.from(data))
console.log(`navmesh: ${(data.byteLength / 1024).toFixed(0)} KB → public/world/navmesh.bin${failed ? ' (REACHABILITY FAILED — probe it)' : ''}`)
if (failed) process.exit(1)
