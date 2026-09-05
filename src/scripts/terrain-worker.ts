// The terrain worker: builds chunk geometry arrays off the main thread. It
// loads the same baked world (the browser cache serves the second fetch) and
// runs the same terrain-paint code, so its output is byte-identical to a
// main-thread build — only the frame no longer pays for it.
import { loadHeightmap } from './heightmap'
import { buildChunkArrays } from './terrain-paint'
import { buildGrassTile } from './grass-gen'

interface InitMsg { type: 'init'; base: string }
interface BuildMsg { type: 'build'; id: number; originX: number; originZ: number; quads: number; size: number }
interface GrassMsg { type: 'grass'; id: number; tx: number; tz: number; spacing: number }

let ready: Promise<void> | null = null

self.onmessage = async (e: MessageEvent<InitMsg | BuildMsg | GrassMsg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    ready = loadHeightmap(msg.base)
    await ready
    ;(self as unknown as Worker).postMessage({ type: 'ready' })
    return
  }
  if (!ready) return
  await ready
  if (msg.type === 'grass') {
    const g = buildGrassTile(msg.tx, msg.tz, msg.spacing)
    // subarrays share the big buffer: copy so the transfer is tight
    const matrices = new Float32Array(g.matrices)
    const colors = new Float32Array(g.colors)
    ;(self as unknown as Worker).postMessage({ type: 'grassBuilt', id: msg.id, matrices, colors, count: g.count }, [matrices.buffer, colors.buffer])
    return
  }
  const a = buildChunkArrays(msg.originX, msg.originZ, msg.quads, msg.size)
  ;(self as unknown as Worker).postMessage(
    { type: 'built', id: msg.id, pos: a.pos, nor: a.nor, col: a.col, spl: a.spl, indices: a.indices },
    [a.pos.buffer, a.nor.buffer, a.col.buffer, a.spl.buffer, a.indices.buffer],
  )
}
