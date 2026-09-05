// Survival stats — the thing that makes the ecology matter to the player.
// Food and water drain over the day; empty, they bleed health. Stamina drains
// while sprinting and gates it: an empty bar drops you to a walk until it
// comes back. Eating (F: berry, raw or cooked meat) and drinking (E at any
// water) refill them. Tuned for the 10-minute day: a full stomach lasts about
// a day and a half, a full waterskin under a day, so you drink more than you
// eat — as on any island (PLAN: "survival tuning", M21).
import { DAY_LENGTH_S } from './daynight'

export interface SurvivalStats { food: number; water: number; stamina: number }

/** food/water per second at rest (drains scale with sprinting) */
const FOOD_DRAIN = 100 / (DAY_LENGTH_S * 1.5)
const WATER_DRAIN = 100 / (DAY_LENGTH_S * 0.9)
const STAMINA_DRAIN = 100 / 9 // a 9 s sprint from full
const STAMINA_REGEN = 100 / 6 // 6 s to refill standing still
/** hp lost per second while starving / parched (each) */
const STARVE_HP = 100 / 90

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
  /** set by the game loop: sprinting this frame? moving? */
  sprinting = false
  moving = false
  /** stamina has run dry: sprint is refused until it comes back over 25 */
  winded = false

  /** @returns hp delta this frame (negative while starving/parched) */
  update(dt: number, creative: boolean): number {
    if (creative) {
      this.food = this.water = this.stamina = 100
      this.winded = false
      return 0
    }
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
    return { food: this.food, water: this.water, stamina: this.stamina }
  }

  restore(s: SurvivalStats | undefined): void {
    if (!s) return
    this.food = s.food
    this.water = s.water
    this.stamina = s.stamina
  }
}
