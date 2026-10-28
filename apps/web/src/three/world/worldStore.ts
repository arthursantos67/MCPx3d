import { validateWorld, type ThreeWorldDocument } from './worldDocument.ts'
import type { SceneProgress } from '../sceneProgress.ts'

/**
 * The open world and its play progress in IndexedDB: worlds with detailed locations outgrow localStorage, and a
 * generation checkpoint must survive a reload. Every call fails soft (private mode, blocked storage, quota): the
 * caller shows the error and keeps working in memory.
 */
const DATABASE = 'forma-worlds', STORE = 'worlds', VERSION = 1

export interface WorldProgress { position: [number, number, number]; discovered: string[]; visited: string[]; fog: string; savedAt: number; game?: SceneProgress; seed?: number }
interface Entry { key: string; world: ThreeWorldDocument; progress?: WorldProgress; savedAt: number }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponível neste navegador.')); return }
    const request = indexedDB.open(DATABASE, VERSION)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento de mundos.'))
  })
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode), request = work(transaction.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('Falha no armazenamento de mundos.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Armazenamento de mundos cancelado (espaço insuficiente?).'))
    })
  } finally { db.close() }
}

export const CURRENT_WORLD = 'atual'

export async function saveWorld(world: ThreeWorldDocument, progress?: WorldProgress, key = CURRENT_WORLD): Promise<void> {
  const previous = progress ? undefined : await loadEntry(key).catch(() => null)
  await run('readwrite', (store) => store.put({ key, world, progress: progress ?? previous?.progress, savedAt: Date.now() } satisfies Entry))
}
async function loadEntry(key: string): Promise<Entry | null> { return (await run<Entry | undefined>('readonly', (store) => store.get(key))) ?? null }
/** The saved world, validated like an import (a damaged entry is reported, never used). */
export async function loadWorld(key = CURRENT_WORLD): Promise<{ world: ThreeWorldDocument; progress: WorldProgress | null } | null> {
  const entry = await loadEntry(key)
  return entry ? { world: validateWorld(entry.world), progress: entry.progress ?? null } : null
}
export async function clearWorld(key = CURRENT_WORLD): Promise<void> { await run('readwrite', (store) => store.delete(key)) }

/** Play progress is stored apart from the (large) world, so it can be saved every few seconds cheaply. */
const progressKey = (world: string) => `progresso:${world}`
export async function saveProgress(world: string, progress: WorldProgress): Promise<void> {
  await run('readwrite', (store) => store.put({ key: progressKey(world), progress, savedAt: Date.now() }))
}
export async function loadProgress(world: string): Promise<WorldProgress | null> {
  const entry = await run<{ progress?: WorldProgress } | undefined>('readonly', (store) => store.get(progressKey(world)))
  return entry?.progress ?? null
}
