// The species table — the data-driven contract from PLAN.md: every dino is a
// row here plus the one generic brain in dinos.ts. Never special-case a
// species in code; if a behavior can't be expressed as a column, the brain
// grows a column, not an if-statement.
export interface SpeciesDef {
  id: string
  name: string
  model: string
  /** world height in meters (model normalized to this) */
  height: number
  walkSpeed: number
  runSpeed: number
  turnRate: number
  hp: number
  torporMax: number
  /** torpor drained per second while KO'd */
  torporDrain: number
  /** item that fills the tame bar, and how much per feed */
  tameFood: 'berry'
  tamePerFeed: number
  /** aggro: flees / fights back when hit */
  temperament: 'skittish' | 'aggressive'
  /** unprovoked aggro when the player comes this close (0 = only when hit) */
  aggroRange: number
  /** packmates within this radius join a fight */
  packRange: number
  attackDamage: number
  attackRange: number
  rideable: boolean
  /** rider seat offset from dino origin (local, pre-scale-normalized units) */
  seat: { x: number; y: number; z: number }
  /** regex per animation slot, matched against clip names */
  clips: { idle: RegExp; walk: RegExp; run: RegExp; attack: RegExp; ko: RegExp }
  /** optional flavor one-shots played randomly while idle */
  flavorClips?: RegExp[]
}

export const SPECIES: Record<string, SpeciesDef> = {
  raptor: {
    id: 'raptor',
    name: 'Raptor',
    model: 'models/dinos/Velociraptor.glb',
    // rebalance (user: raptor too big vs human, too slow, too easy):
    // human-height predator, outruns a sprinting player, takes ~20 punches
    // to KO, and hits hard — taming one is now an achievement
    height: 1.4,
    walkSpeed: 2.6,
    runSpeed: 12,
    turnRate: 3.2,
    hp: 140,
    torporMax: 160,
    torporDrain: 2.2,
    tameFood: 'berry',
    tamePerFeed: 12,
    temperament: 'aggressive',
    aggroRange: 14,
    packRange: 28,
    attackDamage: 14,
    attackRange: 2.0,
    rideable: true,
    seat: { x: 0, y: 1.0, z: -0.15 },
    clips: {
      idle: /^idle_?0?1$/i,
      walk: /^walk$/i,
      run: /^(sprint|jog)$/i,
      attack: /^bite_?0?1$/i,
      ko: /^knocked down$/i,
    },
    flavorClips: [/^sniff$/i, /^call_alert$/i, /^idle_?0?2$/i, /^roar_?0?1$/i],
  },
}
