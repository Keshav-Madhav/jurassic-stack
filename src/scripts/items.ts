// Item + recipe definitions. Pure data — the crafting system, HUD, and save
// file all read from here. Icons are emoji for now (legible, zero asset work).
export type ItemId =
  | 'wood' | 'stone' | 'fiber' | 'flint' | 'berry' | 'rawmeat' | 'cookedmeat' | 'hide'
  | 'hatchet' | 'spear' | 'furcoat' | 'fur'
  | 'campfire' | 'torch' | 'foundation' | 'wall' | 'ceiling' | 'bedroll' | 'workbench' | 'chest'
  | 'fence' | 'canopy'
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
  fur: { id: 'fur', name: 'Fur', icon: '🧶' },
  furcoat: { id: 'furcoat', name: 'Fur Coat', icon: '🧥' },
  hatchet: { id: 'hatchet', name: 'Hatchet', icon: '🪓' },
  spear: { id: 'spear', name: 'Spear', icon: '🔱' },
  campfire: { id: 'campfire', name: 'Campfire', icon: '🔥', placeable: true },
  torch: { id: 'torch', name: 'Torch', icon: '🕯️', placeable: true },
  foundation: { id: 'foundation', name: 'Foundation', icon: '⬜', placeable: true },
  wall: { id: 'wall', name: 'Wall', icon: '🧱', placeable: true },
  ceiling: { id: 'ceiling', name: 'Ceiling', icon: '⬛', placeable: true },
  bedroll: { id: 'bedroll', name: 'Bedroll', icon: '🛏️', placeable: true },
  workbench: { id: 'workbench', name: 'Workbench', icon: '🛠️', placeable: true },
  chest: { id: 'chest', name: 'Chest', icon: '🧰', placeable: true },
  fence: { id: 'fence', name: 'Fence', icon: '🚧', placeable: true },
  canopy: { id: 'canopy', name: 'Canopy', icon: '⛺', placeable: true },
  saddle: { id: 'saddle', name: 'Saddle', icon: '🪑' },
}

export interface Recipe {
  output: ItemId
  count: number
  cost: Partial<Record<ItemId, number>>
  /** needs a workbench within reach — the homestead tier (M39) */
  bench?: true
  /** must be LEARNED from a tablet in a ruin first (M68, engrams.ts). The
   *  early tier deliberately has none: you need fire before you have found
   *  anything. */
  learned?: true
}

export const RECIPES: Recipe[] = [
  { output: 'hatchet', count: 1, cost: { wood: 1, flint: 1, fiber: 4 } },
  { output: 'spear', count: 1, cost: { wood: 2, flint: 1, fiber: 6 } },
  { output: 'campfire', count: 1, cost: { wood: 6, stone: 4, fiber: 2 } },
  { output: 'torch', count: 2, cost: { wood: 2, fiber: 3, hide: 1 } }, // a stake, a wrap, a bit of fat to burn
  { output: 'foundation', count: 1, cost: { wood: 8, fiber: 4 } },
  { output: 'wall', count: 1, cost: { wood: 5, fiber: 2 } },
  { output: 'ceiling', count: 1, cost: { wood: 6, fiber: 3 } },
  { output: 'bedroll', count: 1, cost: { fiber: 16, hide: 3 }, learned: true },
  // the ranges are cold: the coat is what lets you go up (PLAN beat 4)
  { output: 'furcoat', count: 1, cost: { fur: 8, hide: 4, fiber: 10 }, bench: true, learned: true }, // NOT bench-gated: it is what death costs you, and you need it early
  { output: 'workbench', count: 1, cost: { wood: 20, stone: 8, fiber: 6 }, learned: true },
  { output: 'chest', count: 1, cost: { wood: 14, fiber: 6 }, bench: true, learned: true },
  { output: 'fence', count: 3, cost: { wood: 6, fiber: 2 }, learned: true }, // a rail run: pens for your tames, a line round the camp
  { output: 'canopy', count: 1, cost: { wood: 18, fiber: 8 }, bench: true, learned: true }, // four posts and a plank roof: the homestead's shelter // straw and skins: where you wake up (M37)
  { output: 'saddle', count: 1, cost: { fiber: 12, hide: 6, wood: 4 }, bench: true, learned: true }, // hide off a carcass: the hunt feeds the saddle (M21)
]
