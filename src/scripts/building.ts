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

export const CELL = 3
const WALL_H = 3

export type PieceKind = 'foundation' | 'wall' | 'ceiling' | 'campfire'

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

const GHOST_OK = new THREE.Color(0x4dc06a)
const GHOST_BAD = new THREE.Color(0xd0483e)

export class Building {
  readonly group = new THREE.Group()
  readonly pieces: Piece[] = []
  private keys = new Set<string>()
  private ghost: THREE.Mesh
  private ghostMat: THREE.MeshStandardMaterial
  private colliders: RAPIER.Collider[] = []
  private woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 })
  private fireMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 })
  /** Pre-allocated light pool: adding a light mid-game recompiles every
   *  shader in the scene (multi-second freeze). 8 dormant lights cover the
   *  first 8 campfires; later fires burn lightless. */
  private firePool: THREE.PointLight[] = []
  private firesLit = 0

  constructor(private physics: Physics) {
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xff8a3c, 0, 18)
      this.firePool.push(l)
      this.group.add(l)
    }
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

    if (kind === 'foundation' || kind === 'campfire') {
      const cx = gx * CELL
      const cz = gz * CELL
      const ground = heightAt(cx, cz)
      const p: Piece = { kind, gx, gz, level: 0, edge: 0, baseY: ground }
      if (kind === 'campfire') {
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
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), p.kind === 'campfire' ? this.fireMat : this.woodMat)
    this.applyTransform(mesh, p)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    if (p.kind === 'campfire' && this.firesLit < this.firePool.length) {
      const flame = this.firePool[this.firesLit++]
      flame.position.set(p.gx * CELL, p.baseY + 0.9, p.gz * CELL)
      flame.intensity = 60
    }
    // static collider matching the mesh
    const { pos, size } = this.box(p)
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

  restore(pieces: Piece[]): void {
    for (const p of pieces) this.commit(p)
  }
}
