// What the chests hold.
//
// A chest is a built piece like any other (building.ts owns its mesh and its
// collider); this owns only the contents, keyed by the piece's grid cell —
// which is already unique, already saved, and survives a reload without a new
// id scheme. Deliberately dumb: a count per item, no stacks, no slots. The
// pack works that way too, and a survival game's first chest is a place to put
// the wood down, not an inventory puzzle.
import type { ItemId } from './items'

/** what one chest can hold, counting every item together */
export const CHEST_CAPACITY = 300

export class Chests {
  private byCell = new Map<string, Map<ItemId, number>>()

  static key(gx: number, gz: number): string {
    return `${gx},${gz}`
  }

  contents(key: string): [ItemId, number][] {
    const m = this.byCell.get(key)
    return m ? [...m.entries()].filter(([, n]) => n > 0) : []
  }

  total(key: string): number {
    let n = 0
    for (const [, c] of this.byCell.get(key) ?? []) n += c
    return n
  }

  room(key: string): number {
    return CHEST_CAPACITY - this.total(key)
  }

  /** @returns how many actually went in (a full chest takes what it can) */
  put(key: string, id: ItemId, n: number): number {
    const fits = Math.max(0, Math.min(n, this.room(key)))
    if (!fits) return 0
    let m = this.byCell.get(key)
    if (!m) { m = new Map(); this.byCell.set(key, m) }
    m.set(id, (m.get(id) ?? 0) + fits)
    return fits
  }

  /** @returns how many came out */
  take(key: string, id: ItemId, n: number): number {
    const m = this.byCell.get(key)
    if (!m) return 0
    const have = m.get(id) ?? 0
    const got = Math.min(have, n)
    if (!got) return 0
    if (got === have) m.delete(id)
    else m.set(id, have - got)
    return got
  }

  /** the chest was destroyed — its contents go with it (for now) */
  clear(key: string): void {
    this.byCell.delete(key)
  }

  serialize(): [string, [ItemId, number][]][] {
    return [...this.byCell.entries()].map(([k, m]) => [k, [...m.entries()]] as [string, [ItemId, number][]])
  }

  restore(data: [string, [ItemId, number][]][] | undefined): void {
    this.byCell.clear()
    for (const [k, entries] of data ?? []) this.byCell.set(k, new Map(entries))
  }
}
