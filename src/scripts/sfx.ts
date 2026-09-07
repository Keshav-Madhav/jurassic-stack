// The island's sound effects: real recordings, positioned in the world.
//
// `ambience.ts` is the synthesised bed — wind, crickets, birds. This is the
// other half: footsteps that know what you are standing on, a fist landing in
// hide, a carnivore calling from somewhere off to your left. Downloaded CC0
// packs, not synthesis (PLAN's asset philosophy, and a synthesised roar sounds
// like a synthesiser): Kenney's impact / RPG / interface packs for foley, the
// "80 CC0 creature SFX" set for the animals. See ASSETS.md.
//
// Positioning is deliberately simple — distance attenuation plus a stereo pan
// from the listener's facing. A full PannerNode graph per one-shot costs more
// than it buys for a game whose camera sits three metres behind the player.
import type * as THREE from 'three'

/** id → how many numbered takes exist (`<id>-0.ogg` … `<id>-(n-1).ogg`); 1 = a single `<id>.ogg` */
const BANK = {
  'step-grass': 4, 'step-dirt': 4, 'step-sand': 4, 'step-rock': 4, 'step-wood': 4, 'step-snow': 4,
  'hit-punch': 3, 'hit-flesh': 3, 'hit-wood': 3, 'hit-stone': 3,
  'blade': 2, 'pick': 3, 'chop': 1, 'craft': 1, 'place': 1,
  'door-open': 1, 'creak': 1,
  'ui-open': 1, 'ui-close': 1, 'ui-click': 1, 'ui-error': 1, 'ui-confirm': 1,
  'eat': 3, 'drink': 2, 'player-hurt': 2,
  'dino-call': 4, 'dino-grunt': 3, 'dino-roar': 3, 'dino-hurt': 3, 'dino-die': 2,
  'alpha-roar': 1,
} as const

export type SfxId = keyof typeof BANK

export interface PlayOpts {
  /** 0-1 before distance attenuation */
  volume?: number
  /** playback rate; 1 = as recorded. Randomised a little on every call anyway. */
  rate?: number
  /** world position — omit for sounds that happen to the player */
  at?: { x: number; y: number; z: number }
  /** metres at which the sound has faded to nothing (default 60) */
  range?: number
  /** don't retrigger this id for this many seconds (a herd would machine-gun) */
  cooldown?: number
}

const MAX_VOICES = 16

export class Sfx {
  private ctx: AudioContext | null = null
  private bus: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private loading = new Set<string>()
  private lastTake = new Map<string, number>()
  private lastAt = new Map<string, number>()
  private voices = 0
  /** QA (gate-sound.mjs): how many times each id actually reached the speakers,
   *  and any file that failed to load — there is no other way to check a mix
   *  from a headless browser */
  readonly plays: Record<string, number> = {}
  readonly missing: string[] = []
  /** listener state, set once a frame from the camera */
  private lx = 0
  private ly = 0
  private lz = 0
  private rightX = 1
  private rightZ = 0

  /** Share the ambience's AudioContext (browsers gate audio behind a gesture,
   *  and one context for the whole game keeps the mix in one place). */
  start(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return
    this.ctx = ctx
    this.bus = ctx.createGain()
    this.bus.gain.value = 0.9
    this.bus.connect(destination)
    // THE WHOLE BANK, UP FRONT. It is 1.1 MB against the world's 31 MB of
    // rigs, and a sample that has not decoded yet simply does not play — the
    // first punch landed silently, then the first bite, then the first door
    // (M35 gate). Fetched four at a time so the decode never bunches up.
    void this.preloadAll()
  }

  get ready(): boolean {
    return this.ctx !== null
  }

  /** where the ears are: camera position and its right vector, once a frame */
  listener(camera: THREE.Camera): void {
    const p = camera.position
    this.lx = p.x
    this.ly = p.y
    this.lz = p.z
    // right = normalize(cross(forward, up)) — read straight off the matrix
    const e = camera.matrixWorld.elements
    this.rightX = e[0]
    this.rightZ = e[2]
  }

  private file(id: SfxId, take: number): string {
    return BANK[id] === 1 ? `audio/${id}.ogg` : `audio/${id}-${take}.ogg`
  }

  private async preloadAll(): Promise<void> {
    const jobs: [SfxId, number][] = []
    for (const id of Object.keys(BANK) as SfxId[]) for (let i = 0; i < BANK[id]; i++) jobs.push([id, i])
    const LANES = 4
    await Promise.all(Array.from({ length: LANES }, async (_, lane) => {
      for (let i = lane; i < jobs.length; i += LANES) await this.buffer(jobs[i][0], jobs[i][1])
    }))
  }

  private async buffer(id: SfxId, take: number): Promise<AudioBuffer | null> {
    const url = this.file(id, take)
    const have = this.buffers.get(url)
    if (have) return have
    if (!this.ctx || this.loading.has(url)) return null
    this.loading.add(url)
    try {
      const res = await fetch(url)
      const raw = await res.arrayBuffer()
      const buf = await this.ctx.decodeAudioData(raw)
      this.buffers.set(url, buf)
      return buf
    } catch {
      this.missing.push(url)
      this.buffers.set(url, this.ctx.createBuffer(1, 1, this.ctx.sampleRate)) // don't retry a 404 forever
      return null
    } finally {
      this.loading.delete(url)
    }
  }

  /** Fire a one-shot. Silently does nothing before the first user gesture. */
  play(id: SfxId, opts: PlayOpts = {}): void {
    const ctx = this.ctx
    if (!ctx || !this.bus || this.voices >= MAX_VOICES) return
    const now = ctx.currentTime
    if (opts.cooldown) {
      const last = this.lastAt.get(id) ?? -99
      if (now - last < opts.cooldown) return
      this.lastAt.set(id, now)
    }
    // distance first: a sound that cannot be heard costs nothing
    let gain = opts.volume ?? 1
    let pan = 0
    if (opts.at) {
      const dx = opts.at.x - this.lx, dy = opts.at.y - this.ly, dz = opts.at.z - this.lz
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const range = opts.range ?? 60
      if (d > range) return
      const fall = 1 - d / range
      gain *= fall * fall
      if (d > 0.5) pan = Math.max(-1, Math.min(1, ((dx * this.rightX + dz * this.rightZ) / d) * 0.85))
    }
    if (gain < 0.004) return

    // a different take each time, never the same one twice running
    const takes = BANK[id]
    let take = Math.floor(Math.random() * takes)
    if (takes > 1 && take === this.lastTake.get(id)) take = (take + 1) % takes
    this.lastTake.set(id, take)

    const buf = this.buffers.get(this.file(id, take))
    if (!buf) { void this.buffer(id, take); return } // arrives for next time
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = (opts.rate ?? 1) * (0.94 + Math.random() * 0.12)
    const g = ctx.createGain()
    g.gain.value = gain
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      src.connect(g).connect(p).connect(this.bus)
    } else {
      src.connect(g).connect(this.bus)
    }
    this.voices++
    this.plays[id] = (this.plays[id] ?? 0) + 1
    src.onended = () => { this.voices-- }
    src.start()
  }

  /** A fire, heard from `d` metres: pitched-up wood ticks at random intervals.
   *  (No CC0 fire loop in the packs, and a loop that short tiles audibly; a
   *  crackle IS a sparse train of little impacts, so this is the honest one.) */
  crackle(at: { x: number; y: number; z: number }, dt: number): void {
    if (!this.ctx) return
    this.fireT -= dt
    if (this.fireT > 0) return
    this.fireT = 0.09 + Math.random() * 0.22
    this.play('hit-wood', { at, range: 22, volume: 0.16 + Math.random() * 0.1, rate: 2.2 + Math.random() * 1.4 })
  }
  private fireT = 0
}
