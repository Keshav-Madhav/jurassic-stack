// THE RUINS ARE THE TECH TREE (PLAN item 1's last unbuilt piece, M68).
//
// Twenty-three ruins stand on this island. Twelve hold a keystone; the other
// eleven held NOTHING — you walked to one, looked at it, and left. And once a
// keystone was taken, that site was spent too. The ruins were scenery with a
// pickup on top.
//
// PLAN's line is "the ruins are the tech tree — engrams as archaeology": the
// homestead tier is not something you level into, it is something you FIND.
// A tablet at a ruin teaches one recipe, permanently, and the only way to get
// the recipe is to stand where the people who knew it stood.
//
// No quest UI: walk within reach and the tablet reads itself. The Wayfinder
// already points at the nearest thing worth walking to.
import type { ItemId } from './items'

export interface Engram {
  /** the ruin that holds it — a tag from worldMeta.ruinSites */
  site: string
  /** the recipe it unlocks */
  recipe: ItemId
  /** what the tablet says when you find it */
  line: string
}

/**
 * One tablet per ruin that has no keystone, so no site on the island is a
 * dead stop. Ordered roughly by how far they are from the spawn beach: the
 * first things you need are the closest to find.
 *
 * NB the early tier — hatchet, spear, campfire, torch, foundation, wall,
 * ceiling — is deliberately NOT here. You need those in your first minutes,
 * before you could reasonably have found anything, and a survival game that
 * will not let you make fire is a puzzle rather than a world.
 */
export const ENGRAMS: Engram[] = [
  { site: 'south-mound-columns', recipe: 'bedroll', line: 'A sleeping place, drawn in worn relief. You could make one of these.' },
  { site: 'holm-north-shrine', recipe: 'workbench', line: 'A bench, and the tools laid out on it. The rest of the city was built from here.' },
  { site: 'dune-shrine', recipe: 'fence', line: 'A rail line drawn round a herd. They kept animals, then.' },
  { site: 'coast-statue', recipe: 'chest', line: 'A banded box, carved shut. Somewhere to put what you are carrying.' },
  { site: 'spit-columns', recipe: 'saddle', line: 'A rider, and the harness drawn plainly beneath. They did not walk everywhere.' },
  { site: 'swamp-columns', recipe: 'canopy', line: 'Four posts and a roof. Shelter, before walls.' },
  { site: 'pine-arch-west', recipe: 'furcoat', line: 'A figure wrapped against the cold, climbing. The high ground was theirs too.' },
]

/** every recipe that has to be found */
export const TAUGHT = new Set<ItemId>(ENGRAMS.map((e) => e.recipe))

/** how close you have to stand for a tablet to read itself */
export const READ_RANGE = 9

export class Engrams {
  private known = new Set<ItemId>()
  private read = new Set<string>()
  /** main.ts hooks the toast, the sound and the hint */
  onLearn: ((e: Engram) => void) | null = null

  knows(recipe: ItemId): boolean {
    return this.known.has(recipe)
  }

  get count(): number {
    return this.read.size
  }

  get total(): number {
    return ENGRAMS.length
  }

  /** Read any tablet within range of (x, z). Returns the one just learned. */
  update(x: number, z: number, siteAt: (tag: string) => { x: number; z: number } | null): Engram | null {
    for (const e of ENGRAMS) {
      if (this.read.has(e.site)) continue
      const p = siteAt(e.site)
      if (!p) continue
      if (Math.hypot(p.x - x, p.z - z) > READ_RANGE) continue
      this.read.add(e.site)
      this.known.add(e.recipe)
      this.onLearn?.(e)
      return e
    }
    return null
  }

  /** the nearest tablet still unread, for the Wayfinder */
  nearestUnread(x: number, z: number, siteAt: (tag: string) => { x: number; z: number } | null): { e: Engram; x: number; z: number; d: number } | null {
    let best: { e: Engram; x: number; z: number; d: number } | null = null
    for (const e of ENGRAMS) {
      if (this.read.has(e.site)) continue
      const p = siteAt(e.site)
      if (!p) continue
      const d = Math.hypot(p.x - x, p.z - z)
      if (!best || d < best.d) best = { e, x: p.x, z: p.z, d }
    }
    return best
  }

  serialize(): string[] {
    return [...this.read]
  }

  /**
   * Restore. `legacy` means a save written before tablets existed: that player
   * could craft a saddle yesterday and must be able to craft one today, so
   * they are given every tablet rather than having the tier taken away from
   * them by an update. Punishing an existing save for a feature it predates is
   * never the right call.
   */
  restore(sites: string[] | undefined, legacy: boolean): void {
    if (legacy) {
      for (const e of ENGRAMS) { this.read.add(e.site); this.known.add(e.recipe) }
      return
    }
    for (const tag of sites ?? []) {
      this.read.add(tag)
      const e = ENGRAMS.find((x) => x.site === tag)
      if (e) this.known.add(e.recipe)
    }
  }

  /** QA */
  debug(): { read: string[]; known: string[]; total: number } {
    return { read: [...this.read], known: [...this.known], total: ENGRAMS.length }
  }
}
