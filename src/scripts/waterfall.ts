// WATERFALLS (PLAN: "waterfalls at cliff transitions — bent-plane shader +
// particle", the last of the world pass's fill).
//
// The shape is NOT decided here. tools/bake-island.mjs walks the baked rock
// down from each hand-placed lip and writes the profile it falls along into
// `meta.falls`, so the sheet is cut from the same bytes the player stands on:
// it cannot hang in the air, and it cannot bury itself in the face when a
// bake moves the cliff by a metre. This file hangs water on that profile.
//
// Three pieces, in the order you notice them:
//   the SHEET   — a ribbon down the profile, scrolling fast, glassy at the
//                 lip and white by the bottom
//   the PLUNGE  — a foam disc on the water at the foot, breathing
//   the MIST    — a handful of soft billboards drifting up out of it
//
// No lights: a light is the one thing you can never take back (M20), and a
// waterfall reads by contrast, not by illumination.
import * as THREE from 'three'
import type { FallDef } from './heightmap'

/** How far the sheet hangs off the rock. Not a z-fight epsilon: a thirty
 *  metre fall leaves the face entirely, and at 0.55 m two rock ribs on the
 *  Wellspring bluff stood through the water as dark stripes down the middle
 *  of it. Scaled by how vertical the row is, so the crest still lies almost
 *  on the river above the lip. */
const OFF_ROCK = 1.8
/** past this, the whole group is detached from the scene (M24) */
const DRAW_RANGE = 620

interface Built {
  def: FallDef
  group: THREE.Group
  mist: { sprite: THREE.Sprite; phase: number; rise: number; spread: number }[]
  attached: boolean
}

export class Waterfalls {
  readonly group = new THREE.Group()
  private falls: Built[] = []
  private mats: THREE.MeshStandardMaterial[] = []
  private time = 0
  private mistTex: THREE.Texture | null = null

  build(defs: FallDef[]): void {
    for (const def of defs) {
      if (def.path.length < 2) continue
      const g = new THREE.Group()
      g.name = `fall-${def.name}`
      g.add(this.sheet(def))
      g.add(this.plunge(def))
      const mist = this.mistOf(def, g)
      this.falls.push({ def, group: g, mist, attached: false })
    }
  }

  /** The sheet: a ribbon resampled along the traced profile by 3D arc length,
   *  offset off the rock along its own normal — which is horizontal on a
   *  sheer face and points up off the slope on a cascade, with no special
   *  case for either. */
  private sheet(def: FallDef): THREE.Mesh {
    const pts = def.path.map((p) => new THREE.Vector3(p.x, p.y, p.z))
    // THE CREST. Standing in the channel above the lip you could not tell
    // there was a thirty metre drop in front of you — the river simply ran
    // out of geometry, an infinity pool. A short flat tongue prepended
    // UPSTREAM of the lip, at the river's own surface, puts the white line
    // of the crest where the water actually goes over.
    {
      const d0 = new THREE.Vector3(pts[1].x - pts[0].x, 0, pts[1].z - pts[0].z)
      if (d0.lengthSq() > 1e-6) {
        d0.normalize()
        pts.unshift(new THREE.Vector3(pts[0].x - d0.x * 4, pts[0].y + 0.04, pts[0].z - d0.z * 4))
      }
    }
    // arc length along the profile, and a resample at ~1.4 m — a bake point
    // per metre of HORIZONTAL run means two of them can be thirty metres
    // apart in y on a vertical face
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const total = cum[cum.length - 1]
    const rows = Math.max(6, Math.min(64, Math.round(total / 1.4)))
    const at = (s: number): THREE.Vector3 => {
      if (s <= 0) return pts[0].clone()
      if (s >= total) return pts[pts.length - 1].clone()
      let i = 1
      while (i < cum.length - 1 && cum[i] < s) i++
      const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
      return pts[i - 1].clone().lerp(pts[i], t)
    }
    // one across-axis for the whole fall: the profile runs along a single
    // compass line by construction, and a per-row frame twists on the near
    // vertical segment where the xz tangent is almost nothing
    const flat = new THREE.Vector3(pts[pts.length - 1].x - pts[0].x, 0, pts[pts.length - 1].z - pts[0].z)
    if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0)
    flat.normalize()
    const across = new THREE.Vector3(-flat.z, 0, flat.x)

    const pos = new Float32Array((rows + 1) * 2 * 3)
    const uv = new Float32Array((rows + 1) * 2 * 2)
    const half = def.width / 2
    for (let r = 0; r <= rows; r++) {
      const s = (r / rows) * total
      const p = at(s)
      // the row's own tangent, then its normal — cross(across, tangent)
      const tan = at(Math.min(total, s + 0.4)).sub(at(Math.max(0, s - 0.4)))
      if (tan.lengthSq() < 1e-6) tan.set(0, -1, 0)
      tan.normalize()
      const nrm = across.clone().cross(tan).normalize()
      // the offset is only needed where the sheet lies ON something: at the
      // crest it is floating over the river, and half a metre of clearance
      // there reads as foam hovering above the water
      const off = OFF_ROCK * (0.08 + 0.92 * Math.abs(tan.y))
      // the sheet widens a little as it falls, the way a real one spreads
      const w = half * (1 + 0.22 * (r / rows))
      for (let c = 0; c < 2; c++) {
        const side = c === 0 ? -w : w
        const o = (r * 2 + c) * 3
        pos[o] = p.x + across.x * side + nrm.x * off
        pos[o + 1] = p.y + nrm.y * off
        pos[o + 2] = p.z + across.z * side + nrm.z * off
        uv[(r * 2 + c) * 2] = c
        uv[(r * 2 + c) * 2 + 1] = s
      }
    }
    const idx: number[] = []
    for (let r = 0; r < rows; r++) {
      const a = r * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, this.sheetMat(total))
    mesh.renderOrder = 5 // above every water sheet it lands in
    mesh.frustumCulled = true
    return mesh
  }

  private sheetMat(total: number): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcfe6f2,
      transparent: true,
      opacity: 0.95,
      roughness: 0.42,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide, // you can stand behind a waterfall
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      shader.uniforms.uTotal = { value: total }
      ;(mat.userData as { shader?: typeof shader }).shader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFallUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFallUv = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform float uTotal;
          varying vec2 vFallUv;
          float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float vn(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
          }`)
        .replace('#include <opaque_fragment>', `{
            float down = clamp(vFallUv.y / max(uTotal, 0.001), 0.0, 1.0);
            float across = vFallUv.x;
            // metres, scrolling down at a real falling speed — the eye reads
            // the RATE, and 2 m/s looks like syrup on a thirty metre drop
            float s = vFallUv.y - uTime * 11.0;
            // vertical striations: the ropes of water, not a flat sheet
            float ropes = vn(vec2(across * 9.0, s * 0.55)) * 0.6 + vn(vec2(across * 23.0, s * 1.4)) * 0.4;
            // and the broken veil that develops as it falls
            float veil = vn(vec2(across * 5.0 + 11.0, s * 0.22));
            float froth = smoothstep(0.25, 0.95, down);
            outgoingLight = mix(outgoingLight, vec3(1.0), (0.25 + 0.55 * froth) * smoothstep(0.35, 0.85, ropes));
            outgoingLight = mix(outgoingLight * vec3(0.86, 0.96, 1.0), outgoingLight, froth);
            // AND THE FALL MAKES ITS OWN LIGHT. Not a cheat: broken water is
            // a cloud of scattering droplets and it stays bright in shade,
            // which is the whole reason you can see one from a mile off. The
            // first cut lit the sheet like rock, and on this cliff — which
            // faces north-east and is in shadow at noon — a thirty metre
            // waterfall came out charcoal grey against charcoal grey.
            outgoingLight += vec3(0.42, 0.50, 0.56) * (0.45 + 0.85 * froth) * (0.6 + 0.4 * ropes);
            // thin and glassy at the lip, dense and white by the bottom
            float a = mix(0.62, 1.0, froth) * (0.78 + 0.22 * ropes);
            a *= 0.82 + 0.18 * veil;
            // feather the sides so the ribbon has no cut edge
            a *= smoothstep(0.0, 0.1, across) * smoothstep(1.0, 0.9, across);
            // the crest breaks white the moment it tips over
            a *= 0.55 + 0.45 * smoothstep(0.0, 0.035, down);
            diffuseColor.a *= clamp(a, 0.0, 1.0);
          }
          #include <opaque_fragment>`)
    }
    this.mats.push(mat)
    return mat
  }

  /** The plunge: a foam disc lying on the water at the foot, with rings
   *  breathing outward from where the sheet hits. */
  private plunge(def: FallDef): THREE.Mesh {
    const r = Math.max(6, def.width * 1.2)
    const geo = new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      roughness: 0.85,
      metalness: 0,
      depthWrite: false,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      ;(mat.userData as { shader?: typeof shader }).shader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPl;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPl = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; varying vec2 vPl;
          float h21b(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float vnb(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21b(i), h21b(i + vec2(1, 0)), u.x), mix(h21b(i + vec2(0, 1)), h21b(i + vec2(1, 1)), u.x), u.y);
          }`)
        .replace('#include <opaque_fragment>', `{
            vec2 d = vPl - 0.5;
            float rr = length(d) * 2.0;
            // rings running out from the impact
            float rings = 0.5 + 0.5 * sin(rr * 18.0 - uTime * 3.4);
            float churn = vnb(d * 34.0 + vec2(uTime * 0.7, -uTime * 0.5));
            float a = (1.0 - smoothstep(0.15, 1.0, rr)) * (0.45 + 0.55 * rings) * (0.35 + 0.65 * churn);
            outgoingLight += vec3(0.34, 0.40, 0.45) * a;
            diffuseColor.a *= clamp(a, 0.0, 1.0);
          }
          #include <opaque_fragment>`)
    }
    this.mats.push(mat)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(def.foot.x, Math.max(def.foot.y, 0) + 0.09, def.foot.z)
    mesh.renderOrder = 6
    return mesh
  }

  /** The mist: soft billboards climbing out of the plunge and fading. */
  private mistOf(def: FallDef, into: THREE.Group): Built['mist'] {
    if (!this.mistTex) this.mistTex = softDot()
    const out: Built['mist'] = []
    const n = 6
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.mistTex,
        color: 0xe9f4fa,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true,
      })
      const sp = new THREE.Sprite(mat)
      const size = def.width * (0.26 + i * 0.09)
      sp.scale.set(size, size, 1)
      sp.renderOrder = 7
      into.add(sp)
      out.push({ sprite: sp, phase: i / n, rise: def.width * (0.5 + i * 0.1), spread: def.width * 0.26 })
    }
    return out
  }

  /** Detach beyond DRAW_RANGE (M24: detach, don't hide) and animate the rest.
   *  Returns the distance to the nearest fall, in metres — ambience.ts turns
   *  that into the sound of one. */
  update(dt: number, cam: { x: number; y: number; z: number }): number {
    this.time += dt
    for (const m of this.mats) {
      const sh = (m.userData as { shader?: { uniforms: { uTime: { value: number } } } }).shader
      if (sh) sh.uniforms.uTime.value = this.time
    }
    let nearest = Infinity
    for (const f of this.falls) {
      const mid = f.def.path[Math.floor(f.def.path.length / 2)]
      const d = Math.hypot(cam.x - mid.x, cam.z - mid.z, (cam.y - mid.y) * 0.4)
      nearest = Math.min(nearest, d)
      const want = d < DRAW_RANGE
      if (want !== f.attached) {
        if (want) this.group.add(f.group)
        else this.group.remove(f.group)
        f.attached = want
      }
      if (!want) continue
      // the mist only exists close up; it is six sprites, but six sprites at
      // eight hundred metres are eight hundred metres of overdraw for nothing
      const mistFade = 1 - THREE.MathUtils.smoothstep(d, 60, 170)
      for (const m of f.mist) {
        m.phase += dt * 0.3
        if (m.phase >= 1) m.phase -= 1
        const t = m.phase
        const sway = Math.sin((t + m.rise) * 5.1) * m.spread
        m.sprite.position.set(
          f.def.foot.x + sway,
          Math.max(f.def.foot.y, 0) + t * m.rise + 0.6,
          f.def.foot.z + Math.cos((t + m.rise) * 4.3) * m.spread,
        )
        const mat = m.sprite.material as THREE.SpriteMaterial
        mat.opacity = Math.sin(t * Math.PI) * 0.2 * mistFade
      }
    }
    return nearest
  }

  /** Put every fall in the scene for the boot warm-up. The falls are
   *  detached until you are within DRAW_RANGE, so without this their sheet
   *  and plunge programs would compile the moment the cliff came into view —
   *  a hitch on arrival at exactly the place the round is about (M18/M32's
   *  lesson, applied before it could be felt). Returns the undo. */
  attachForWarmup(): () => void {
    const added = this.falls.filter((f) => !f.attached)
    for (const f of added) this.group.add(f.group)
    return () => { for (const f of added) this.group.remove(f.group) }
  }

  /** QA (gate + tools/qa-water.mjs): what the world actually built. */
  debug(): { name: string; drop: number; top: number; foot: number; attached: boolean; path: { x: number; y: number; z: number }[] }[] {
    return this.falls.map((f) => ({
      name: f.def.name,
      drop: f.def.drop,
      top: f.def.top.y,
      foot: f.def.foot.y,
      attached: f.attached,
      path: f.def.path,
    }))
  }
}

/** A soft round blob, drawn once and shared by every mist sprite. */
function softDot(): THREE.Texture {
  const S = 64
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
