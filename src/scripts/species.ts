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
  trike: {
    id: 'trike',
    name: 'Triceratops',
    model: 'models/dinos/Triceratops.glb',
    height: 2.6,
    walkSpeed: 2.0,
    runSpeed: 6.5,
    turnRate: 2.2,
    hp: 420,
    torporMax: 320,
    torporDrain: 1.6,
    tameFood: 'berry',
    tamePerFeed: 10,
    temperament: 'skittish',
    aggroRange: 0,
    packRange: 0,
    attackDamage: 22,
    attackRange: 2.8,
    rideable: true,
    seat: { x: 0, y: 2.0, z: -0.3 },
    clips: {
      idle: /\|Idle$/,
      walk: /\|Walk$/,
      run: /\|Walk$/, // no run clip on this rig; timeScale carries it
      attack: /\|Roar$/,
      ko: /\|LyingDown$/,
    },
    flavorClips: [/\|Eat$/, /\|Idle_Left$/, /\|Idle_Right$/],
  },
  stego: {
    id: 'stego',
    name: 'Stegosaurus',
    model: 'models/dinos/Stegosaurus.glb',
    height: 3.0,
    walkSpeed: 1.8,
    runSpeed: 5.5,
    turnRate: 1.8,
    hp: 520,
    torporMax: 380,
    torporDrain: 1.4,
    tameFood: 'berry',
    tamePerFeed: 10,
    temperament: 'skittish',
    aggroRange: 0,
    packRange: 0,
    attackDamage: 26,
    attackRange: 3.2,
    rideable: true,
    seat: { x: 0, y: 2.3, z: -0.4 },
    clips: {
      idle: /^IdleA$/,
      walk: /^Walk$/,
      run: /^Run$/,
      attack: /^TailWhip$/,
      ko: /^KnockedDown$/,
    },
    flavorClips: [/^Eat$/, /^Drink$/, /^IdleB$/],
  },
  trex: {
    id: 'trex',
    name: 'T-Rex',
    model: 'models/dinos/TRex.glb',
    // the highlands apex: the danger gradient's first boss-shaped fact.
    // Effectively untameable by fists — future weapons/traps territory.
    height: 4.4,
    walkSpeed: 2.4,
    runSpeed: 9,
    turnRate: 1.6,
    hp: 1400,
    torporMax: 1200,
    torporDrain: 4,
    tameFood: 'berry',
    tamePerFeed: 6,
    temperament: 'aggressive',
    aggroRange: 26,
    packRange: 0,
    attackDamage: 55,
    attackRange: 4.2,
    rideable: true,
    seat: { x: 0, y: 3.4, z: -0.6 },
    clips: {
      idle: /^idle$/i,
      walk: /^run$/i, // rig ships run/bite/roar/tail/idle only
      run: /^run$/i,
      attack: /^bite$/i,
      ko: /^roar$/i, // no KO clip: collapse-roar, then the pose holds
    },
    flavorClips: [/^roar$/i],
  },
}
