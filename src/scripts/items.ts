// Item + recipe definitions. Pure data — the crafting system, HUD, and save
// file all read from here. Icons are emoji for now (legible, zero asset work).
export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'flint' | 'berry' | 'rawmeat' | 'cookedmeat' | 'hide'
  | 'hatchet' | 'spear'
  | 'campfire' | 'torch' | 'foundation' | 'wall' | 'ceiling'
  | 'saddle'

export interface ItemDef {
  id: ItemId
  name: string
  icon: string
  /** Buildable items become placement ghosts instead of hand tools. */
  placeable?: boolean
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { id: 'wood', name: 'Wood', icon: '🪵' },
  stone: { id: 'stone', name: 'Stone', icon: '🪨' },
  fiber: { id: 'fiber', name: 'Fiber', icon: '🌾' },
  flint: { id: 'flint', name: 'Flint', icon: '🔻' },
  berry: { id: 'berry', name: 'Berry', icon: '🫐' },
  rawmeat: { id: 'rawmeat', name: 'Raw Meat', icon: '🥩' },
  cookedmeat: { id: 'cookedmeat', name: 'Cooked Meat', icon: '🍖' },
  hide: { id: 'hide', name: 'Hide', icon: '🟫' },
  hatchet: { id: 'hatchet', name: 'Hatchet', icon: '🪓' },
  spear: { id: 'spear', name: 'Spear', icon: '🔱' },
  campfire: { id: 'campfire', name: 'Campfire', icon: '🔥', placeable: true },
  torch: { id: 'torch', name: 'Torch', icon: '🕯️', placeable: true },
  foundation: { id: 'foundation', name: 'Foundation', icon: '⬜', placeable: true },
  wall: { id: 'wall', name: 'Wall', icon: '🧱', placeable: true },
  ceiling: { id: 'ceiling', name: 'Ceiling', icon: '⬛', placeable: true },
  saddle: { id: 'saddle', name: 'Saddle', icon: '🪑' },
}

export interface Recipe {
  output: ItemId
  count: number
  cost: Partial<Record<ItemId, number>>
}

export const RECIPES: Recipe[] = [
  { output: 'hatchet', count: 1, cost: { wood: 1, flint: 1, fiber: 4 } },
  { output: 'spear', count: 1, cost: { wood: 2, flint: 1, fiber: 6 } },
  { output: 'campfire', count: 1, cost: { wood: 6, stone: 4, fiber: 2 } },
  { output: 'torch', count: 2, cost: { wood: 2, fiber: 3, hide: 1 } }, // a stake, a wrap, a bit of fat to burn
  { output: 'foundation', count: 1, cost: { wood: 8, fiber: 4 } },
  { output: 'wall', count: 1, cost: { wood: 5, fiber: 2 } },
  { output: 'ceiling', count: 1, cost: { wood: 6, fiber: 3 } },
  { output: 'saddle', count: 1, cost: { fiber: 12, hide: 6, wood: 4 } }, // hide off a carcass: the hunt feeds the saddle (M21)
]
