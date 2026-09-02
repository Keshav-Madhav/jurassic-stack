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

  constructor(root: HTMLElement, private inv: Inventory, private onCraft: (id: ItemId) => void) {
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
      <div id="hud-hotbar"></div>
      <div id="hud-panel" hidden></div>
      <div id="hud-help">WASD · LMB use · E interact · F eat 🫐 · TAB inventory · C creative · trees→🪵 rocks→🪨 bushes→🫐</div>
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

  tick(dt: number, x: number, y: number, z: number, timeOfDay: number, hp: number, yawDeg?: number): void {
    this.frames++
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
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg
    this.toastEl.classList.add('show')
    this.toastTimer = 2.4
  }

  prompt(text: string | null): void {
    this.promptEl.textContent = text ?? ''
    this.promptEl.style.opacity = text ? '1' : '0'
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen
    this.panelEl.hidden = !this.panelOpen
    if (this.panelOpen) this.renderPanel()
  }

  selectSlot(i: number): void {
    this.inv.selected = i
    this.renderHotbar()
  }

  private renderHotbar(): void {
    this.hotbarEl.innerHTML = this.inv.hotbar
      .map((id, i) => {
        const item = id ? ITEMS[id] : null
        const count = item?.placeable && id ? this.inv.count(id) : ''
        return `<div class="slot${i === this.inv.selected ? ' sel' : ''}">
          <em>${i + 1}</em>${item ? `<b>${item.icon}</b><i>${count}</i>` : ''}
        </div>`
      })
      .join('')
  }

  private renderPanel(): void {
    const rows = (Object.keys(ITEMS) as ItemId[])
      .filter((id) => this.inv.count(id) > 0)
      .map((id) => `<span class="res">${ITEMS[id].icon} ${ITEMS[id].name} × ${this.inv.count(id)}</span>`)
      .join('')
    const recipes = RECIPES.map((r) => {
      const ok = this.inv.canCraft(r)
      const cost = Object.entries(r.cost)
        .map(([id, n]) => `${ITEMS[id as ItemId].icon}${n}`)
        .join(' ')
      return `<button class="recipe" data-id="${r.output}" ${ok ? '' : 'disabled'}>
        ${ITEMS[r.output].icon} ${ITEMS[r.output].name}<small>${cost}</small></button>`
    }).join('')
    this.panelEl.innerHTML = `<h3>Inventory</h3><div class="resources">${rows || '<span class="res">empty-handed</span>'}</div>
      <h3>Craft</h3><div class="recipes">${recipes}</div>`
    this.panelEl.querySelectorAll<HTMLButtonElement>('.recipe').forEach((b) =>
      b.addEventListener('click', () => this.onCraft(b.dataset.id as ItemId)),
    )
  }
}
