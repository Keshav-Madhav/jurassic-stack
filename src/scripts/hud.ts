// Minimal DOM HUD: FPS, position, time of day, controls hint. Plain DOM over
// the canvas per the house pattern — no framework.
export class Hud {
  private fpsEl: HTMLElement
  private posEl: HTMLElement
  private timeEl: HTMLElement
  private frames = 0
  private accum = 0
  fps = 0

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div id="hud-stats">
        <span id="hud-fps">-- fps</span>
        <span id="hud-pos"></span>
        <span id="hud-time"></span>
      </div>
      <div id="hud-help">click to look · WASD move · shift sprint · space jump · T +1h</div>
    `
    this.fpsEl = root.querySelector('#hud-fps')!
    this.posEl = root.querySelector('#hud-pos')!
    this.timeEl = root.querySelector('#hud-time')!
  }

  tick(dt: number, x: number, y: number, z: number, timeOfDay: number): void {
    this.frames++
    this.accum += dt
    if (this.accum >= 0.5) {
      this.fps = Math.round(this.frames / this.accum)
      this.fpsEl.textContent = `${this.fps} fps`
      this.frames = 0
      this.accum = 0
    }
    this.posEl.textContent = `${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}`
    const hours = (timeOfDay * 24 + 24) % 24
    const hh = Math.floor(hours)
    const mm = Math.floor((hours - hh) * 60)
    this.timeEl.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
}
