// THE MAP (M76).
//
// Two things wearing one coat: a small always-there minimap in the corner,
// and the whole island on M. Both draw from ONE raster of the island that is
// painted once into an offscreen canvas — hypsometric tint under a hillshade,
// the same cartography `tools/map.mjs` uses for the planning chart, so the
// sheet in the game and the sheet on disk look like the same hand drew them.
//
// The raster is painted in SLICES across frames. A 2048² pass with four
// height samples a pixel is ~17 M lookups; doing that in one frame is a
// visible hitch at exactly the moment the player is looking at the HUD.
//
// WHAT IT SHOWS IS THE POINT. In survival it is a chart and a "you are here"
// — the island, the water, your own buildings, and nothing you have not
// earned. In creative it becomes the author's sheet: caves, every ruin site
// named, the areas named, the resource nodes around you. That split is the
// whole feature; a map that shows everything in survival would hand the
// player the arc for free, and one that shows nothing in creative would be
// useless for building the thing.
import type { Building } from './building'
import type { Scatter, NodeKind } from './scatter'
import { heightAt, biomeAt, BIOME, forestMaskAt, forestKindAt, FOREST_KIND, worldMeta, HALF_SIZE, SEA_LEVEL } from './heightmap'

/** metres per raster pixel — 2 m is the heightmap's own resolution */
const MPP = 2
const RASTER = (HALF_SIZE * 2) / MPP // 2048
/** how much world the minimap window shows across its width */
const MINI_SPAN = 520
/** rows painted per frame while the raster is being built */
const SLICE = 96

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export class MapView {
  readonly el: HTMLElement
  open = false
  /** 0..1 — how much of the island raster has been painted */
  progress = 0

  private raster: HTMLCanvasElement
  private rctx: CanvasRenderingContext2D
  private row = 0
  private mini: HTMLCanvasElement
  private mctx: CanvasRenderingContext2D
  private full: HTMLCanvasElement
  private fctx: CanvasRenderingContext2D
  private label: HTMLElement
  private legend: HTMLElement
  private t = 0
  // WHAT THE OVERLAY DRAWS IS CACHED, because it barely changes and the
  // minimap redraws every frame. Rescanning ~40 000 scatter nodes each frame
  // measured 0.80 ms — about 8% of the frame at the wood line — for a list
  // that only moves when you do. `building.serialize()` is worse than it
  // looks too: it copies every piece into a new object, so calling it per
  // frame is an allocation per piece per frame.
  private cacheAt = { x: Infinity, z: Infinity }
  private cacheT = 0
  private nodeCache: { x: number; z: number; c: string }[] = []
  private pieceCache: { x: number; z: number }[] = []

  constructor(root: HTMLElement, private building: Building, private scatter: Scatter) {
    this.raster = document.createElement('canvas')
    this.raster.width = this.raster.height = RASTER
    this.rctx = this.raster.getContext('2d', { willReadFrequently: false })!

    const wrap = document.createElement('div')
    wrap.id = 'hud-map'
    wrap.innerHTML = `
      <canvas id="map-mini" width="256" height="256"></canvas>
      <div id="map-full" hidden>
        <div class="sheet"><canvas id="map-big" width="900" height="900"></canvas>
          <div id="map-label"></div>
        </div>
        <div id="map-legend"></div>
      </div>`
    root.appendChild(wrap)
    this.el = wrap
    this.mini = wrap.querySelector<HTMLCanvasElement>('#map-mini')!
    this.mctx = this.mini.getContext('2d')!
    this.full = wrap.querySelector<HTMLCanvasElement>('#map-big')!
    this.fctx = this.full.getContext('2d')!
    this.label = wrap.querySelector<HTMLElement>('#map-label')!
    this.legend = wrap.querySelector<HTMLElement>('#map-legend')!
  }

  toggle(): boolean {
    this.open = !this.open
    ;(this.el.querySelector('#map-full') as HTMLElement).hidden = !this.open
    this.el.classList.toggle('open', this.open)
    return this.open
  }

  /** world → raster pixel */
  private px(x: number): number { return (x + HALF_SIZE) / MPP }

  // ---------- the island raster, painted a slice at a time ----------
  private paintSlice(): void {
    if (this.row >= RASTER) return
    const rows = Math.min(SLICE, RASTER - this.row)
    const img = this.rctx.createImageData(RASTER, rows)
    const d = img.data
    for (let j = 0; j < rows; j++) {
      const z = (this.row + j) * MPP - HALF_SIZE
      for (let i = 0; i < RASTER; i++) {
        const x = i * MPP - HALF_SIZE
        const h = heightAt(x, z)
        let r: number, g: number, b: number
        if (h < SEA_LEVEL) {
          // the shelf reads paler than the deep, so the coast has shape
          const t = Math.min(1, -h / 20)
          r = lerp(126, 28, t); g = lerp(172, 68, t); b = lerp(208, 132, t)
        } else {
          const gx = heightAt(x + MPP, z) - heightAt(x - MPP, z)
          const gz = heightAt(x, z + MPP) - heightAt(x, z - MPP)
          // light from the north-west, the way every paper map is lit
          const shade = Math.max(0, Math.min(1, 0.55 - (gx * -0.6 + gz * -0.8) * 0.09))
          if (h < 40) { const t = h / 40; r = lerp(188, 158, t); g = lerp(208, 174, t); b = lerp(148, 104, t) }
          else if (h < 90) { const t = (h - 40) / 50; r = lerp(158, 150, t); g = lerp(174, 120, t); b = lerp(104, 80, t) }
          else if (h < 150) { const t = (h - 90) / 60; r = lerp(150, 165, t); g = lerp(120, 165, t); b = lerp(80, 165, t) }
          else { const t = Math.min(1, (h - 150) / 60); r = lerp(165, 246, t); g = lerp(165, 246, t); b = lerp(165, 250, t) }
          const k = 0.55 + shade * 0.9
          r *= k; g *= k; b *= k
          if (h < SEA_LEVEL + 1.2) { r = 224; g = 209; b = 160 } // the sand line
          const bio = biomeAt(x, z)
          if (bio === BIOME.SWAMP) { r = lerp(r, 40, 0.35); g = lerp(g, 120, 0.35); b = lerp(b, 110, 0.35) }
          else if (bio === BIOME.DESERT) { r = lerp(r, 230, 0.4); g = lerp(g, 190, 0.4); b = lerp(b, 110, 0.4) }
          else if (bio === BIOME.PLAINS) { r = lerp(r, 210, 0.3); g = lerp(g, 220, 0.3); b = lerp(b, 120, 0.3) }
          // THE WOODS. Without these the island's most visible feature is
          // simply absent: inland the sheet was an unbroken cream wash and
          // the porthole in a pine forest showed a blank disc. Five of the
          // eight things a player navigates by are woods.
          const fm = forestMaskAt(x, z)
          if (fm > -0.35) {
            const cover = Math.min(1, (fm + 0.35) / 0.75) * 0.62
            const kind = forestKindAt(x, z)
            // conifers read darker and bluer than broadleaf, redwoods darkest
            const fr = kind === FOREST_KIND.PINE ? 38 : kind === FOREST_KIND.REDWOOD ? 44 : 62
            const fg = kind === FOREST_KIND.PINE ? 82 : kind === FOREST_KIND.REDWOOD ? 74 : 104
            const fb = kind === FOREST_KIND.PINE ? 62 : kind === FOREST_KIND.REDWOOD ? 48 : 52
            r = lerp(r, fr, cover); g = lerp(g, fg, cover); b = lerp(b, fb, cover)
          }
        }
        const o = (j * RASTER + i) * 4
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255
      }
    }
    this.rctx.putImageData(img, 0, this.row)
    this.row += rows
    this.progress = this.row / RASTER
    if (this.row >= RASTER) this.inkFeatures()
  }

  /** Lakes, the river and the coast, inked over the finished raster once. */
  private inkFeatures(): void {
    const m = worldMeta
    if (!m) return
    const c = this.rctx
    c.save()
    c.lineJoin = c.lineCap = 'round'
    for (const lake of m.lakes) {
      c.beginPath()
      lake.shore.forEach(([x, z], i) => (i ? c.lineTo(this.px(x), this.px(z)) : c.moveTo(this.px(x), this.px(z))))
      c.closePath()
      c.fillStyle = 'rgba(74,144,192,0.92)'
      c.fill()
      c.strokeStyle = 'rgba(30,70,105,0.5)'; c.lineWidth = 1.5; c.stroke()
    }
    for (const part of m.river?.parts ?? []) {
      c.beginPath()
      part.path.forEach((p, i) => (i ? c.lineTo(this.px(p.x), this.px(p.z)) : c.moveTo(this.px(p.x), this.px(p.z))))
      if (part.closed) c.closePath()
      c.strokeStyle = 'rgba(74,144,192,0.95)'
      c.lineWidth = Math.max(3, part.halfWidth / MPP * 1.6)
      c.stroke()
    }
    c.restore()
  }

  // ---------- drawing ----------
  private marker(c: CanvasRenderingContext2D, x: number, y: number, yaw: number): void {
    c.save()
    c.translate(x, y)
    c.rotate(yaw)
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3.5); c.lineTo(-6, 7)
    c.closePath()
    c.fillStyle = '#ffdf7a'
    c.strokeStyle = 'rgba(30,20,0,0.85)'; c.lineWidth = 1.6
    c.fill(); c.stroke()
    c.restore()
  }

  private dot(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring = 'rgba(0,0,0,0.55)'): void {
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2)
    c.fillStyle = fill; c.fill()
    c.strokeStyle = ring; c.lineWidth = 1; c.stroke()
  }

  private text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size = 11, colour = '#f4ead6'): void {
    c.font = `${size}px ui-monospace, monospace`
    c.textAlign = 'center'
    c.lineWidth = 3
    c.strokeStyle = 'rgba(20,14,6,0.85)'
    c.strokeText(s, x, y)
    c.fillStyle = colour
    c.fillText(s, x, y)
  }

  /** Rebuild the cached overlay lists — on a move of 10 m or every 0.5 s. */
  private refresh(p: { x: number; z: number }, creative: boolean): void {
    const moved = Math.hypot(p.x - this.cacheAt.x, p.z - this.cacheAt.z)
    if (moved < 10 && this.t - this.cacheT < 0.5) return
    this.cacheAt = { x: p.x, z: p.z }
    this.cacheT = this.t
    this.pieceCache = this.building.serialize().map((q) => ({ x: q.gx * 3, z: q.gz * 3 }))
    this.nodeCache.length = 0
    if (!creative) return
    const R = MINI_SPAN * 0.55
    const tint: Record<string, string> = { rock: '#c3ccd6', boulder: '#a5b0bb', outcrop: '#98a2ae', bush: '#7ab863' }
    for (const n of this.scatter.nodes) {
      if (!n.alive) continue
      if (Math.abs(n.x - p.x) > R || Math.abs(n.z - p.z) > R) continue
      const c = tint[n.kind as NodeKind]
      if (!c) continue
      this.nodeCache.push({ x: n.x, z: n.z, c })
    }
  }

  /** Called every frame. `yaw` is the player's facing, 0 = north (-z). */
  update(dt: number, p: { x: number; z: number }, yaw: number, creative: boolean): void {
    this.t += dt
    if (this.row < RASTER) { this.paintSlice(); return }
    this.refresh(p, creative)

    // --- the minimap: a window on the raster, north up, player centred ---
    const mw = this.mini.width
    const src = MINI_SPAN / MPP
    const c = this.mctx
    c.save()
    c.clearRect(0, 0, mw, mw)
    c.beginPath(); c.arc(mw / 2, mw / 2, mw / 2 - 2, 0, Math.PI * 2); c.clip()
    c.drawImage(this.raster, this.px(p.x) - src / 2, this.px(p.z) - src / 2, src, src, 0, 0, mw, mw)
    const toMini = (wx: number, wz: number): [number, number] => [
      mw / 2 + ((wx - p.x) / MINI_SPAN) * mw,
      mw / 2 + ((wz - p.z) / MINI_SPAN) * mw,
    ]
    for (const pc of this.pieceCache) {
      const [bx, by] = toMini(pc.x, pc.z)
      if (bx < 0 || by < 0 || bx > mw || by > mw) continue
      this.dot(c, bx, by, 2.6, '#e8c07a')
    }
    if (creative) this.overlay(c, toMini, mw, mw, true)
    this.marker(c, mw / 2, mw / 2, yaw)
    c.restore()

    if (!this.open) return

    // --- the full sheet: the whole island ---
    const fw = this.full.width
    const f = this.fctx
    f.clearRect(0, 0, fw, fw)
    f.drawImage(this.raster, 0, 0, RASTER, RASTER, 0, 0, fw, fw)
    const SPAN = HALF_SIZE * 2
    const toFull = (wx: number, wz: number): [number, number] => [
      ((wx + HALF_SIZE) / SPAN) * fw,
      ((wz + HALF_SIZE) / SPAN) * fw,
    ]
    // a 500 m graticule, so distances can be read off the sheet
    f.save()
    f.strokeStyle = 'rgba(40,28,12,0.16)'; f.lineWidth = 1
    for (let g = -HALF_SIZE + 500; g < HALF_SIZE; g += 500) {
      const [gx] = toFull(g, 0); const [, gy] = toFull(0, g)
      f.beginPath(); f.moveTo(gx, 0); f.lineTo(gx, fw); f.stroke()
      f.beginPath(); f.moveTo(0, gy); f.lineTo(fw, gy); f.stroke()
    }
    f.restore()

    const m = worldMeta
    if (m) {
      const [sx, sy] = toFull(m.spawn.x, m.spawn.z)
      this.dot(f, sx, sy, 4, '#8fd6ff')
      this.text(f, 'landfall', sx, sy - 14, 11, '#dff1ff')
    }
    for (const pc of this.pieceCache) {
      const [bx, by] = toFull(pc.x, pc.z)
      this.dot(f, bx, by, 2.4, '#e8c07a')
    }
    if (creative) this.overlay(f, toFull, fw, fw, false)
    this.marker(f, ...toFull(p.x, p.z), yaw)

    const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((yaw * 180) / Math.PI + 360) % 360) / 45) % 8]
    this.label.textContent = `${Math.round(p.x)}, ${Math.round(p.z)} · ${Math.round(heightAt(p.x, p.z))} m · facing ${compass}`
    this.legend.innerHTML = creative
      ? '<b>CREATIVE</b> · ▲ you · ● camp · ◆ ruin · ★ keystone · ⬟ cave · ✦ node — <i>press M to close</i>'
      : '▲ you · ● your camp · ○ landfall — <i>press M to close · C for the surveyor’s sheet</i>'
  }

  /** THE SURVEYOR'S SHEET — creative only. Everything the author knows. */
  private overlay(
    c: CanvasRenderingContext2D,
    to: (x: number, z: number) => [number, number],
    w: number,
    h: number,
    small: boolean,
  ): void {
    const m = worldMeta
    if (!m) return
    const inside = (x: number, y: number): boolean => x > -20 && y > -20 && x < w + 20 && y < h + 20

    // area names, drawn under the pins
    if (!small) {
      const named: [string, number, number][] = []
      for (const l of m.lakes) {
        const cx = l.shore.reduce((a, v) => a + v[0], 0) / l.shore.length
        const cz = l.shore.reduce((a, v) => a + v[1], 0) / l.shore.length
        named.push([l.name, cx, cz])
      }
      for (const fo of m.forests ?? []) {
        const cx = fo.shore.reduce((a, v) => a + v[0], 0) / fo.shore.length
        const cz = fo.shore.reduce((a, v) => a + v[1], 0) / fo.shore.length
        named.push([fo.name, cx, cz])
      }
      if (m.swamp) {
        const cx = m.swamp.shore.reduce((a, v) => a + v[0], 0) / m.swamp.shore.length
        const cz = m.swamp.shore.reduce((a, v) => a + v[1], 0) / m.swamp.shore.length
        named.push(['swamp', cx, cz])
      }
      named.push(['the volcano', m.volcano.x, m.volcano.z])
      if (m.river) named.push(['the Knot', m.river.knot.x, m.river.knot.z])
      for (const [name, x, z] of named) {
        const [px, py] = to(x, z)
        if (inside(px, py)) this.text(c, name, px, py, 10, 'rgba(255,244,224,0.82)')
      }
    }

    for (const cv of m.caves ?? []) {
      const [px, py] = to(cv.mouth.x, cv.mouth.z)
      if (!inside(px, py)) continue
      this.dot(c, px, py, small ? 3 : 4.5, '#2b2118', 'rgba(255,230,190,0.9)')
      if (!small) this.text(c, cv.name, px, py + 14, 10, '#ffe6be')
    }
    for (const r of m.ruinSites) {
      const [px, py] = to(r.x, r.z)
      if (!inside(px, py)) continue
      this.dot(c, px, py, small ? 3 : 4.5, r.keystone ? '#ffd24a' : '#c9b48c')
      if (!small) this.text(c, r.tag, px, py - 8, 9, r.keystone ? '#ffe9a8' : 'rgba(240,232,214,0.8)')
    }
    // THE NODES ARE FOR THE MINIMAP ONLY, and the first cut proved the point
    // my own comment had already made: at 4 km across, 260 m of pebbles and
    // sticks is a solid grey rectangle sitting on the sheet. On the sheet
    // they say nothing; in the porthole, where you can see 520 m, they are
    // the reason to glance down. Pebbles and sticks are dropped even there —
    // there are tens of thousands and they carpet everything.
    if (!small) return
    for (const n of this.nodeCache) {
      const [px, py] = to(n.x, n.z)
      if (!inside(px, py)) continue
      this.dot(c, px, py, 1.7, n.c, 'rgba(0,0,0,0.4)')
    }
  }

  /** QA (gate-m8): what the sheet is actually showing. */
  debug(): { built: number; open: boolean; pieces: number } {
    return { built: +this.progress.toFixed(2), open: this.open, pieces: this.building.count() }
  }
}
