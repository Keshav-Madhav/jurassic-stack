// DOM HUD: stats row, health, hotbar, crosshair prompt, inventory/craft panel,
// toast messages. Renders on change (inventory events) or at 2 Hz (stats) —
// never per frame.
import { ITEMS, RECIPES, type ItemId } from './items'
import type { Inventory } from './inventory'

/** chest rows: same shape as the pack's, but they move the other way */
function chest_rows(items: [ItemId, number][], icon: (id: ItemId, cls: string) => string): string {
  return items
    .map(([id, n]) => `<span class="res movable" data-move="${id}" title="click to take · shift-click for all">${icon(id, 'sm')}<span>${ITEMS[id].name}</span><i>× ${n}</i></span>`)
    .join('')
}

export class Hud {
  private fpsEl: HTMLElement
  private posEl: HTMLElement
  private timeEl: HTMLElement
  private hpEl: HTMLElement
  private compassEl!: HTMLElement
  private modeEl!: HTMLElement
  private hotbarEl: HTMLElement
  private promptEl: HTMLElement
  private panelEl: HTMLElement
  private toastEl: HTMLElement
  private frames = 0
  private accum = 0
  private toastTimer = 0
  fps = 0
  panelOpen = false

  /** main.ts: release/re-lock the pointer when the panel opens/closes */
  onPanelToggle: ((open: boolean) => void) | null = null
  /** main.ts hangs the interface sounds here */
  onUi: ((what: 'open' | 'close' | 'click') => void) | null = null
  /** the gear button — a route to the settings that is not a keyboard shortcut
   *  nobody can see (M53: a player reported settings "wasn't opening" and the
   *  only way in was one letter on a help line) */
  onGear: (() => void) | null = null
  /** What the pack should show BESIDE the pack, asked for at render time:
   *  whether a workbench is in reach (the homestead recipes want one) and what
   *  the chest you are standing at holds (M39). */
  panelContext: (() => { bench: boolean; chest: [ItemId, number][] | null; knows: (id: ItemId) => boolean }) | null = null
  /** move one item (or the whole pile, with shift) between pack and chest */
  onChestMove: ((id: ItemId, dir: 'in' | 'out', all: boolean) => void) | null = null

  constructor(readonly root: HTMLElement, private inv: Inventory, private onCraft: (id: ItemId) => void, private icons: Map<ItemId, string> = new Map()) {
    root.innerHTML = `
      <div id="hud-stats">
        <span id="hud-fps">-- fps</span>
        <span id="hud-pos"></span>
        <span id="hud-time"></span>
        <span id="hud-hp"></span>
        <span id="hud-compass"></span>
        <span id="hud-mode" hidden>CREATIVE</span>
      </div>
      <button id="hud-gear" title="Settings (O)" aria-label="Settings">⚙</button>
      <div id="hud-crosshair">·</div>
      <div id="hud-prompt"></div>
      <div id="hud-toast"></div>
      <div id="hud-hint"></div>
      <div id="hud-vitals">
        <div class="bar hp"><i></i><b>♥</b></div>
        <div class="bar food"><i></i><b>🍖</b></div>
        <div class="bar water"><i></i><b>💧</b></div>
        <div class="bar stamina"><i></i><b>⚡</b></div>
        <div class="bar warmth" hidden><i></i><b>🔥</b></div>
      </div>
      <div id="hud-hotbar"></div>
      <div id="hud-panel" hidden></div>
      <div id="hud-perf" hidden></div>
      <div id="hud-credits" hidden></div>
      <div id="hud-help">WASD · SHIFT sprint · LMB use · E interact · F eat · N wayfinder · TAB pack · O settings · C creative</div>
    `
    this.fpsEl = root.querySelector('#hud-fps')!
    this.posEl = root.querySelector('#hud-pos')!
    this.timeEl = root.querySelector('#hud-time')!
    this.hpEl = root.querySelector('#hud-hp')!
    this.compassEl = root.querySelector('#hud-compass')!
    this.modeEl = root.querySelector('#hud-mode')!
    this.hotbarEl = root.querySelector('#hud-hotbar')!
    this.promptEl = root.querySelector('#hud-prompt')!
    this.panelEl = root.querySelector('#hud-panel')!
    this.toastEl = root.querySelector('#hud-toast')!
    inv.onChange = () => {
      this.renderHotbar()
      if (this.panelOpen) this.renderPanel()
    }
    this.renderHotbar()
    root.querySelector<HTMLButtonElement>('#hud-gear')!.addEventListener('click', () => this.onGear?.())
  }

  setCreative(on: boolean): void {
    this.modeEl.hidden = !on
  }

  private vitals = { hp: 0, food: 0, water: 0, stamina: 0, warmth: 0 }

  tick(dt: number, x: number, y: number, z: number, timeOfDay: number, hp: number, yawDeg?: number, stats?: { food: number; water: number; stamina: number; winded: boolean; warmth: number; cold: boolean }): void {
    this.frames++
    // the vitals strip (every frame: the bars are cheap and stamina moves fast)
    const set = (k: 'hp' | 'food' | 'water' | 'stamina' | 'warmth', v: number, low: boolean) => {
      const r = Math.max(0, Math.min(100, v))
      if (Math.abs(this.vitals[k] - r) < 0.4) return
      this.vitals[k] = r
      const el = this.root.querySelector(`#hud-vitals .bar.${k}`) as HTMLElement
      ;(el.firstElementChild as HTMLElement).style.width = `${r}%`
      el.classList.toggle('low', low)
    }
    set('hp', hp, hp < 30)
    if (stats) {
      set('food', stats.food, stats.food < 20)
      set('water', stats.water, stats.water < 20)
      set('stamina', stats.stamina, stats.winded)
      // the warmth bar only exists when the cold does — one more bar on a
      // beach at noon is clutter, and on a ridge at night it is the game
      const wb = this.root.querySelector('#hud-vitals .bar.warmth') as HTMLElement
      const show = stats.warmth < 99.5
      if (wb.hidden === show) wb.hidden = !show
      if (show) set('warmth', stats.warmth, stats.cold)
    }
    this.accum += dt
    if (this.accum >= 0.5) {
      this.fps = Math.round(this.frames / this.accum)
      this.fpsEl.textContent = `${this.fps} fps`
      this.posEl.textContent = `${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}`
      const hours = (timeOfDay * 24 + 24) % 24
      this.timeEl.textContent = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`
      this.hpEl.textContent = `♥ ${Math.max(0, Math.ceil(hp))}`
      if (yawDeg !== undefined) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
        const d = ((yawDeg % 360) + 360) % 360
        this.compassEl.textContent = `${dirs[Math.round(d / 45) % 8]} ${Math.round(d)}°`
      }
      this.frames = 0
      this.accum = 0
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show')
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt
      if (this.hintTimer <= 0) (this.root.querySelector('#hud-hint') as HTMLElement).classList.remove('show')
    }
  }

  /** `secs` for the rare line worth reading twice — a tablet's inscription
   *  cannot be taken in inside 2.4 s (M68) */
  toast(msg: string, secs = 2.4): void {
    this.toastEl.textContent = msg
    this.toastEl.classList.add('show')
    this.toastTimer = secs
  }

  private hintTimer = 0
  /** the onboarding line: lower, wider, warm — holds 5.5 s */
  hint(msg: string): void {
    const el = this.root.querySelector('#hud-hint') as HTMLElement
    el.textContent = msg
    el.classList.add('show')
    this.hintTimer = 5.5
  }

  /** The F3 panel: GPU/CPU ms and what the frame is made of. `null` hides it.
   *  This is the instrument a player on another machine screenshots for us
   *  (PERFORMANCE.md) — so it names the GPU and the pixel count too. */
  setPerf(rows: [string, string][] | null): void {
    const el = this.root.querySelector('#hud-perf') as HTMLElement
    if (!rows) { el.hidden = true; return }
    el.hidden = false
    el.innerHTML = rows
      .map(([k, v]) => (k === '' ? `<hr>` : `<span><b>${k}</b><i>${v}</i></span>`))
      .join('')
  }

  prompt(text: string | null): void {
    this.promptEl.textContent = text ?? ''
    this.promptEl.style.opacity = text ? '1' : '0'
  }

  /** a cool-gold flash at the screen's edges — the keystone pickup */
  glow(): void {
    const v = document.getElementById('hud-vignette')
    if (!v) return
    v.classList.add('glow')
    setTimeout(() => v.classList.remove('glow'), 900)
  }

  /** The finale card: fades in over the world, any key or click dismisses. */
  credits(lines: string[]): void {
    const el = document.getElementById('hud-credits')!
    el.innerHTML = `<div class="card"><h1>JURASSIC STACK</h1><p class="lede">The beacon is lit.</p>${lines.map((l) => `<p>${l}</p>`).join('')}<p class="hint">the island is yours — any key to keep playing</p></div>`
    el.hidden = false
    requestAnimationFrame(() => el.classList.add('show'))
    const close = () => {
      el.classList.remove('show')
      setTimeout(() => { el.hidden = true }, 900)
      window.removeEventListener('keydown', close)
      window.removeEventListener('pointerdown', close)
    }
    // arm after the fade so the E that lit it can't also dismiss it
    setTimeout(() => {
      window.addEventListener('keydown', close)
      window.addEventListener('pointerdown', close)
    }, 1600)
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen
    this.onUi?.(this.panelOpen ? 'open' : 'close')
    this.panelEl.hidden = !this.panelOpen
    this.root.classList.toggle('panel-open', this.panelOpen)
    if (this.panelOpen) this.renderPanel()
    this.onPanelToggle?.(this.panelOpen)
  }

  /** an item's icon markup: the rendered sprite when we have one, the emoji fallback otherwise */
  icon(id: ItemId, cls = ''): string {
    const src = this.icons.get(id)
    return src ? `<img class="icon ${cls}" src="${src}" alt="${ITEMS[id].name}" draggable="false">` : `<b class="${cls}">${ITEMS[id].icon}</b>`
  }

  selectSlot(i: number): void {
    if (this.inv.selected !== i) this.onUi?.('click')
    this.inv.selected = i
    this.renderHotbar()
  }

  private renderHotbar(): void {
    this.hotbarEl.innerHTML = this.inv.hotbar
      .map((id, i) => {
        const item = id ? ITEMS[id] : null
        const count = id && (item?.placeable || id === 'berry' || id === 'rawmeat' || id === 'cookedmeat') ? this.inv.count(id) : ''
        return `<div class="slot${i === this.inv.selected ? ' sel' : ''}" title="${item?.name ?? ''}">
          <em>${i + 1}</em>${item && id ? `${this.icon(id)}<i>${count}</i>` : ''}
        </div>`
      })
      .join('')
  }

  private renderPanel(): void {
    const ctx = this.panelContext?.() ?? { bench: false, chest: null, knows: () => true }
    const rows = (Object.keys(ITEMS) as ItemId[])
      .filter((id) => this.inv.count(id) > 0)
      .map((id) => `<span class="res${ctx.chest ? ' movable' : ''}" data-move="${id}" title="${ctx.chest ? 'click to store · shift-click for all' : ITEMS[id].name}">${this.icon(id, 'sm')}<span>${ITEMS[id].name}</span><i>× ${this.inv.count(id)}</i></span>`)
      .join('')
    const recipes = RECIPES.map((r) => {
      // two different kinds of locked: one you fix by walking to your bench,
      // one you fix by finding the tablet that teaches it (M68)
      const unknown = r.learned === true && !ctx.knows(r.output)
      const locked = unknown || (r.bench === true && !ctx.bench)
      const ok = this.inv.canCraft(r) && !locked
      const cost = Object.entries(r.cost)
        .map(([id, n]) => `<span class="cost ${this.inv.count(id as ItemId) >= (n ?? 0) ? '' : 'short'}" title="${ITEMS[id as ItemId].name}">${this.icon(id as ItemId, 'xs')}${n}</span>`)
        .join('')
      const why = unknown ? 'a tablet in the ruins teaches this' : 'needs a workbench in reach'
      const badge = unknown ? '<span class="cost short">🗿 not yet known</span>' : '<span class="cost short">🛠️ workbench</span>'
      return `<button class="recipe${locked ? ' locked' : ''}${unknown ? ' unknown' : ''}" data-id="${r.output}" ${ok ? '' : 'disabled'} title="${locked ? why : ITEMS[r.output].name}">
        ${unknown ? '<span class="glyph">🗿</span>' : this.icon(r.output)}<span class="name">${unknown ? '???' : ITEMS[r.output].name + (r.count > 1 ? ` ×${r.count}` : '')}</span><small>${locked ? badge : cost}</small></button>`
    }).join('')
    const chest = ctx.chest
      ? `<h3>Chest</h3><div class="resources chest">${
          chest_rows(ctx.chest, (id, cls) => this.icon(id, cls)) || '<span class="res"><span>empty</span></span>'
        }</div>`
      : ''
    this.panelEl.innerHTML = `<div class="panel-head"><h3>Inventory</h3><button class="close" title="close (Tab / Esc)">✕</button></div><div class="resources">${rows || '<span class="res"><span>empty-handed</span></span>'}</div>
      ${chest}
      <h3>Craft</h3><div class="recipes">${recipes}</div>`
    this.panelEl.querySelectorAll<HTMLButtonElement>('.recipe').forEach((b) =>
      b.addEventListener('click', () => { this.onUi?.('click'); this.onCraft(b.dataset.id as ItemId) }),
    )
    if (ctx.chest) {
      this.panelEl.querySelectorAll<HTMLElement>('.resources:not(.chest) [data-move]').forEach((el) =>
        el.addEventListener('click', (e) => { this.onUi?.('click'); this.onChestMove?.(el.dataset.move as ItemId, 'in', (e as MouseEvent).shiftKey) }),
      )
      this.panelEl.querySelectorAll<HTMLElement>('.resources.chest [data-move]').forEach((el) =>
        el.addEventListener('click', (e) => { this.onUi?.('click'); this.onChestMove?.(el.dataset.move as ItemId, 'out', (e as MouseEvent).shiftKey) }),
      )
    }
    this.panelEl.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', () => this.togglePanel())
  }

  /** the panel is open and something changed under it (a chest transfer) */
  refreshPanel(): void {
    if (this.panelOpen) this.renderPanel()
  }
}
