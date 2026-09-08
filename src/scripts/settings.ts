// Settings (O). PERFORMANCE.md's lever I, and the thing every game has and
// this one didn't: the player's own hands on render scale, shadows, grass,
// draw distance, volume, sensitivity and field of view.
//
// The panel is plain DOM like the rest of the HUD. Values live in
// localStorage and are applied at boot BEFORE the warm-up, so a machine that
// needs 70% render scale never pays for a full-size frame at all. Nothing here
// changes the scene's light count or material set — the two things that would
// recompile every shader (M20/M31) — which is why "shadows: off" is a map size
// of zero-ish rather than `shadowMap.enabled = false`.
export type EffectsLevel = 'off' | 'basic' | 'full'

export interface SettingsValues {
  /** post-processing: off · basic (grade + bloom) · full (+ ambient occlusion) */
  effects: EffectsLevel
  /** 0 = adaptive (the default: the game picks), else a fixed device pixel ratio */
  renderScale: number
  /** shadow map size; 0 = the smallest we offer, not "off" (off recompiles everything) */
  shadowSize: number
  grass: boolean
  /** multiplier on the scatter LOD bands: 0.7 near, 1 normal, 1.4 far */
  drawDistance: number
  volume: number
  sensitivity: number
  fov: number
}

export const DEFAULTS: SettingsValues = {
  effects: 'full',
  renderScale: 0,
  shadowSize: 1024,
  grass: true,
  drawDistance: 1,
  volume: 0.8,
  sensitivity: 1,
  fov: 55,
}

const KEY = 'jurassic-settings-v1'

export function loadSettings(): SettingsValues {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsValues>) }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(v: SettingsValues): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* private mode: the session still works, it just won't be remembered */
  }
}

interface Row {
  key: keyof SettingsValues
  label: string
  hint?: string
  /** choices for a segmented control, or a range for a slider */
  choices?: { label: string; value: number | boolean | string }[]
  range?: { min: number; max: number; step: number; format: (v: number) => string }
}

const ROWS: Row[] = [
  {
    key: 'effects',
    label: 'Effects',
    hint: 'the grade and smoothing, and bloom on top — about 1.5 ms',
    choices: [
      { label: 'Full', value: 'full' },
      { label: 'Basic', value: 'basic' },
      { label: 'Off', value: 'off' },
    ],
  },
  {
    key: 'renderScale',
    label: 'Render scale',
    hint: 'the last resort, and the biggest lever on a weak machine',
    choices: [
      { label: 'Auto', value: 0 },
      { label: '100%', value: 1 },
      { label: '85%', value: 0.85 },
      { label: '70%', value: 0.7 },
    ],
  },
  {
    key: 'shadowSize',
    label: 'Shadows',
    choices: [
      { label: 'High', value: 2048 },
      { label: 'Normal', value: 1024 },
      { label: 'Low', value: 512 },
    ],
  },
  { key: 'grass', label: 'Grass', choices: [{ label: 'On', value: true }, { label: 'Off', value: false }] },
  {
    key: 'drawDistance',
    label: 'Draw distance',
    choices: [
      { label: 'Near', value: 0.7 },
      { label: 'Normal', value: 1 },
      { label: 'Far', value: 1.35 },
    ],
  },
  { key: 'volume', label: 'Volume', range: { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` } },
  { key: 'sensitivity', label: 'Mouse', range: { min: 0.4, max: 2.2, step: 0.1, format: (v) => `${v.toFixed(1)}×` } },
  { key: 'fov', label: 'Field of view', range: { min: 50, max: 95, step: 5, format: (v) => `${v}°` } },
]

export class SettingsPanel {
  readonly values: SettingsValues
  private el: HTMLElement
  open = false
  /** main.ts applies a changed value to the running game */
  onApply: ((v: SettingsValues, changed: keyof SettingsValues) => void) | null = null
  /** main.ts releases/re-locks the pointer, exactly as the pack does */
  onToggle: ((open: boolean) => void) | null = null

  constructor(root: HTMLElement) {
    this.values = loadSettings()
    this.el = document.createElement('div')
    this.el.id = 'hud-settings'
    this.el.hidden = true
    root.appendChild(this.el)
  }

  toggle(): void {
    this.open = !this.open
    this.el.hidden = !this.open
    if (this.open) this.render()
    this.onToggle?.(this.open)
  }

  close(): void {
    if (this.open) this.toggle()
  }

  private set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
    this.values[key] = value
    save(this.values)
    this.onApply?.(this.values, key)
    this.render()
  }

  private render(): void {
    const rows = ROWS.map((r) => {
      const cur = this.values[r.key]
      if (r.choices) {
        const buttons = r.choices
          .map((c) => `<button class="opt${c.value === cur ? ' on' : ''}" data-key="${r.key}" data-value="${String(c.value)}">${c.label}</button>`)
          .join('')
        return `<div class="row"><label>${r.label}${r.hint ? `<small>${r.hint}</small>` : ''}</label><div class="opts">${buttons}</div></div>`
      }
      const g = r.range!
      return `<div class="row"><label>${r.label}</label><div class="opts">
        <input type="range" data-key="${r.key}" min="${g.min}" max="${g.max}" step="${g.step}" value="${cur as number}">
        <i>${g.format(cur as number)}</i></div></div>`
    }).join('')
    this.el.innerHTML = `<div class="panel-head"><h3>Settings</h3><button class="close" title="close (O)">✕</button></div>
      ${rows}
      <p class="foot">F3 shows the frame budget · settings are remembered on this machine</p>`
    this.el.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) =>
      b.addEventListener('click', () => {
        const raw = b.dataset.value!
        const value = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw)
        this.set(b.dataset.key as keyof SettingsValues, value as never)
      }),
    )
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((i) =>
      i.addEventListener('input', () => this.set(i.dataset.key as keyof SettingsValues, Number(i.value) as never)),
    )
    this.el.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', () => this.toggle())
  }
}
