import { runWorldJob } from './worldJobs.ts'
import type { WorldRequest, WorldResponse } from './worldProtocol.ts'

self.onmessage = (event: MessageEvent<WorldRequest>) => {
  const { id, ...job } = event.data
  try {
    const { result, transfer } = runWorldJob(job)
    self.postMessage({ id, ok: true, result } satisfies WorldResponse, { transfer })
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorldResponse)
  }
}
