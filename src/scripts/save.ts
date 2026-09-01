// Save/load: one versioned blob in IndexedDB (via a minimal inline key-value
// helper — idb-keyval's core is ~20 lines and not worth a dependency yet).
// Autosaved every 30 s and on pagehide; loaded on boot when present.
const DB = 'jurassic-stack'
const STORE = 'saves'
const KEY = 'slot-0'
export const SAVE_VERSION = 2 // v2: scatter RNG stream changed (variants) — v1 node ids invalid

function withStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => resolve(open.result.transaction(STORE, mode).objectStore(STORE))
  })
}

export interface SaveFile {
  version: number
  savedAt: number
  time: number
  player: { x: number; y: number; z: number; hp: number }
  inventory: unknown
  pieces: unknown
  deadNodes: unknown
  dinos: unknown
}

export async function saveGame(data: SaveFile): Promise<void> {
  const store = await withStore('readwrite')
  await new Promise<void>((resolve, reject) => {
    const req = store.put(data, KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function loadGame(): Promise<SaveFile | null> {
  try {
    const store = await withStore('readonly')
    return await new Promise((resolve, reject) => {
      const req = store.get(KEY)
      req.onsuccess = () => {
        const v = req.result as SaveFile | undefined
        resolve(v && v.version === SAVE_VERSION ? v : null)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function wipeSave(): Promise<void> {
  const store = await withStore('readwrite')
  await new Promise<void>((resolve) => {
    const req = store.delete(KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
}
