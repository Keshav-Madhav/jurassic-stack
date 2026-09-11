// The first minutes. There is no tutorial (PLAN: the ruins are the tutorial,
// the Wayfinder the guide) — but a player who has never seen the game wakes
// on a beach with a line of key codes and no idea what matters. This is the
// smallest fix: a waking card, and a handful of one-time hints that fire
// when the situation they explain first occurs (the first bush in reach, the
// first empty-handed swing, the first raptor, food under 40…). Each fires
// once per save and is remembered. Nothing here blocks play.
export type HintId =
  | 'wake' | 'bush' | 'punch' | 'craft' | 'keystone-near' | 'raptor' | 'hungry' | 'thirsty'
  | 'night' | 'carcass' | 'ko' | 'saddle' | 'gate-sight' | 'stamina' | 'cold'

const TEXT: Record<HintId, string> = {
  wake: 'You wash up on the south beach. Something old stands at its east end.',
  bush: 'A bush. LMB to pick — berries feed you, fiber makes things.',
  punch: 'Fists gather fiber and stone slowly. TAB to craft a hatchet once you have a flint.',
  craft: 'TAB opens the pack. Craft when the recipe lights up.',
  'keystone-near': 'A keystone. E to take it — the Wayfinder (N) points to the next.',
  raptor: 'Raptors hunt in packs. Fists knock one out — then berries tame it.',
  hungry: 'Hungry. F eats what you carry; berries from bushes, meat from a carcass.',
  thirsty: 'Thirsty. E at any water — sea, river, lake — drinks.',
  night: 'Night. Fires keep the dark off — a campfire is wood, stone and fiber.',
  carcass: 'A carcass. A blade takes meat and hide; a fire cooks the meat.',
  ko: "It's out cold. E to feed it berries until it's yours.",
  saddle: 'A saddle needs hide — from a carcass. Then E to saddle, E to ride.',
  'gate-sight': 'The mountain has a door in it. It wants eight keystones.',
  stamina: 'Winded. Stamina refills when you walk.',
  cold: 'The air bites up here. A fire holds it off — a coat of fur lets you stay.',
}

export class Onboarding {
  private seen = new Set<HintId>()
  private queue: HintId[] = []
  private cooldown = 0
  /** main.ts wires the HUD toast */
  show: ((text: string, long?: boolean) => void) | null = null

  restore(seen: string[] | undefined): void {
    for (const s of seen ?? []) this.seen.add(s as HintId)
  }

  serialize(): string[] {
    return [...this.seen]
  }

  /** fire a hint once; later calls for the same id are no-ops */
  hint(id: HintId): void {
    if (this.seen.has(id) || this.queue.includes(id)) return
    this.queue.push(id)
  }

  /** one hint at a time, 6 s apart, so they never stack over each other */
  update(dt: number): void {
    this.cooldown -= dt
    if (this.cooldown > 0 || !this.queue.length) return
    const id = this.queue.shift()!
    this.seen.add(id)
    this.show?.(TEXT[id], true)
    this.cooldown = 6
  }

  get hasSeen(): (id: HintId) => boolean {
    return (id) => this.seen.has(id)
  }
}
