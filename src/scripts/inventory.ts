// Inventory: item counts + hotbar. Emits a change event so the HUD re-renders
// only when something actually changed (never per frame).
import { ITEMS, RECIPES, type ItemId, type Recipe } from './items'

export class Inventory {
  private counts = new Map<ItemId, number>()
  /** Hotbar slots hold item ids (tools/placeables); null = empty. */
  readonly hotbar: (ItemId | null)[] = [null, null, null, null, null, null, null, null, null]
  selected = 0
  onChange: (() => void) | null = null

  count(id: ItemId): number {
    return this.counts.get(id) ?? 0
  }

  add(id: ItemId, n = 1): void {
    this.counts.set(id, this.count(id) + n)
    // tools/placeables auto-slot into the first free hotbar slot
    if ((ITEMS[id].placeable || id === 'hatchet' || id === 'spear') && !this.hotbar.includes(id)) {
      const free = this.hotbar.indexOf(null)
      if (free >= 0) this.hotbar[free] = id
    }
    this.onChange?.()
  }

  remove(id: ItemId, n = 1): boolean {
    if (this.count(id) < n) return false
    this.counts.set(id, this.count(id) - n)
    if (this.count(id) === 0 && ITEMS[id].placeable) {
      const slot = this.hotbar.indexOf(id)
      if (slot >= 0) this.hotbar[slot] = null
    }
    this.onChange?.()
    return true
  }

  canCraft(r: Recipe): boolean {
    return Object.entries(r.cost).every(([id, n]) => this.count(id as ItemId) >= (n ?? 0))
  }

  craft(r: Recipe): boolean {
    if (!this.canCraft(r)) return false
    for (const [id, n] of Object.entries(r.cost)) this.remove(id as ItemId, n ?? 0)
    this.add(r.output, r.count)
    return true
  }

  craftById(output: ItemId): boolean {
    const r = RECIPES.find((r) => r.output === output)
    return r ? this.craft(r) : false
  }

  /** Currently selected hotbar item (null = bare hands). */
  get held(): ItemId | null {
    return this.hotbar[this.selected]
  }

  serialize(): { counts: [ItemId, number][]; hotbar: (ItemId | null)[]; selected: number } {
    return { counts: [...this.counts.entries()], hotbar: [...this.hotbar], selected: this.selected }
  }

  restore(data: ReturnType<Inventory['serialize']>): void {
    this.counts = new Map(data.counts)
    data.hotbar.forEach((id, i) => (this.hotbar[i] = id))
    this.selected = data.selected
    this.onChange?.()
  }
}
