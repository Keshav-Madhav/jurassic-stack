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
  /** unprovoked aggro when the player comes this close (0 = only when hit) */
  aggroRange: number
  /** packmates within this radius join a fight */
  packRange: number
  attackDamage: number
  attackRange: number
  rideable: boolean
  /** rider seat offset from dino origin (local, pre-scale-normalized units) */
  seat: { x: number; y: number; z: number }
  /** yaw the rig needs on top of its heading to face the way it moves (models
   *  ship with any forward axis: the Allosaurus and Apatosaurus walked
   *  backwards, the Terror Bird sideways — side-on portraits, M19) */
  facingOffset?: number
  /** what it eats — the brain's predation and fear rules key off this */
  diet: 'carnivore' | 'herbivore'
  /** who fights back: skittish flee when hit, defensive charge the attacker, aggressive attack on sight */
  temperament: 'skittish' | 'defensive' | 'aggressive'
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
    diet: 'carnivore',
    aggroRange: 14,
    packRange: 28,
    attackDamage: 16,
    attackRange: 2.0,
    rideable: true,
    seat: { x: 0, y: 0.48, z: -0.05 },
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
    temperament: 'defensive',
    diet: 'herbivore',
    aggroRange: 0,
    packRange: 0,
    attackDamage: 22,
    attackRange: 2.8,
    rideable: true,
    seat: { x: 0, y: 1.55, z: -0.25 },
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
    temperament: 'defensive',
    diet: 'herbivore',
    aggroRange: 0,
    packRange: 0,
    attackDamage: 26,
    attackRange: 3.2,
    rideable: true,
    seat: { x: 0, y: 1.8, z: -0.35 },
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
    diet: 'carnivore',
    aggroRange: 26,
    packRange: 0,
    attackDamage: 90,
    attackRange: 4.2,
    rideable: true,
    seat: { x: 0, y: 2.7, z: -0.5 },
    clips: {
      idle: /^idle$/i,
      walk: /^run$/i, // rig ships run/bite/roar/tail/idle only
      run: /^run$/i,
      attack: /^bite$/i,
      ko: /^roar$/i, // no KO clip: collapse-roar, then the pose holds
    },
    flavorClips: [/^roar$/i],
  },
  // ---- the roster grows (M14: "more dinos, and variety"): seven more rows,
  // clip maps read off each GLB with gltf-transform inspect ----
  carno: {
    id: 'carno',
    name: 'Carnotaurus',
    model: 'models/dinos/Carnotaurus.glb',
    // the sprinter: fastest thing on the island, thin-skinned for its size
    height: 3.0,
    walkSpeed: 3.0,
    runSpeed: 13.5,
    turnRate: 2.4,
    hp: 300,
    torporMax: 360,
    torporDrain: 2.6,
    tameFood: 'berry',
    tamePerFeed: 9,
    temperament: 'aggressive',
    diet: 'carnivore',
    aggroRange: 22,
    packRange: 0,
    attackDamage: 42,
    attackRange: 3.0,
    rideable: true,
    seat: { x: 0, y: 1.9, z: -0.3 },
    clips: { idle: /^Idle$/, walk: /^Walk$/, run: /^Run$/, attack: /^Atack$/, ko: /^Fall$/ },
    flavorClips: [/^Stand$/, /^Walk slow$/],
  },
  allo: {
    id: 'allo',
    name: 'Allosaurus',
    model: 'models/dinos/Allosaurus.glb',
    // the north's second apex under the rex: hunts alone, calls before it charges
    height: 3.4,
    walkSpeed: 2.8,
    runSpeed: 11,
    turnRate: 2.0,
    hp: 420,
    torporMax: 480,
    torporDrain: 3.0,
    tameFood: 'berry',
    tamePerFeed: 8,
    temperament: 'aggressive',
    diet: 'carnivore',
    facingOffset: Math.PI,
    aggroRange: 24,
    packRange: 0,
    attackDamage: 48,
    attackRange: 3.4,
    rideable: true,
    seat: { x: 0, y: 2.1, z: -0.4 },
    clips: { idle: /G_Iddle$/, walk: /G_Walk$/, run: /G_Run$/, attack: /G_Atack$/, ko: /G_DieL_2$/ },
    flavorClips: [/G_Call$/],
  },
  terrorbird: {
    id: 'terrorbird',
    name: 'Terror Bird',
    model: 'models/dinos/TerrorBird.glb',
    // flocks on the plain and the dune edges: fast, nippy, tameable early
    height: 2.2,
    walkSpeed: 3.0,
    runSpeed: 12,
    turnRate: 3.4,
    hp: 150,
    torporMax: 180,
    torporDrain: 2.0,
    tameFood: 'berry',
    tamePerFeed: 12,
    temperament: 'aggressive',
    diet: 'carnivore',
    facingOffset: -Math.PI / 2,
    aggroRange: 16,
    packRange: 22,
    attackDamage: 20,
    attackRange: 2.2,
    rideable: true,
    seat: { x: 0, y: 1.3, z: -0.1 },
    clips: { idle: /^Idle$/, walk: /^SlowWalk$/, run: /^FastWalk$/, attack: /^Attack$/, ko: /^Die$/ },
    flavorClips: [/^Idle2$/, /^LegScratch$/, /^Yawn$/, /^Roar$/, /^HeadSmash$/],
  },
  pachy: {
    id: 'pachy',
    name: 'Pachycephalosaurus',
    model: 'models/dinos/Pachycephalosaurus.glb',
    // the headbutter: skittish until cornered, then it charges
    height: 1.6,
    walkSpeed: 2.4,
    runSpeed: 9,
    turnRate: 3.0,
    hp: 160,
    torporMax: 200,
    torporDrain: 1.8,
    tameFood: 'berry',
    tamePerFeed: 12,
    temperament: 'skittish',
    diet: 'herbivore',
    aggroRange: 0,
    packRange: 0,
    attackDamage: 14,
    attackRange: 2.0,
    rideable: true,
    seat: { x: 0, y: 1.0, z: -0.15 },
    clips: { idle: /^IdleA$/, walk: /^Walk$/, run: /^Run$/, attack: /^Headbutt$/, ko: /^KnockedOut$/ },
    flavorClips: [/^IdleB$/, /^EatLow$/, /^EatHigh$/, /^Drink$/, /^Bark$/],
  },
  parasaur: {
    id: 'parasaur',
    name: 'Parasaurolophus',
    model: 'models/fallback/Parasaurolophus.glb',
    // the herd animal of the plains: harmless, plentiful, the first ride
    height: 3.2,
    walkSpeed: 3.0,
    runSpeed: 10,
    turnRate: 2.6,
    hp: 220,
    torporMax: 240,
    torporDrain: 1.6,
    tameFood: 'berry',
    tamePerFeed: 14,
    temperament: 'skittish',
    diet: 'herbivore',
    aggroRange: 0,
    packRange: 0,
    attackDamage: 8,
    attackRange: 2.2,
    rideable: true,
    seat: { x: 0, y: 1.9, z: -0.3 },
    clips: { idle: /Parasaurolophus_Idle$/, walk: /Parasaurolophus_Walk$/, run: /Parasaurolophus_Run$/, attack: /Parasaurolophus_Attack$/, ko: /Parasaurolophus_Death$/ },
  },
  apato: {
    id: 'apato',
    name: 'Apatosaurus',
    model: 'models/fallback/Apatosaurus.glb',
    // the sauropod: a walking hill, ignores you, ruinous if you make it care
    height: 8.5,
    walkSpeed: 2.0,
    runSpeed: 5,
    turnRate: 1.0,
    hp: 1600,
    torporMax: 1400,
    torporDrain: 3.5,
    tameFood: 'berry',
    tamePerFeed: 5,
    temperament: 'defensive',
    diet: 'herbivore',
    facingOffset: Math.PI,
    aggroRange: 0,
    packRange: 0,
    attackDamage: 70,
    attackRange: 6,
    rideable: true,
    seat: { x: 0, y: 5.2, z: -1.0 },
    clips: { idle: /Apatosaurus_Idle$/, walk: /Apatosaurus_Walk$/, run: /Apatosaurus_Run$/, attack: /Apatosaurus_Attack$/, ko: /Stegosaurus_Death$/ },
  },
  mammoth: {
    id: 'mammoth',
    name: 'Mammoth',
    model: 'models/dinos/Mammoth.glb',
    // the highlands' herbivore: pines and the ranges' feet; trumpets when hit
    height: 3.6,
    walkSpeed: 2.4,
    runSpeed: 7,
    turnRate: 1.8,
    hp: 640,
    torporMax: 700,
    torporDrain: 2.4,
    tameFood: 'berry',
    tamePerFeed: 7,
    temperament: 'defensive',
    diet: 'herbivore',
    aggroRange: 0,
    packRange: 0,
    attackDamage: 42,
    attackRange: 3.6,
    rideable: true,
    seat: { x: 0, y: 2.6, z: -0.4 },
    clips: { idle: /Mammoth_Idle$/, walk: /Mammoth_WalkCycle$/, run: /Mammoth_WalkCycle$/, attack: /Mammoth_Trumpet$/, ko: /Mammoth_Idle$/ },
    flavorClips: [/Mammoth_Trumpet$/],
  },
}
