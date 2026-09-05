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
  private singers = [3400, 3900, 4300, 4700].map((f) => ({ f, next: 0 }))
  private nextBird = 0
  private t = 0
  private started = false

  /** call from a user gesture (pointer lock, click) */
  start(): void {
    if (this.started) return
    this.started = true
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.55
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
    this.windGain.gain.value = (0.08 + 0.16 * windiness) * breath
    this.windFilter.frequency.value = 300 + 400 * breath * windiness
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
  }
}
