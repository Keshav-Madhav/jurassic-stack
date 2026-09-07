// DOM HUD: stats row, health, hotbar, crosshair prompt, inventory/craft panel,
// toast messages. Renders on change (inventory events) or at 2 Hz (stats) —
// never per frame.
import { ITEMS, RECIPES, type ItemId } from './items'
import type { Inventory } from './inventory'

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

  constructor(private root: HTMLElement, private inv: Inventory, private onCraft: (id: ItemId) => void, private icons: Map<ItemId, string> = new Map()) {
    root.innerHTML = `
      <div id="hud-stats">
        <span id="hud-fps">-- fps</span>
        <span id="hud-pos"></span>
        <span id="hud-time"></span>
        <span id="hud-hp"></span>
        <span id="hud-compass"></span>
        <span id="hud-mode" hidden>CREATIVE</span>
      </div>
      <div id="hud-crosshair">·</div>
      <div id="hud-prompt"></div>
      <div id="hud-toast"></div>
      <div id="hud-hint"></div>
      <div id="hud-vitals">
        <div class="bar hp"><i></i><b>♥</b></div>
        <div class="bar food"><i></i><b>🍖</b></div>
        <div class="bar water"><i></i><b>💧</b></div>
        <div class="bar stamina"><i></i><b>⚡</b></div>
      </div>
      <div id="hud-hotbar"></div>
      <div id="hud-panel" hidden></div>
      <div id="hud-credits" hidden></div>
      <div id="hud-help">WASD · SHIFT sprint · LMB use · E interact/drink/cook · F eat · N wayfinder · TAB inventory · C creative</div>
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
  }

  setCreative(on: boolean): void {
    this.modeEl.hidden = !on
  }

  private vitals = { hp: 0, food: 0, water: 0, stamina: 0 }

  tick(dt: number, x: number, y: number, z: number, timeOfDay: number, hp: number, yawDeg?: number, stats?: { food: number; water: number; stamina: number; winded: boolean }): void {
    this.frames++
    // the vitals strip (every frame: the bars are cheap and stamina moves fast)
    const set = (k: 'hp' | 'food' | 'water' | 'stamina', v: number, low: boolean) => {
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

  toast(msg: string): void {
    this.toastEl.textContent = msg
    this.toastEl.classList.add('show')
    this.toastTimer = 2.4
  }

  private hintTimer = 0
  /** the onboarding line: lower, wider, warm — holds 5.5 s */
  hint(msg: string): void {
    const el = this.root.querySelector('#hud-hint') as HTMLElement
    el.textContent = msg
    el.classList.add('show')
    this.hintTimer = 5.5
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
    const rows = (Object.keys(ITEMS) as ItemId[])
      .filter((id) => this.inv.count(id) > 0)
      .map((id) => `<span class="res" title="${ITEMS[id].name}">${this.icon(id, 'sm')}<span>${ITEMS[id].name}</span><i>× ${this.inv.count(id)}</i></span>`)
      .join('')
    const recipes = RECIPES.map((r) => {
      const ok = this.inv.canCraft(r)
      const cost = Object.entries(r.cost)
        .map(([id, n]) => `<span class="cost ${this.inv.count(id as ItemId) >= (n ?? 0) ? '' : 'short'}" title="${ITEMS[id as ItemId].name}">${this.icon(id as ItemId, 'xs')}${n}</span>`)
        .join('')
      return `<button class="recipe" data-id="${r.output}" ${ok ? '' : 'disabled'}>
        ${this.icon(r.output)}<span class="name">${ITEMS[r.output].name}${r.count > 1 ? ` ×${r.count}` : ''}</span><small>${cost}</small></button>`
    }).join('')
    this.panelEl.innerHTML = `<div class="panel-head"><h3>Inventory</h3><button class="close" title="close (Tab / Esc)">✕</button></div><div class="resources">${rows || '<span class="res"><span>empty-handed</span></span>'}</div>
      <h3>Craft</h3><div class="recipes">${recipes}</div>`
    this.panelEl.querySelectorAll<HTMLButtonElement>('.recipe').forEach((b) =>
      b.addEventListener('click', () => this.onCraft(b.dataset.id as ItemId)),
    )
    this.panelEl.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', () => this.togglePanel())
  }
}
