// Water: ocean + lakes + river ribbons, one shared animated material, and the
// gameplay queries (waterLevelAt / riverFlowAt) that drive swimming and
// currents. Deliberately refraction-only — the three.js Water addons render
// the whole scene again per reflective surface, which an island with five
// water bodies cannot afford. Motion comes from scrolling analytic normal
// perturbation injected into MeshStandardMaterial, plus small Gerstner-ish
// vertex swell on the ocean.
import * as THREE from 'three'
import { heightAt, SEA_LEVEL, HALF_SIZE, worldMeta } from './heightmap'

const RIVER_HALF_WIDTH = 11
/** water surface height above the carved bed — deep enough to actually swim */
const RIVER_SURFACE_ABOVE_BED = 1.35

interface RiverSample {
  x: number
  z: number
  /** water surface height at this sample */
  y: number
  /** downstream tangent (unit XZ) */
  tx: number
  tz: number
}

/** One data structure drives BOTH the ribbon mesh and the physics queries —
 *  v1 derived them separately and they disagreed (mesh buried underground
 *  while the query floated the player a meter above it). */
interface RiverRuntime {
  samples: RiverSample[]
}

export class WaterSystem {
  readonly group = new THREE.Group()
  private materials: THREE.MeshStandardMaterial[] = []
  private rivers: RiverRuntime[] = []
  private time = 0

  build(): void {
    const meta = worldMeta!

    // --- ocean ---
    const oceanGeo = new THREE.PlaneGeometry(HALF_SIZE * 6, HALF_SIZE * 6, 96, 96).rotateX(-Math.PI / 2)
    const ocean = new THREE.Mesh(oceanGeo, this.makeWaterMat(0x2e6ba8, 0.9, new THREE.Vector2(0.4, 0.2), 0.28))
    ocean.position.y = SEA_LEVEL
    this.group.add(ocean)

    // --- swamp: one broad sheet at the marsh water table; carved pool
    // depressions below it read as scattered ponds ---
    if (meta.swamp) {
      const sw = meta.swamp
      const geo = new THREE.CircleGeometry(sw.r * 1.02, 48).rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(geo, this.makeWaterMat(0x39493a, 0.9, new THREE.Vector2(0.03, 0.02), 0))
      mesh.position.set(sw.x, sw.level, sw.z)
      this.group.add(mesh)
    }

    // --- lakes ---
    for (const lake of meta.lakes) {
      // slightly inside the carved basin so the rim never overhangs lower
      // terrain outside it (the "floating infinity pool" edge)
      const geo = new THREE.CircleGeometry(lake.r * 0.92, 40).rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(geo, this.makeWaterMat(0x3878b0, 0.88, new THREE.Vector2(0.12, 0.06), 0))
      mesh.position.set(lake.x, lake.level, lake.z)
      this.group.add(mesh)
    }

    // --- rivers: ribbon along a Catmull-Rom of the baked path ---
    for (const path of meta.rivers) {
      const pts = path.map((p) => new THREE.Vector3(p.x, 0, p.z))
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
      const SEGS = 120
      // one sample array: xz from the smooth curve, y from the LOCAL carved
      // bed (+surface offset), softly monotonic downstream but always floored
      // just above the bed so the ribbon can never sink under a bank
      const samples: RiverSample[] = []
      let prev = Infinity
      for (let i = 0; i <= SEGS; i++) {
        const t = i / SEGS
        const c = curve.getPoint(t)
        const tan = curve.getTangent(t)
        const bed = heightAt(c.x, c.z)
        let y = Math.min(bed + RIVER_SURFACE_ABOVE_BED, prev)
        y = Math.max(y, bed + 0.4, SEA_LEVEL + 0.05)
        samples.push({ x: c.x, z: c.z, y, tx: tan.x, tz: tan.z })
        prev = y
      }
      // 4-column cross-section: flat surface between the inner columns, outer
      // edges TUCKED DOWN below the banks — bank micro-bumps between samples
      // made a flat 2-column ribbon read as floating (user report)
      const COLS = 4
      const pos = new Float32Array((SEGS + 1) * COLS * 3)
      const uv = new Float32Array((SEGS + 1) * COLS * 2)
      for (let i = 0; i <= SEGS; i++) {
        const t = i / SEGS
        const s = samples[i]
        const nx = -s.tz
        const nz = s.tx
        const maxW = RIVER_HALF_WIDTH * (0.7 + 0.5 * t)
        let wL = maxW
        while (wL > 3 && heightAt(s.x + nx * wL, s.z + nz * wL) > s.y - 0.3) wL -= 1
        let wR = maxW
        while (wR > 3 && heightAt(s.x - nx * wR, s.z - nz * wR) > s.y - 0.3) wR -= 1
        const xs = [wL + 2.5, wL * 0.55, -wR * 0.55, -(wR + 2.5)]
        const ys = [s.y - 0.9, s.y, s.y, s.y - 0.9]
        for (let c = 0; c < COLS; c++) {
          const o = (i * COLS + c) * 3
          pos[o] = s.x + nx * xs[c]
          pos[o + 1] = ys[c]
          pos[o + 2] = s.z + nz * xs[c]
          uv[(i * COLS + c) * 2] = c / (COLS - 1)
          uv[(i * COLS + c) * 2 + 1] = t * 40
        }
      }
      const indices: number[] = []
      for (let i = 0; i < SEGS; i++) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = i * COLS + c
          const b = a + 1
          const d = a + COLS
          const e = d + 1
          indices.push(a, d, b, b, d, e)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      geo.setIndex(indices)
      geo.computeVertexNormals()
      // depth tint: darker where the bed drops away (per-vertex color)
      const colors = new Float32Array((SEGS + 1) * COLS * 3)
      for (let i = 0; i <= SEGS; i++) {
        for (let c = 0; c < COLS; c++) {
          const vi = (i * COLS + c) * 3
          const vx = pos[vi]
          const vz = pos[vi + 2]
          const depth = THREE.MathUtils.clamp((samples[i].y - heightAt(vx, vz)) / 3.2, 0, 1)
          const k = 1 - depth * 0.55
          colors[vi] = k
          colors[vi + 1] = k
          colors[vi + 2] = 1 // keep blue
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const mesh = new THREE.Mesh(geo, this.makeWaterMat(0x4a90c0, 0.85, new THREE.Vector2(0, -2.6), 0, true))
      this.group.add(mesh)

      this.rivers.push({ samples })
    }
  }

  /** Shared animated standard material; flow = UV scroll direction. */
  private makeWaterMat(
    color: number,
    opacity: number,
    flow: THREE.Vector2,
    swell: number,
    foam = false,
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color,
      vertexColors: foam, // rivers carry depth tint in vertex colors
      transparent: true,
      opacity,
      roughness: 0.18,
      metalness: 0,
      depthWrite: false,
      // double-sided: visible from underwater, and immune to ribbon-winding
      // direction (the river ribbon wound face-down — invisible from above
      // with default FrontSide; cost is negligible for five meshes)
      side: THREE.DoubleSide,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      shader.uniforms.uFlow = { value: flow }
      shader.uniforms.uSwell = { value: swell }
      shader.uniforms.uFoam = { value: foam ? 1 : 0 }
      ;(mat.userData as { shader?: typeof shader }).shader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSwell;\nvarying vec3 vWaterWorld;\nvarying vec2 vWaterUv;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          if (uSwell > 0.0) {
            transformed.y += uSwell * (sin(wp0.x * 0.045 + uTime * 1.1) * 0.6 + sin(wp0.z * 0.06 + uTime * 0.8) * 0.4);
          }
          vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWaterUv = uv;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uFlow;\nuniform float uFoam;\nvarying vec3 vWaterWorld;\nvarying vec2 vWaterUv;')
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
          {
            vec2 p = vWaterWorld.xz + uFlow * uTime * 2.0;
            float nx = sin(p.x * 0.9 + uTime * 1.7) * 0.5 + sin(p.x * 0.37 - uTime * 1.1 + p.y * 0.2) * 0.5;
            float nz = sin(p.y * 0.8 - uTime * 1.3) * 0.5 + sin(p.y * 0.41 + uTime * 0.9 + p.x * 0.23) * 0.5;
            normal = normalize(normal + vec3(nx, 0.0, nz) * 0.22);
          }`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
            if (uFoam > 0.5) {
              // churning foam bands along both banks
              float bank = 1.0 - smoothstep(0.02, 0.16, vWaterUv.x) * smoothstep(0.98, 0.84, vWaterUv.x);
              float churn = 0.6 + 0.4 * sin(vWaterUv.y * 60.0 - uTime * 5.0 + sin(vWaterWorld.x * 0.7) * 3.0);
              float f = clamp(bank * churn, 0.0, 1.0) * 0.75;
              outgoingLight = mix(outgoingLight, vec3(0.92, 0.96, 1.0), f);
              diffuseColor.a = min(1.0, diffuseColor.a + f * 0.35);
            }
          }
          #include <opaque_fragment>`,
        )
    }
    this.materials.push(mat)
    return mat
  }

  update(dt: number): void {
    this.time += dt
    for (const m of this.materials) {
      const shader = (m.userData as { shader?: { uniforms: { uTime: { value: number } } } }).shader
      if (shader) shader.uniforms.uTime.value = this.time
    }
  }

  /** Water surface height at a point, or null if the point isn't over water. */
  waterLevelAt(x: number, z: number): number | null {
    const meta = worldMeta!
    let level: number | null = null
    // ocean wherever the terrain is below sea level
    if (heightAt(x, z) < SEA_LEVEL) level = SEA_LEVEL
    for (const lake of meta.lakes) {
      if (Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.1 && heightAt(x, z) < lake.level - 0.2) {
        level = Math.max(level ?? -Infinity, lake.level)
      }
    }
    if (meta.swamp && Math.hypot(x - meta.swamp.x, z - meta.swamp.z) < meta.swamp.r * 1.02 && heightAt(x, z) < meta.swamp.level - 0.15) {
      level = Math.max(level ?? -Infinity, meta.swamp.level)
    }
    for (const r of this.rivers) {
      const hit = nearestSample(x, z, r.samples)
      if (hit.d > RIVER_HALF_WIDTH * 1.35) continue
      if (heightAt(x, z) < hit.y - 0.25) level = Math.max(level ?? -Infinity, hit.y)
    }
    return level
  }

  /** Downstream flow direction (unit XZ) if inside a river channel. */
  riverFlowAt(x: number, z: number): { x: number; z: number } | null {
    for (const r of this.rivers) {
      const hit = nearestSample(x, z, r.samples)
      if (hit.d > RIVER_HALF_WIDTH * 1.35) continue
      const len = Math.hypot(hit.tx, hit.tz) || 1
      return { x: hit.tx / len, z: hit.tz / len }
    }
    return null
  }
}

/** Closest river sample (interpolated along segments) to a point. */
function nearestSample(px: number, pz: number, samples: RiverSample[]): { d: number; y: number; tx: number; tz: number } {
  let best = Infinity
  let by = 0
  let btx = 0
  let btz = 1
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]
    const b = samples[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)))
    const d = Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t))
    if (d < best) {
      best = d
      by = a.y * (1 - t) + b.y * t
      btx = a.tx * (1 - t) + b.tx * t
      btz = a.tz * (1 - t) + b.tz * t
    }
  }
  return { d: best, y: by, tx: btx, tz: btz }
}
