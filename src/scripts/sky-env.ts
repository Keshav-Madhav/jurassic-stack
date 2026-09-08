// The environment map, through the day — baked once, blended forever.
//
// M19 tried re-baking the PMREM as the sun moved and it cost 20-40 ms a bake
// AND jumped visibly in every reflection, so it was frozen at a mid-morning
// sky. Everything reflective has been lying about the time of day ever since:
// the sea reflects mid-morning at dusk, which is exactly why M44's attempt to
// make the water glassier turned it white.
//
// The fix is to precompute instead of recompute (M45). Eight skies are baked
// at load, behind the boot card, one per three hours of the island's day. At
// runtime the two either side of "now" are BLENDED — and that blend is a plain
// full-screen mix of two 2D images, because a PMREM is a 2D texture with its
// mip chain packed into it, not a live cubemap. Nothing is re-filtered, so the
// per-frame cost is one quad and the light in a puddle tracks the sun.
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'

/** how many skies to bake across one day — eight is every three island hours */
const STEPS = 8

const BlendShader = {
  uniforms: {
    tA: { value: null as THREE.Texture | null },
    tB: { value: null as THREE.Texture | null },
    mixT: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA;
    uniform sampler2D tB;
    uniform float mixT;
    varying vec2 vUv;
    void main() { gl_FragColor = mix( texture2D( tA, vUv ), texture2D( tB, vUv ), mixT ); }`,
}

export class SkyEnvironment {
  private baked: THREE.WebGLRenderTarget[] = []
  private blend: THREE.WebGLRenderTarget | null = null
  private quad: THREE.Mesh
  private quadScene = new THREE.Scene()
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private material: THREE.ShaderMaterial
  private lastIndex = -1
  private lastT = -1

  constructor(private renderer: THREE.WebGLRenderer) {
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(BlendShader.uniforms),
      vertexShader: BlendShader.vertexShader,
      fragmentShader: BlendShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
  }

  /** Bake the day's skies. Call once, at load — it costs ~8 PMREM generations. */
  bake(skyOf: (t: number) => { sunPosition: THREE.Vector3; turbidity: number; rayleigh: number }): void {
    if (this.baked.length) return
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    pmrem.compileCubemapShader()
    const scene = new THREE.Scene()
    const sky = new Sky()
    sky.scale.setScalar(45000)
    scene.add(sky)
    const u = sky.material.uniforms
    u.mieCoefficient.value = 0.004
    u.mieDirectionalG.value = 0.85
    for (let i = 0; i < STEPS; i++) {
      const cfg = skyOf(i / STEPS)
      u.sunPosition.value.copy(cfg.sunPosition)
      u.turbidity.value = cfg.turbidity
      u.rayleigh.value = cfg.rayleigh
      this.baked.push(pmrem.fromScene(scene, 0, 0.1, 1000))
    }
    scene.remove(sky)
    pmrem.dispose()

    // the blend target mirrors a PMREM exactly — same size, same format, and
    // the CubeUV mapping flag, which is what tells three it is prefiltered
    const src = this.baked[0]
    this.blend = new THREE.WebGLRenderTarget(src.width, src.height, {
      type: src.texture.type,
      format: src.texture.format as THREE.PixelFormat,
      colorSpace: src.texture.colorSpace as THREE.ColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    })
    this.blend.texture.mapping = THREE.CubeUVReflectionMapping
    ;(this.blend.texture as THREE.Texture & { isRenderTargetTexture: boolean }).isRenderTargetTexture = true
  }

  get texture(): THREE.Texture | null {
    return this.blend?.texture ?? null
  }

  /** Point the environment at `time` (0-1 through the day). Cheap: it only
   *  redraws when the blend has actually moved. */
  update(time: number): void {
    if (!this.blend || !this.baked.length) return
    const pos = ((time % 1) + 1) % 1 * STEPS
    const i = Math.floor(pos) % STEPS
    const t = pos - Math.floor(pos)
    if (i === this.lastIndex && Math.abs(t - this.lastT) < 0.01) return
    this.lastIndex = i
    this.lastT = t
    this.material.uniforms.tA.value = this.baked[i].texture
    this.material.uniforms.tB.value = this.baked[(i + 1) % STEPS].texture
    this.material.uniforms.mixT.value = t
    const prev = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.blend)
    this.renderer.render(this.quadScene, this.quadCam)
    this.renderer.setRenderTarget(prev)
  }

  /** QA: how many skies are baked, and where the blend sits */
  debug(): { steps: number; index: number; t: number; size: number } {
    return { steps: this.baked.length, index: this.lastIndex, t: +this.lastT.toFixed(2), size: this.blend?.width ?? 0 }
  }
}
