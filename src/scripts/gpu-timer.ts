// Honest GPU time, in the running game.
//
// The JS timer around renderer.render() measures SUBMIT — the CPU walking the
// scene and handing commands to the driver. It returns long before the GPU has
// drawn anything, so a fill-bound frame reads as "2.6 ms render" while the
// screen updates at 30 fps. EXT_disjoint_timer_query_webgl2 asks the GPU
// itself. This is the instrument PERFORMANCE.md is written against, and the
// one number a friend on a Windows laptop can screenshot for us (F3).
//
// Queries resolve a frame or two late, so one query is opened per frame and
// drained when ready; a disjoint (context switch, thermal event) throws the
// whole batch away rather than reporting a lie.
export class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  private open: WebGLQuery | null = null
  private pending: WebGLQuery[] = []
  private pool: WebGLQuery[] = []
  private samples: number[] = []

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  }

  get supported(): boolean {
    return this.ext !== null
  }

  /** Open a query around this frame's render. No-op when unsupported or backed up. */
  begin(): void {
    if (!this.ext || this.open || this.pending.length > 3) return
    const q = this.pool.pop() ?? this.gl.createQuery()
    if (!q) return
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
    this.open = q
  }

  end(): void {
    if (!this.ext || !this.open) return
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.open)
    this.open = null
  }

  /** Drain whatever the GPU has finished. Call once a frame, before begin(). */
  poll(): void {
    if (!this.ext) return
    const gl = this.gl
    if (gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      // the timings in flight are meaningless
      for (const q of this.pending) this.pool.push(q)
      this.pending.length = 0
      this.samples.length = 0
      return
    }
    while (this.pending.length) {
      const q = this.pending[0]
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      this.pending.shift()
      this.samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6)
      if (this.samples.length > 240) this.samples.shift()
      this.pool.push(q)
    }
  }

  /** median GPU ms over the window of recent frames (0 until the first result lands) */
  median(): number {
    return this.pct(0.5)
  }

  /** The tenth percentile — what this scene costs when nothing else is
   *  interfering. Medians moved 2-3 ms between reads of an IDENTICAL frame
   *  (compositor, GPU clock states, other windows), which is far too coarse to
   *  judge a lever by; the low percentile is stable to a tenth (M31). */
  pct(p: number): number {
    if (!this.samples.length) return 0
    const a = this.samples.slice().sort((x, y) => x - y)
    return a[Math.min(a.length - 1, Math.floor(p * a.length))]
  }

  /** the slowest frame in the window — a hitch the median hides */
  max(): number {
    return this.samples.length ? Math.max(...this.samples) : 0
  }

  /** which GPU is this, for a screenshot from someone else's machine */
  static rendererName(gl: WebGL2RenderingContext): string {
    const e = gl.getExtension('WEBGL_debug_renderer_info')
    if (!e) return 'GPU unknown'
    return String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)).replace(/^ANGLE \(|\)$/g, '').slice(0, 52)
  }
}
