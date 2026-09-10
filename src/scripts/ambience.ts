// Ambience: a procedural soundscape with no audio files — wind (filtered
// noise breathing under a slow LFO), birdsong by day (short sine sweeps at
// random), insects at night (a tremolo buzz). Web Audio starts on the first
// gesture (browsers gate it), stays quiet, and follows the time of day.
export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private birdGain: GainNode | null = null
  private bugGain: GainNode | null = null
  private fallGain: GainNode | null = null
  private fallFilter: BiquadFilterNode | null = null
  /** QA (gate-sound): the falls' current mix level, 0 when out of earshot */
  fallLevel = 0
  /** 0..1, set once a frame — where you are standing (M73) */
  private inSwamp = 0
  private inPines = 0
  private nextFrog = 0
  /** QA (gate-sound): how many frog calls the marsh has made */
  frogs = 0
  private singers = [3400, 3900, 4300, 4700].map((f) => ({ f, next: 0 }))
  private nextBird = 0
  private t = 0
  private started = false

  /** settings: the master level (0-1), applied live and remembered */
  setVolume(v: number): void {
    this.level = v
    if (this.master) this.master.gain.value = 0.55 * v
  }
  private level = 1

  /** the shared AudioContext and mix bus — sfx.ts hangs its one-shots here so
   *  the whole game has one context and one place to set the level */
  get context(): AudioContext | null {
    return this.ctx
  }

  get bus(): GainNode | null {
    return this.master
  }

  /** call from a user gesture (pointer lock, click) */
  start(): void {
    if (this.started) return
    this.started = true
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.55 * this.level
    this.master.connect(ctx.destination)

    // wind: white noise → lowpass → gain; the filter cutoff and gain breathe
    const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    let peak = 0
    for (let i = 0; i < d.length; i++) {
      // pink-ish: integrate a little so the hiss has body
      const w = Math.random() * 2 - 1
      last = last * 0.97 + w * 0.03
      d[i] = last * 6 + w * 0.15
      peak = Math.max(peak, Math.abs(d[i]))
    }
    // normalised: the raw sum ran past ±1 and clipped at the output — a hard, sandy edge on the wind
    for (let i = 0; i < d.length; i++) d[i] /= peak
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'lowpass'
    this.windFilter.frequency.value = 420
    this.windFilter.Q.value = 0.7
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0.18
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master)
    noise.start()

    this.birdGain = ctx.createGain()
    this.birdGain.gain.value = 0.5
    this.birdGain.connect(this.master)

    // insects at night: CHIRPS, not a tone. A continuous oscillator — even
    // tremolo'd and quiet — is a ring in the ear after a minute (user, M18/19).
    // Crickets are short pulsed bursts at random from a few "singers", each
    // its own pitch, with silence between: the level bus here, the bursts in
    // chirp()
    this.bugGain = ctx.createGain()
    this.bugGain.gain.value = 0
    this.bugGain.connect(this.master)

    // FALLING WATER (M72). There is no CC0 waterfall loop in the packs, and
    // one short enough to ship tiles audibly — but a waterfall genuinely IS
    // broadband noise with a bandpass on it, so synthesising it is the
    // honest answer here in the same way `crackle` is in sfx.ts. Two taps of
    // the same noise buffer: a low roar and a hiss, mixed by distance in
    // falls() so approaching one gets brighter, not just louder.
    const fallSrc = ctx.createBufferSource()
    fallSrc.buffer = buf
    fallSrc.loop = true
    this.fallFilter = ctx.createBiquadFilter()
    this.fallFilter.type = 'bandpass'
    this.fallFilter.frequency.value = 300
    this.fallFilter.Q.value = 0.35
    this.fallGain = ctx.createGain()
    this.fallGain.gain.value = 0
    fallSrc.connect(this.fallFilter).connect(this.fallGain).connect(this.master)
    fallSrc.start()
  }

  /** How near the nearest waterfall is, in metres (Infinity = none in the
   *  world). Called once a frame; the ramp is what stops it clicking when the
   *  camera teleports. */
  falls(distance: number): void {
    if (!this.fallGain || !this.fallFilter || !this.ctx) return
    const RANGE = 140
    const near = Number.isFinite(distance) ? Math.max(0, 1 - distance / RANGE) : 0
    // squared: a waterfall is loud at its foot and a rumour at a hundred metres
    this.fallLevel = near * near
    const now = this.ctx.currentTime
    this.fallGain.gain.setTargetAtTime(this.fallLevel * 0.34, now, 0.25)
    // close up you hear the hiss of the spray; far off, only the roar
    this.fallFilter.frequency.setTargetAtTime(240 + this.fallLevel * 900, now, 0.3)
  }

  /** Where you are standing, 0..1 each. The wood and the marsh do not sound
   *  like the plains and they did (M73): one wind, one bird table, one
   *  cricket bed for the entire island. */
  setPlace(swamp: number, pines: number): void {
    this.inSwamp = swamp
    this.inPines = pines
  }

  /** A frog: two short croaks a fifth apart, low and buzzy. Sawtooth through
   *  a lowpass, because a croak is a rough-edged pulse and a sine is a flute. */
  private frog(): void {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const f0 = 120 + Math.random() * 90
    const croaks = 1 + (Math.random() < 0.55 ? 1 : 0)
    for (let i = 0; i < croaks; i++) {
      const t0 = now + i * (0.17 + Math.random() * 0.1)
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(f0 * (i ? 1.5 : 1), t0)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 900
      lp.Q.value = 3
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.045, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15)
      o.connect(lp).connect(g).connect(this.bugGain!)
      o.start(t0)
      o.stop(t0 + 0.2)
    }
    this.frogs++
  }

  private chirp(): void {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const notes = 2 + Math.floor(Math.random() * 4)
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      const f0 = 1400 + Math.random() * 1600
      const t0 = now + i * (0.09 + Math.random() * 0.08)
      o.frequency.setValueAtTime(f0, t0)
      o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + Math.random() * 0.6), t0 + 0.07)
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11)
      o.connect(g).connect(this.birdGain!)
      o.start(t0)
      o.stop(t0 + 0.14)
    }
  }

  /** one cricket burst: 6–9 pulses of a soft high sine, 28 pulses a second */
  private cricket(freq: number): void {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const pulses = 6 + Math.floor(Math.random() * 4)
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq * (0.97 + Math.random() * 0.06)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, now)
    for (let i = 0; i < pulses; i++) {
      const t0 = now + i / 28
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.028, t0 + 0.006)
      g.gain.linearRampToValueAtTime(0, t0 + 0.024)
    }
    o.connect(g).connect(this.bugGain!)
    o.start(now)
    o.stop(now + pulses / 28 + 0.05)
  }

  /** The keystone chime: a rising bell arpeggio (each stone found starts one
   *  step higher up a pentatonic; the one that completes the set adds a fifth
   *  note) with a soft shimmer under it. */
  chime(count: number, needed: number): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26]
    const root = 523.25 * Math.pow(2, scale[Math.max(0, Math.min(count - 1, scale.length - 1))] / 12)
    const notes = count >= needed ? [0, 4, 7, 12, 16] : [0, 4, 7, 12]
    notes.forEach((semi, i) => {
      const t0 = now + i * 0.11
      for (const [mult, g0] of [[1, 0.13], [2, 0.05], [3, 0.02]] as const) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = root * Math.pow(2, semi / 12) * mult
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t0)
        g.gain.linearRampToValueAtTime(g0, t0 + 0.012)
        g.gain.exponentialRampToValueAtTime(0.0004, t0 + 1.6 / mult)
        o.connect(g).connect(this.master!)
        o.start(t0)
        o.stop(t0 + 1.7)
      }
    })
    // the shimmer: a high-passed noise wash swelling under the bells
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5
    const src = ctx.createBufferSource()
    src.buffer = buf
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 5000
    const sg = ctx.createGain()
    sg.gain.setValueAtTime(0, now)
    sg.gain.linearRampToValueAtTime(0.05, now + 0.4)
    sg.gain.exponentialRampToValueAtTime(0.0005, now + 1.2)
    src.connect(hp).connect(sg).connect(this.master)
    src.start(now)
  }

  /** The beacon's swell: a slow major chord that blooms and fades over ~7 s. */
  swell(): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const now = ctx.currentTime
    for (const [f, g0] of [[110, 0.16], [165, 0.11], [220, 0.09], [277, 0.07], [330, 0.05]] as const) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(g0, now + 2.4)
      g.gain.setValueAtTime(g0, now + 4.2)
      g.gain.exponentialRampToValueAtTime(0.0005, now + 7.5)
      o.connect(g).connect(this.master)
      o.start(now)
      o.stop(now + 7.6)
    }
  }

  /** @param time 0..1 day fraction (0.25 sunrise, 0.5 noon, 0.75 sunset) · windiness 0..1 */
  update(dt: number, time: number, windiness = 0.5): void {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.bugGain) return
    this.t += dt
    const daylight = Math.max(0, Math.sin((time - 0.25) * Math.PI * 2)) // 0 at night → 1 at noon
    // wind breathes
    const breath = 0.6 + 0.4 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11 + 1)
    // WIND IN NEEDLES IS NOT WIND IN LEAVES (M73). A broadleaf canopy
    // clatters — broadband, low; a conifer hisses, because a needle is a
    // thin edge and it whistles. Same noise source, the filter moved up an
    // octave and a half and opened a little. In the marsh the opposite: dead
    // still air under a closed canopy, so the wind almost stops.
    this.windGain.gain.value = (0.08 + 0.16 * windiness) * breath * (1 - 0.55 * this.inSwamp) * (1 + 0.25 * this.inPines)
    this.windFilter.frequency.value = (300 + 400 * breath * windiness) * (1 + 1.7 * this.inPines)
    // birds by day, at random
    if (daylight > 0.15 && this.t > this.nextBird) {
      this.chirp()
      this.nextBird = this.t + 2 + Math.random() * 9 * (1.4 - daylight)
    }
    // insects at night: each singer chirps every 0.6–2.4 s, more of them the
    // darker it is; the bus level fades with dusk
    const night = 1 - Math.min(1, daylight * 3)
    this.bugGain.gain.setTargetAtTime(0.5 * night, this.ctx.currentTime, 0.5)
    if (night > 0.05) {
      for (const s of this.singers) {
        if (this.t > s.next) {
          if (Math.random() < 0.35 + 0.65 * night) this.cricket(s.f)
          s.next = this.t + 0.6 + Math.random() * 1.8
        }
      }
    }
    // THE MARSH HAS FROGS, and unlike the crickets they do not wait for dark
    // — a swamp is loud at noon. The bug bus carries them, so the settings
    // volume already reaches them.
    if (this.inSwamp > 0.25) {
      this.bugGain.gain.setTargetAtTime(Math.max(0.5 * night, 0.5 * this.inSwamp), this.ctx.currentTime, 0.5)
      if (this.t > this.nextFrog) {
        this.frog()
        this.nextFrog = this.t + (0.5 + Math.random() * 2.2) / this.inSwamp
      }
    }
  }
}
