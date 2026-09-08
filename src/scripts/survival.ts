// Survival stats — the thing that makes the ecology matter to the player.
// Food and water drain over the day; empty, they bleed health. Stamina drains
// while sprinting and gates it: an empty bar drops you to a walk until it
// comes back. Eating (F: berry, raw or cooked meat) and drinking (E at any
// water) refill them. Tuned for the 10-minute day: a full stomach lasts about
// a day and a half, a full waterskin under a day, so you drink more than you
// eat — as on any island (PLAN: "survival tuning", M21).
import { DAY_LENGTH_S } from './daynight'

export interface SurvivalStats { food: number; water: number; stamina: number; warmth?: number }

/** food/water per second at rest (drains scale with sprinting) */
const FOOD_DRAIN = 100 / (DAY_LENGTH_S * 1.5)
const WATER_DRAIN = 100 / (DAY_LENGTH_S * 0.9)
const STAMINA_DRAIN = 100 / 9 // a 9 s sprint from full
const STAMINA_REGEN = 100 / 6 // 6 s to refill standing still
/** hp lost per second while starving / parched (each) */
const STARVE_HP = 100 / 90
/** and while freezing — harsher, because you can walk away from cold */
const FREEZE_HP = 100 / 55
/** metres at which the air starts to bite, and where it bites hard */
const COLD_START = 120
const COLD_HARD = 200
/** warmth per second at chill 1 — about 80 s from warm to freezing on the tops */
const WARMTH_DRAIN = 100 / 80
const WARMTH_RECOVER = 100 / 12

export const FOODS = {
  berry: { food: 8, water: 3, hp: 4 },
  rawmeat: { food: 22, water: -4, hp: -3 }, // eaten raw: a little sick
  cookedmeat: { food: 40, water: 0, hp: 12 },
} as const
export type FoodId = keyof typeof FOODS

export class Survival {
  food = 100
  water = 100
  stamina = 100
  /** WARMTH (M50, PLAN beat 4). 100 = fine, 0 = freezing and losing health.
   *  The ranges are the gate: above 120 m the air bites, above 200 m it bites
   *  hard, and the night doubles it. A fire holds it off; the fur coat is what
   *  lets you go up and stay up. */
  warmth = 100
  /** set by the game loop each frame */
  altitude = 0
  nightness = 0
  nearFire = false
  hasCoat = false
  /** true while warmth is low enough to be worth telling the player about */
  get cold(): boolean {
    return this.warmth < 55
  }
  /** set by the game loop: sprinting this frame? moving? */
  sprinting = false
  moving = false
  /** stamina has run dry: sprint is refused until it comes back over 25 */
  winded = false

  /** @returns hp delta this frame (negative while starving/parched/freezing) */
  update(dt: number, creative: boolean): number {
    if (creative) {
      this.food = this.water = this.stamina = this.warmth = 100
      this.winded = false
      return 0
    }
    // --- the cold ---
    // chill rises with altitude and with the night; a fire beats all of it,
    // the coat halves it, and moving keeps a little of it off
    let chill = 0
    if (this.altitude > COLD_START) chill = (this.altitude - COLD_START) / 90
    chill += this.nightness * 0.55
    if (this.altitude > COLD_HARD) chill += (this.altitude - COLD_HARD) / 70
    // THE COAT IS A LICENCE, NOT A DISCOUNT. At 0.4× it merely slowed the loss
    // — the summit still froze you to death in a coat, which makes the craft
    // pointless (M50 first run: warmth 0 at 370 m WITH the coat). It now
    // subtracts a flat amount as well, so a coated player holds steady on the
    // crests and only the very top still bites.
    if (this.hasCoat) chill = chill * 0.4 - 0.55
    if (this.moving) chill -= 0.18
    if (this.nearFire) chill = -1.6 // a fire warms you back up fast
    if (chill > 0) this.warmth = Math.max(0, this.warmth - chill * WARMTH_DRAIN * dt)
    else this.warmth = Math.min(100, this.warmth - chill * WARMTH_RECOVER * dt)
    const effort = this.sprinting ? 2.2 : this.moving ? 1.25 : 1
    this.food = Math.max(0, this.food - FOOD_DRAIN * effort * dt)
    this.water = Math.max(0, this.water - WATER_DRAIN * effort * dt)
    if (this.stamina <= 0) this.winded = true
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt)
    else this.stamina = Math.min(100, this.stamina + STAMINA_REGEN * (this.moving ? 0.6 : 1) * dt)
    if (this.stamina <= 0) this.winded = true
    if (this.winded && this.stamina > 25) this.winded = false
    let hp = 0
    if (this.food <= 0) hp -= STARVE_HP * dt
    if (this.water <= 0) hp -= STARVE_HP * dt
    if (this.warmth <= 0) hp -= FREEZE_HP * dt
    return hp
  }

  /** can the player sprint right now? (a winded player walks) */
  get canSprint(): boolean {
    return !this.winded
  }

  eat(id: FoodId): { food: number; water: number; hp: number } {
    const f = FOODS[id]
    this.food = Math.min(100, this.food + f.food)
    this.water = Math.max(0, Math.min(100, this.water + f.water))
    return f
  }

  drink(): number {
    const before = this.water
    this.water = Math.min(100, this.water + 35)
    return this.water - before
  }

  serialize(): SurvivalStats {
    return { food: this.food, water: this.water, stamina: this.stamina, warmth: this.warmth }
  }

  restore(s: SurvivalStats | undefined): void {
    if (!s) return
    this.food = s.food
    this.water = s.water
    this.stamina = s.stamina
    this.warmth = s.warmth ?? 100
  }
}
