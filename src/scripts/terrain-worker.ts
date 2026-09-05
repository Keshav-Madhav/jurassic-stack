// The terrain worker: builds chunk geometry arrays off the main thread. It
// loads the same baked world (the browser cache serves the second fetch) and
// runs the same terrain-paint code, so its output is byte-identical to a
// main-thread build — only the frame no longer pays for it.
import { loadHeightmap } from './heightmap'
import { buildChunkArrays } from './terrain-paint'

interface InitMsg { type: 'init'; base: string }
interface BuildMsg { type: 'build'; id: number; originX: number; originZ: number; quads: number; size: number }

let ready: Promise<void> | null = null

self.onmessage = async (e: MessageEvent<InitMsg | BuildMsg>) => {
  const msg = e.data
  if (msg.type === 'init') {
    ready = loadHeightmap(msg.base)
    await ready
    ;(self as unknown as Worker).postMessage({ type: 'ready' })
    return
  }
  if (!ready) return
  await ready
  const a = buildChunkArrays(msg.originX, msg.originZ, msg.quads, msg.size)
  ;(self as unknown as Worker).postMessage(
    { type: 'built', id: msg.id, pos: a.pos, nor: a.nor, col: a.col, spl: a.spl, indices: a.indices },
    [a.pos.buffer, a.nor.buffer, a.col.buffer, a.spl.buffer, a.indices.buffer],
  )
}
