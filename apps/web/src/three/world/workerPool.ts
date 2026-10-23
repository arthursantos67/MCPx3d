import type { WorldJob, WorldJobResults, WorldRequest, WorldResponse } from './worldProtocol.ts'

export interface WorldPool {
  readonly size: number
  run<T extends WorldJob>(job: T, priority?: number): Promise<WorldJobResults[T['type']]>
  /** Jobs waiting for a worker. */
  readonly queued: number
  /** Drops queued (not yet started) jobs rejected by `keep`; their promises reject with an AbortError. */
  prune(keep: (job: WorldJob) => boolean): void
  dispose(): void
}

interface Pending { id: number; job: WorldJob; priority: number; resolve: (value: never) => void; reject: (error: Error) => void }

/** Workers each run one job at a time; the queue is ordered by priority (lower first), then submission order. */
export function createWorldPool(factory: () => Worker, size: number): WorldPool {
  const workers = Array.from({ length: Math.max(1, size) }, factory), busy = new Map<Worker, Pending>(), queue: Pending[] = []
  let next = 1, disposed = false
  const pump = () => {
    for (const worker of workers) {
      if (busy.has(worker) || !queue.length) continue
      const item = queue.shift()!
      busy.set(worker, item)
      worker.postMessage({ ...item.job, id: item.id } satisfies WorldRequest)
    }
  }
  for (const worker of workers) {
    worker.onmessage = (event: MessageEvent<WorldResponse>) => {
      const item = busy.get(worker)
      busy.delete(worker)
      if (item && item.id === event.data.id) {
        if (event.data.ok) item.resolve(event.data.result as never)
        else item.reject(new Error(event.data.error))
      }
      if (!disposed) pump()
    }
    worker.onerror = (event) => {
      const item = busy.get(worker)
      busy.delete(worker)
      item?.reject(new Error(event.message || 'Falha no worker do mundo.'))
      if (!disposed) pump()
    }
  }
  return {
    size: workers.length,
    get queued() { return queue.length },
    run(job, priority = 0) {
      if (disposed) return Promise.reject(new Error('Pool de workers encerrado.'))
      return new Promise((resolve, reject) => {
        const item: Pending = { id: next++, job, priority, resolve: resolve as (value: never) => void, reject }
        let index = queue.length
        while (index > 0 && queue[index - 1].priority > priority) index--
        queue.splice(index, 0, item)
        pump()
      })
    },
    prune(keep) {
      for (let index = queue.length - 1; index >= 0; index--) if (!keep(queue[index].job)) queue.splice(index, 1)[0].reject(new DOMException('Trabalho descartado.', 'AbortError'))
    },
    dispose() {
      disposed = true
      for (const item of queue.splice(0)) item.reject(new DOMException('Pool encerrado.', 'AbortError'))
      for (const item of busy.values()) item.reject(new DOMException('Pool encerrado.', 'AbortError'))
      busy.clear()
      for (const worker of workers) worker.terminate()
    },
  }
}

export function createWorldWorkers(): WorldPool {
  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4
  return createWorldPool(() => new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' }), Math.min(4, Math.max(1, cores - 2)))
}
