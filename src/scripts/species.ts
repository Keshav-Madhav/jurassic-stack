// The species table — the data-driven contract from PLAN.md: every dino is a
// row here plus the one generic brain in dinos.ts. Never special-case a
// species in code; if a behavior can't be expressed as a column, the brain
// grows a column, not an if-statement.
export interface SpeciesDef {
  /** shaggy enough to yield fur when harvested — the cold gate's currency (M50) */
  furry?: true
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
  /** what it takes to tame one. Every species tamed on BERRIES until M52 —
   *  including the carnivores, which was never right; all three uses of this
   *  field are generic over the item, so a meat-eater can want meat. */
  tameFood: 'berry' | 'rawmeat'
  tamePerFeed: number
  /** unprovoked aggro when the player comes this close (0 = only when hit) */
  aggroRange: number
  /** packmates within this radius join a fight */
  packRange: number
  attackDamage: number
  attackRange: number
  rideable: boolean
  /** where the rider sits, in the animal's own frame, measured from its feet.
   *  These are MEASURED, not guessed (M84): `seatFit()` reports the mid-body
   *  back height off the live rig and the rider's hip height in the straddle,
   *  and each y here puts the hip 0.1 m clear of the back. Before that they
   *  were hand-typed and drifted — the parasaur floated 0.54 m over its back
   *  and the apatosaur's rider sat 1.6 m inside the animal. `stego` is the one
   *  deliberate exception: its mid-body maximum is the top of its PLATES, so
   *  the rider correctly sits below it. */
  seat: { x: number; y: number; z: number }
  /** yaw the rig needs on top of its heading to face the way it moves (models
   *  ship with any forward axis: the Allosaurus and Apatosaurus walked
   *  backwards, the Terror Bird sideways — side-on portraits, M19) */
  facingOffset?: number
  /** what it eats — the brain's predation and fear rules key off this */
  diet: 'carnivore' | 'herbivore'
  /** who fights back: skittish flee when hit, defensive charge the attacker, aggressive attack on sight */
  temperament: 'skittish' | 'defensive' | 'aggressive'
  /** the island's one scripted monster: guards its post, hunts nothing, fears nothing, tinted */
  alpha?: boolean
  /** regex per animation slot, matched against clip names */
  clips: { idle: RegExp; walk: RegExp; run: RegExp; attack: RegExp; ko: RegExp }
  /** ONE-CLIP SPECIES (M52). Three of the downloaded rigs — Dilophosaurus,
   *  Sauropelta, Spinosaurus — ship a single unnamed animation and nothing
   *  else, which is why they were never in the game (PLAN item 5 called it
   *  "no clips"; the truth was one apiece). A body with one cycle is still a
   *  body: the same clip fills every slot at a different RATE, and M41's
   *  procedural topple covers the death it has no clip for. */
  oneClip?: { idle: number; walk: number; run: number; attack: number }
  /** A FLINCH. Four of the fifteen rigs carry one (raptor, stego, pachy and
   *  the Allosaurus' `G_Hit`) and nothing played it: being hit was a sound, a
   *  puff of blood and a change of mind, with the body carrying on as if
   *  nothing had touched it. Where a rig has no such clip the species simply
   *  does not flinch — there is no plausible substitute in an attack or a
   *  death clip. */
  hurtClip?: RegExp
  /** What it does over a kill. Feeding was the ATTACK clip at 0.6 speed — a
   *  slowed bite, which is a fair stand-in and is what most of these rigs
   *  leave you. The Velociraptor ships an actual "Eat Prey", so it gets to
   *  eat instead of chewing in slow motion. */
  eatClip?: RegExp
  /** EXTRA ATTACKS, picked at random alongside the `attack` slot. Fights are
   *  the most-watched animation in the game and most of these rigs have more
   *  than one blow in them — a raptor bites twice over and leaps and tackles,
   *  a stego has a tail whip and a stomp, a pachy a headbutt and a charge —
   *  and every fight played the same single clip. */
  attackClips?: RegExp[]
  /** A DEATH, as distinct from a knockout. Most of these rigs have one clip
   *  for going down and it is already the `ko` slot — but four have both, and
   *  those four used to die in their KNOCKOUT pose: a raptor ships Death_01
   *  and Death_02 and played "Knocked Down" for both. Where a species lists
   *  more than one the choice is random, so a pack does not die in unison. */
  deathClips?: RegExp[]
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
    eatClip: /^eat prey$/i,
    attackClips: [/^bite_?0?2$/i, /^tackle$/i],
    seat: { x: 0, y: 0.24, z: -0.05 },
    clips: {
      idle: /^idle_?0?1$/i,
      walk: /^walk$/i,
      run: /^(sprint|jog)$/i,
      attack: /^bite_?0?1$/i,
      ko: /^knocked down$/i,
    },
    deathClips: [/^death_?0?1$/i, /^death_?0?2$/i],
    hurtClip: /^hurt_?0?1$/i,
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
    seat: { x: 0, y: 1.47, z: -0.25 },
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
    attackClips: [/^Stomp$/, /^TailWhip$/],
    seat: { x: 0, y: 1.8, z: -0.35 },
    clips: {
      idle: /^IdleA$/,
      walk: /^Walk$/,
      run: /^Run$/,
      attack: /^TailWhip$/,
      ko: /^KnockedDown$/,
    },
    deathClips: [/^Death$/],
    hurtClip: /^HurtA$/,
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
    attackClips: [/^attack_tail$/i],
    seat: { x: 0, y: 2.63, z: -0.5 },
    clips: {
      idle: /^idle$/i,
      walk: /^run$/i, // rig ships run/bite/roar/tail/idle only
      run: /^run$/i,
      attack: /^bite$/i,
      ko: /^roar$/i, // no KO clip: collapse-roar, then the pose holds
    },
    flavorClips: [/^roar$/i],
  },
  // THE GATEKEEPER (PLAN beat 5, built M20): an oversized alpha rex that
  // stands on the causeway before the caldera door — the arc's boss-shaped
  // fact. Not a lock (the keystones are); a fight you bring your tames to, or
  // a run you make on a fast mount. Stays dead once killed (saved).
  alpharex: {
    id: 'alpharex',
    name: 'Alpha Rex · the Gatekeeper',
    model: 'models/dinos/TRex.glb',
    height: 6.2,
    walkSpeed: 2.6,
    runSpeed: 10,
    turnRate: 1.5,
    hp: 4200,
    torporMax: 999999, // cannot be knocked out
    torporDrain: 50,
    tameFood: 'berry',
    tamePerFeed: 0,
    temperament: 'aggressive',
    diet: 'carnivore',
    alpha: true,
    aggroRange: 55,
    packRange: 0,
    attackDamage: 140,
    attackRange: 5.6,
    rideable: false,
    attackClips: [/^attack_tail$/i],
    seat: { x: 0, y: 2.7, z: -0.5 },
    clips: {
      idle: /^idle$/i,
      walk: /^run$/i,
      run: /^run$/i,
      attack: /^bite$/i,
      ko: /^roar$/i,
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
    seat: { x: 0, y: 2.06, z: -0.3 },
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
    seat: { x: 0, y: 2.49, z: -0.4 },
    clips: { idle: /G_Iddle$/, walk: /G_Walk$/, run: /G_Run$/, attack: /G_Atack$/, ko: /G_DieL_2$/ },
    deathClips: [/G_DieR_2$/, /G_DieL_2$/],
    hurtClip: /G_Hit$/,
    flavorClips: [/G_Call$/],
  },
  terrorbird: {
    id: 'terrorbird',
    furry: true, // feathered, close enough to line a coat
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
    attackClips: [/^HeadSmash$/],
    seat: { x: 0, y: 1.46, z: -0.1 },
    clips: { idle: /^Idle$/, walk: /^SlowWalk$/, run: /^FastWalk$/, attack: /^Attack$/, ko: /^Die$/ },
    flavorClips: [/^Idle2$/, /^LegScratch$/, /^Yawn$/, /^Roar$/], // HeadSmash is an ATTACK now, not something to do while standing about
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
    attackClips: [/^Charge$/],
    seat: { x: 0, y: 0.47, z: -0.15 },
    clips: { idle: /^IdleA$/, walk: /^Walk$/, run: /^Run$/, attack: /^Headbutt$/, ko: /^KnockedOut$/ },
    deathClips: [/^KnockedDown$/],
    hurtClip: /^HurtLow$/,
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
    seat: { x: 0, y: 1.36, z: -0.3 },
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
    // no facingOffset (M83): this rig's head bone already sits on +z in
    // model space, which is the convention every other species follows. The
    // π here rotated it to face -z — the apatosaur walked backwards.
    aggroRange: 0,
    packRange: 0,
    attackDamage: 70,
    attackRange: 6,
    rideable: true,
    seat: { x: 0, y: 6.9, z: -1.0 },
    clips: { idle: /Apatosaurus_Idle$/, walk: /Apatosaurus_Walk$/, run: /Apatosaurus_Run$/, attack: /Apatosaurus_Attack$/, ko: /Stegosaurus_Death$/ },
  },
  mammoth: {
    id: 'mammoth',
    furry: true, // the coat comes off the mammoth: the cold gate's own answer
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
    seat: { x: 0, y: 2.81, z: -0.4 },
    clips: { idle: /Mammoth_Idle$/, walk: /Mammoth_WalkCycle$/, run: /Mammoth_WalkCycle$/, attack: /Mammoth_Trumpet$/, ko: /Mammoth_Idle$/ },
    flavorClips: [/Mammoth_Trumpet$/],
  },

  // ---- THE ONE-CLIP THREE (M52) — each placed where it earns its keep ----
  dilo: {
    id: 'dilo',
    name: 'Dilophosaurus',
    model: 'models/dinos/Dilophosaurus.glb',
    // the wood's ambusher: quick, fragile, hunts in twos
    height: 1.7,
    walkSpeed: 2.4,
    runSpeed: 9.5,
    turnRate: 3.4,
    hp: 105,
    torporMax: 130,
    torporDrain: 3.4,
    tameFood: 'rawmeat',
    tamePerFeed: 12,
    temperament: 'aggressive',
    diet: 'carnivore',
    aggroRange: 22,
    packRange: 40,
    attackDamage: 13,
    attackRange: 2.0,
    rideable: false,
    seat: { x: 0, y: 1.1, z: 0 },
    clips: { idle: /$^/, walk: /$^/, run: /$^/, attack: /$^/, ko: /$^/ },
    oneClip: { idle: 0.35, walk: 1, run: 1.75, attack: 2.1 },
  },
  sauropelta: {
    id: 'sauropelta',
    name: 'Sauropelta',
    model: 'models/dinos/Sauropelta.glb',
    // the armoured grazer of the foothills: slow, stubborn, hits back hard
    height: 2.1,
    walkSpeed: 1.9,
    runSpeed: 5.2,
    turnRate: 1.5,
    hp: 520,
    torporMax: 560,
    torporDrain: 2.2,
    tameFood: 'berry',
    tamePerFeed: 8,
    temperament: 'defensive',
    diet: 'herbivore',
    aggroRange: 0,
    packRange: 26,
    attackDamage: 30,
    attackRange: 2.8,
    rideable: false,
    seat: { x: 0, y: 1.7, z: 0 },
    clips: { idle: /$^/, walk: /$^/, run: /$^/, attack: /$^/, ko: /$^/ },
    oneClip: { idle: 0.3, walk: 1, run: 1.6, attack: 1.9 },
  },
  spino: {
    id: 'spino',
    name: 'Spinosaurus',
    model: 'models/dinos/Spinosaurus.glb',
    // the river's apex: it walks the banks and the swamp's edge, and nothing
    // there argues with it
    height: 4.6,
    walkSpeed: 2.8,
    runSpeed: 9,
    turnRate: 1.9,
    hp: 900,
    torporMax: 900,
    torporDrain: 2.0,
    tameFood: 'rawmeat',
    tamePerFeed: 16,
    temperament: 'aggressive',
    diet: 'carnivore',
    aggroRange: 30,
    packRange: 0,
    attackDamage: 58,
    attackRange: 4.0,
    rideable: false,
    seat: { x: 0, y: 3.1, z: -0.3 },
    clips: { idle: /$^/, walk: /$^/, run: /$^/, attack: /$^/, ko: /$^/ },
    oneClip: { idle: 0.28, walk: 1, run: 1.7, attack: 2 },
  },
}
