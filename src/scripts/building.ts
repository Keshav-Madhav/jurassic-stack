// Socket-snap building: foundations (3×3 m) snap level to terrain and edge-
// chain to each other; walls snap to foundation edges; ceilings cap walls or
// extend from supported ceilings. Ghost preview shows validity by color.
// Placed pieces get static Rapier cuboids. Deliberately minimal but honest —
// the M4 gate builds a hut with it.
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { heightAt } from './heightmap'
import type { Physics } from './physics'
import type { ItemId } from './items'
import type { Kit } from './kit'
import { ITEM_MODEL } from './kit'
import type { Emitter, LightRig } from './lights'

export const CELL = 3
const WALL_H = 3

export type PieceKind = 'foundation' | 'wall' | 'ceiling' | 'campfire' | 'torch'

export interface Piece {
  kind: PieceKind
  /** grid coords: gx/gz in CELL units; level 0 = ground floor */
  gx: number
  gz: number
  level: number
  /** walls only: which edge of the cell (0=N -z, 1=E +x, 2=S +z, 3=W -x) */
  edge: number
  /** world y of the piece base */
  baseY: number
}

function emberTexture(): THREE.CanvasTexture {
  const S = 32
  const c = document.createElement('canvas')
  c.width = S; c.height = S
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(c)
}

function flameTexture(): THREE.CanvasTexture {
  const S = 64
  const c = document.createElement('canvas')
  c.width = S; c.height = S * 2
  const g = c.getContext('2d')!
  g.translate(S / 2, 0); g.scale(0.45, 1); g.translate(-S / 2, 0)
  const grad = g.createRadialGradient(S / 2, S * 1.45, 2, S / 2, S * 1.1, S * 0.95)
  grad.addColorStop(0, 'rgba(255,245,200,1)')
  grad.addColorStop(0.25, 'rgba(255,170,60,0.95)')
  grad.addColorStop(0.55, 'rgba(240,80,20,0.55)')
  grad.addColorStop(1, 'rgba(120,20,0,0)')
  g.fillStyle = grad
  g.fillRect(-S, 0, S * 3, S * 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const GHOST_OK = new THREE.Color(0x4dc06a)
const GHOST_BAD = new THREE.Color(0xd0483e)

export class Building {
  readonly group = new THREE.Group()
  readonly pieces: Piece[] = []
  private keys = new Set<string>()
  private ghost: THREE.Mesh
  private ghostMat: THREE.MeshStandardMaterial
  private colliders: RAPIER.Collider[] = []
  /** Every fire is an emitter; the LightRig gives the three nearest an actual
   *  point light (M31 / PERFORMANCE.md lever A). Before that this class owned
   *  a pool of 8 real lights and the 9th fire burned dark — now the count is
   *  unlimited and the per-pixel cost is fixed. */
  private fires: { emitter: Emitter | null; flame: THREE.Mesh; embers: THREE.Points; base: number; kind: PieceKind }[] = []
  private flameMat = new THREE.MeshBasicMaterial({ map: flameTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  private emberMat = new THREE.PointsMaterial({ color: 0xffa040, size: 0.11, map: emberTexture(), alphaTest: 0.05, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  private t = 0

  constructor(private physics: Physics, private kit: Kit | null = null, private lights: LightRig | null = null) {
    this.ghostMat = new THREE.MeshStandardMaterial({
      color: GHOST_OK, transparent: true, opacity: 0.45, depthWrite: false,
    })
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat)
    this.ghost.visible = false
    this.group.add(this.ghost)
  }

  private key(p: Piece): string {
    return `${p.kind}:${p.gx},${p.gz},${p.level}${p.kind === 'wall' ? ',' + p.edge : ''}`
  }

  /** Compute the snapped candidate for the aim point; null = nothing sensible. */
  candidate(kind: PieceKind, aim: THREE.Vector3): { piece: Piece; valid: boolean } | null {
    const gx = Math.round(aim.x / CELL)
    const gz = Math.round(aim.z / CELL)

    if (kind === 'foundation' || kind === 'campfire' || kind === 'torch') {
      const cx = gx * CELL
      const cz = gz * CELL
      // a fire or torch on a foundation/ceiling sits on it, else on the ground
      const under = this.pieceAt('ceiling', gx, gz, 0) ?? this.pieceAt('foundation', gx, gz, 0)
      const ground = under ? under.baseY + (under.kind === 'foundation' ? 0.35 : 0.25) : heightAt(cx, cz)
      const p: Piece = { kind, gx, gz, level: 0, edge: 0, baseY: ground }
      if (kind === 'campfire' || kind === 'torch') {
        return { piece: p, valid: !this.keys.has(this.key(p)) }
      }
      // foundation: flat-enough ground, or edge-adjacent to an existing one
      const corners = [
        heightAt(cx - CELL / 2, cz - CELL / 2), heightAt(cx + CELL / 2, cz - CELL / 2),
        heightAt(cx - CELL / 2, cz + CELL / 2), heightAt(cx + CELL / 2, cz + CELL / 2),
      ]
      const spread = Math.max(...corners) - Math.min(...corners)
      const neighbor = this.foundationNeighbor(gx, gz)
      if (neighbor) p.baseY = neighbor.baseY // chain level with the neighbor
      else p.baseY = Math.max(...corners) - 0.15
      const valid = !this.keys.has(this.key(p)) && (spread < 1.4 || neighbor !== null)
      return { piece: p, valid }
    }

    if (kind === 'wall') {
      // nearest foundation/ceiling cell, nearest edge to the aim point
      const base = this.pieceAt('foundation', gx, gz, 0) ?? this.pieceAt('ceiling', gx, gz, 0)
      const cx = gx * CELL
      const cz = gz * CELL
      const dxe = aim.x - cx
      const dze = aim.z - cz
      const edge = Math.abs(dxe) > Math.abs(dze) ? (dxe > 0 ? 1 : 3) : dze > 0 ? 2 : 0
      const level = base?.kind === 'ceiling' ? 1 : 0
      const baseY = base ? base.baseY + (base.kind === 'ceiling' ? 0.2 : 0.2) : 0
      const p: Piece = { kind, gx, gz, level, edge, baseY }
      return { piece: p, valid: base !== null && !this.keys.has(this.key(p)) }
    }

    // ceiling: needs a wall touching this cell at level 0, or an adjacent ceiling
    const p: Piece = { kind, gx, gz, level: 0, edge: 0, baseY: 0 }
    const wall = this.pieces.find((q) => q.kind === 'wall' && q.gx === gx && q.gz === gz)
    const adj = this.ceilingNeighbor(gx, gz)
    const support = wall ?? adj
    if (support) p.baseY = support.kind === 'wall' ? support.baseY + WALL_H : support.baseY
    return { piece: p, valid: support != null && !this.keys.has(this.key(p)) }
  }

  /** Show/refresh the ghost for the held placeable; returns candidate validity. */
  updateGhost(kind: PieceKind | null, aim: THREE.Vector3 | null): boolean {
    if (!kind || !aim) {
      this.ghost.visible = false
      return false
    }
    const c = this.candidate(kind, aim)
    if (!c) {
      this.ghost.visible = false
      return false
    }
    this.ghost.visible = true
    this.applyTransform(this.ghost, c.piece)
    this.ghostMat.color = c.valid ? GHOST_OK : GHOST_BAD
    return c.valid
  }

  /** Place the current candidate. Returns the consumed item id or null. */
  place(kind: PieceKind, aim: THREE.Vector3): ItemId | null {
    const c = this.candidate(kind, aim)
    if (!c?.valid) return null
    this.commit(c.piece)
    return kind as ItemId
  }

  /** Instantiate a piece (used by both place() and save-file restore). */
  commit(p: Piece): void {
    this.pieces.push(p)
    this.keys.add(this.key(p))
    const { pos, size } = this.box(p)
    const mesh = this.kit ? this.kitMesh(p, size) : new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial({ color: 0x8a6a45 }))
    mesh.position.set(pos.x, p.baseY, pos.z)
    if (p.kind === 'wall') mesh.rotation.y = p.edge === 1 || p.edge === 3 ? Math.PI / 2 : 0
    this.group.add(mesh)
    if (p.kind === 'campfire' || p.kind === 'torch') this.lightFire(p)
    // static collider matching the piece's box (torches don't block: a stake)
    if (p.kind === 'torch') return
    this.colliders.push(
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(pos.x, pos.y, pos.z),
      ),
    )
  }

  private applyTransform(mesh: THREE.Mesh, p: Piece): void {
    const { pos, size } = this.box(p)
    mesh.position.copy(pos)
    mesh.scale.copy(size)
  }

  /** the kit model for a piece, sized to the piece's box */
  private kitMesh(p: Piece, size: THREE.Vector3): THREE.Object3D {
    const file = ITEM_MODEL[p.kind as ItemId]
    switch (p.kind) {
      case 'foundation': case 'ceiling': return this.kit!.instance(file, { width: CELL })
      case 'wall': return this.kit!.instance(file, { height: WALL_H })
      case 'campfire': return this.kit!.instance(file, { width: 1.3 })
      case 'torch': return this.kit!.instance(file, { height: 1.6 })
    }
    void size
    return this.kit!.instance(file, {})
  }

  /** a fire: flame cards, embers, and a pooled light while the pool lasts */
  private lightFire(p: Piece): void {
    const torch = p.kind === 'torch'
    const x = p.gx * CELL, z = p.gz * CELL
    const y = p.baseY + (torch ? 1.55 : 0.3)
    // (18 m / decay 2 barely lit the ground round the fire — M23; the colour is
    // less saturated than fire really is: at 0xff8a3c the timber went traffic-cone)
    const emitter = this.lights?.add({
      x, y: y + (torch ? 0.3 : 0.9), z,
      intensity: torch ? 70 : 160,
      distance: torch ? 22 : 34,
      decay: 1.6,
      color: 0xffa25a,
    }) ?? null
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(torch ? 0.5 : 1.6, torch ? 0.9 : 2.2), this.flameMat)
    flame.position.set(x, y + (torch ? 0.4 : 1.0), z)
    this.group.add(flame)
    const n = torch ? 10 : 26
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { pos[i * 3] = x + (Math.random() - 0.5) * 0.3; pos[i * 3 + 1] = y + Math.random() * 1.5; pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3 }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const embers = new THREE.Points(geo, this.emberMat)
    embers.frustumCulled = false
    this.group.add(embers)
    this.fires.push({ emitter, flame, embers, base: y, kind: p.kind })
  }

  /** flicker the fires; billboard the flames */
  update(dt: number, cam: THREE.Vector3): void {
    this.t += dt
    for (let i = 0; i < this.fires.length; i++) {
      const f = this.fires[i]
      const flick = 0.82 + 0.18 * Math.sin(this.t * 13.1 + i * 2.3) * Math.sin(this.t * 7.7 + i)
      if (f.emitter) f.emitter.intensity = (f.kind === 'torch' ? 70 : 160) * flick
      f.flame.rotation.y = Math.atan2(cam.x - f.flame.position.x, cam.z - f.flame.position.z)
      f.flame.scale.set(1 + 0.08 * Math.sin(this.t * 11 + i), 0.9 + 0.14 * flick, 1)
      const arr = f.embers.geometry.getAttribute('position') as THREE.BufferAttribute
      const a = arr.array as Float32Array
      const top = f.base + (f.kind === 'torch' ? 1.2 : 2.2)
      for (let k = 0; k < arr.count; k++) {
        a[k * 3 + 1] += (0.6 + (k % 3) * 0.25) * dt
        a[k * 3] += Math.sin(this.t * 2 + k) * 0.15 * dt
        if (a[k * 3 + 1] > top) a[k * 3 + 1] = f.base
      }
      arr.needsUpdate = true
    }
  }

  private box(p: Piece): { pos: THREE.Vector3; size: THREE.Vector3 } {
    const cx = p.gx * CELL
    const cz = p.gz * CELL
    switch (p.kind) {
      case 'foundation':
        return { pos: new THREE.Vector3(cx, p.baseY + 0.1, cz), size: new THREE.Vector3(CELL, 0.35, CELL) }
      case 'ceiling':
        return { pos: new THREE.Vector3(cx, p.baseY + 0.1, cz), size: new THREE.Vector3(CELL, 0.25, CELL) }
      case 'campfire':
        return { pos: new THREE.Vector3(cx, p.baseY + 0.25, cz), size: new THREE.Vector3(1.1, 0.5, 1.1) }
      case 'torch':
        return { pos: new THREE.Vector3(cx, p.baseY + 0.8, cz), size: new THREE.Vector3(0.2, 1.6, 0.2) }
      case 'wall': {
        const off = CELL / 2
        const horiz = p.edge === 0 || p.edge === 2
        const pos = new THREE.Vector3(
          cx + (p.edge === 1 ? off : p.edge === 3 ? -off : 0),
          p.baseY + WALL_H / 2,
          cz + (p.edge === 2 ? off : p.edge === 0 ? -off : 0),
        )
        return { pos, size: new THREE.Vector3(horiz ? CELL : 0.25, WALL_H, horiz ? 0.25 : CELL) }
      }
    }
  }

  private pieceAt(kind: PieceKind, gx: number, gz: number, level: number): Piece | null {
    return this.pieces.find((p) => p.kind === kind && p.gx === gx && p.gz === gz && p.level === level) ?? null
  }

  private foundationNeighbor(gx: number, gz: number): Piece | null {
    return (
      this.pieceAt('foundation', gx + 1, gz, 0) ??
      this.pieceAt('foundation', gx - 1, gz, 0) ??
      this.pieceAt('foundation', gx, gz + 1, 0) ??
      this.pieceAt('foundation', gx, gz - 1, 0)
    )
  }

  private ceilingNeighbor(gx: number, gz: number): Piece | null {
    return (
      this.pieceAt('ceiling', gx + 1, gz, 0) ??
      this.pieceAt('ceiling', gx - 1, gz, 0) ??
      this.pieceAt('ceiling', gx, gz + 1, 0) ??
      this.pieceAt('ceiling', gx, gz - 1, 0)
    )
  }

  serialize(): Piece[] {
    return this.pieces.map((p) => ({ ...p }))
  }

  count(): number {
    return this.pieces.length
  }

  /** every lit fire's position, for the crackle (sfx.ts) */
  firePositions(): { x: number; y: number; z: number }[] {
    return this.fires.map((f) => ({ x: f.flame.position.x, y: f.base, z: f.flame.position.z }))
  }

  /** Is there a campfire within `r` of (x, z)? (cooking.)
   *  5 m, not 3.5: a fire snaps to the 3 m build grid, so the one you just
   *  placed can sit 2.1 m from where you aimed, and you aim a few metres ahead
   *  of your feet — at 3.5 m "cook at the fire you are standing at" failed
   *  about half the time (the survival gate's long-standing flake, M32). */
  nearFire(x: number, z: number, r = 5): boolean {
    for (const p of this.pieces) {
      if (p.kind !== 'campfire') continue
      if (Math.hypot(p.gx * CELL - x, p.gz * CELL - z) < r) return true
    }
    return false
  }

  restore(pieces: Piece[]): void {
    for (const p of pieces) this.commit(p)
  }
}
