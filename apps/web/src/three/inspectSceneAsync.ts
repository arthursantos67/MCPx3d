import type { ThreeSceneDocument } from './sceneDocument.ts'
import { inspectSceneGeometry, type SceneInspection } from './sceneInspection.ts'

export async function inspectSceneAsync(doc: ThreeSceneDocument, signal: AbortSignal): Promise<SceneInspection> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Inspeção cancelada', 'AbortError')
  // Node tests exercise exactly the same kernel without browser workers.
  if (typeof Worker === 'undefined') return inspectSceneGeometry(doc)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sceneInspection.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); clearTimeout(deadline); signal.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); reject(signal.reason ?? new DOMException('Inspeção cancelada', 'AbortError')) }
    const deadline = setTimeout(() => { cleanup(); reject(new Error('A inspeção espacial excedeu 45 segundos. Reduza a complexidade ou inspecione uma cena menor.')) }, 45000)
    worker.onmessage = (event: MessageEvent<{ report?: SceneInspection; error?: string }>) => {
      cleanup()
      if (event.data.report) resolve(event.data.report)
      else reject(new Error(event.data.error ?? 'A inspeção espacial falhou.'))
    }
    worker.onerror = () => { cleanup(); reject(new Error('Não foi possível executar a inspeção espacial.')) }
    signal.addEventListener('abort', cancel, { once: true })
    worker.postMessage(doc)
  })
}
