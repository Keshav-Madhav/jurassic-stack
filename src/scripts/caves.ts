// The caves (PLAN beat 4, M51): three dark places you walk down into.
//
// A heightmap cannot have an overhang, so the island's terrain provides the
// floor, the walls and the way in — a bowl carved into a hillside with a
// throat ramping down to it (tools/hand-geometry.mjs CAVES) — and this file
// provides the one thing terrain cannot: A ROOF.
//
// The shell is a dome over the chamber plus a barrel vault over the throat,
// both built from the world's own triplanar rock material (stone-material.ts)
// so a cave wall is the same stone as a cliff. Both are drawn from the INSIDE
// (BackSide), which means they never occlude you from outside and you can see
// the mouth as a hole in the hill rather than a lump on it.
//
// Darkness comes free: M47's baked sky view already darkens a deep bowl, and
// the roof takes the sun off the rest. The torch stops being decoration.
import * as THREE from 'three'
import { heightAt, worldMeta } from './heightmap'
import { makeStone } from './stone-material'

export interface CaveDef {
  name: string
  mouth: { x: number; z: number }
  into: { x: number; z: number }
  reach: number
  radius: number
  mouthY: number
  floorY: number
  bakedMouthY: number
  bakedFloorY: number
  keystone: boolean
}

/** how far above the floor the ceiling sits at the chamber's middle */
const HEAD = 11
/** the throat's clear height */
const THROAT_HEAD = 6.5

export class Caves {
  readonly group = new THREE.Group()
  readonly defs: CaveDef[] = []
  private mat: THREE.MeshStandardMaterial

  constructor() {
    // the same rock as the cliffs, a shade darker: a cave should read as the
    // inside of the hill you just walked into
    this.mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.34, 0.32, 0.3),
      roughness: 0.97,
      metalness: 0,
      side: THREE.BackSide,
    })
    makeStone(this.mat, { metresPerTile: 3.4, gain: 1.9 })
  }

  build(): void {
    const caves = (worldMeta as unknown as { caves?: CaveDef[] } | null)?.caves
    if (!caves?.length) return
    for (const c of caves) {
      this.defs.push(c)
      this.group.add(this.shell(c))
    }
  }

  /** the roof over one cave: a dome on the chamber, a vault down the throat */
  private shell(c: CaveDef): THREE.Group {
    const g = new THREE.Group()
    const cx = c.mouth.x + c.into.x * c.reach
    const cz = c.mouth.z + c.into.z * c.reach
    const floor = c.bakedFloorY

    // THE DOME. A hemisphere squashed to the chamber's proportions, its rim
    // sunk a little under the bowl's lip so there is never a crack of daylight
    // where the two meet.
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), this.mat)
    dome.scale.set(c.radius + 6, HEAD, c.radius + 6)
    dome.position.set(cx, floor - 1.2, cz)
    dome.castShadow = true // it is the hill's underside: the sun stops here
    dome.receiveShadow = true
    g.add(dome)

    // THE VAULT over the throat: a half-cylinder from just outside the mouth
    // to the chamber, following the ramp down. Built as a strip so it can
    // FOLLOW THE FLOOR — a straight tube would bury itself in the ramp at one
    // end and float at the other.
    const from = new THREE.Vector3(c.mouth.x - c.into.x * 6, 0, c.mouth.z - c.into.z * 6)
    const to = new THREE.Vector3(cx, 0, cz)
    const steps = 14
    const arc = 10
    const pos: number[] = []
    const idxs: number[] = []
    const right = new THREE.Vector3(-c.into.z, 0, c.into.x).normalize()
    const halfW = 9
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const p = from.clone().lerp(to, t)
      const ground = heightAt(p.x, p.z)
      // the vault's clear height eases into the dome's at the inner end
      const head = THREE.MathUtils.lerp(THROAT_HEAD, HEAD * 0.92, THREE.MathUtils.smoothstep(t, 0.55, 1))
      for (let a = 0; a <= arc; a++) {
        const u = a / arc
        const ang = Math.PI * u
        const ox = Math.cos(ang) * halfW
        const oy = Math.sin(ang) * head
        pos.push(p.x + right.x * ox, ground + oy - 0.8, p.z + right.z * ox)
      }
    }
    const per = arc + 1
    for (let s = 0; s < steps; s++) {
      for (let a = 0; a < arc; a++) {
        const i0 = s * per + a
        idxs.push(i0, i0 + 1, i0 + per, i0 + 1, i0 + per + 1, i0 + per)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idxs)
    geo.computeVertexNormals()
    const vault = new THREE.Mesh(geo, this.mat)
    vault.castShadow = true
    vault.receiveShadow = true
    g.add(vault)
    return g
  }

  /** Which cave the point is inside, if any (the game asks: is it dark here?) */
  inside(x: number, z: number): CaveDef | null {
    for (const c of this.defs) {
      const cx = c.mouth.x + c.into.x * c.reach
      const cz = c.mouth.z + c.into.z * c.reach
      if (Math.hypot(x - cx, z - cz) < c.radius + 4) return c
      // the throat counts too: it is under the vault
      const ax = c.mouth.x - c.into.x * 6, az = c.mouth.z - c.into.z * 6
      const dx = cx - ax, dz = cz - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
      if (t > 0.08 && Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 8) return c
    }
    return null
  }

  /** QA */
  debug(): { name: string; mouth: number[]; floorY: number; keystone: boolean }[] {
    return this.defs.map((c) => ({ name: c.name, mouth: [c.mouth.x, c.mouth.z], floorY: c.bakedFloorY, keystone: c.keystone }))
  }
}
