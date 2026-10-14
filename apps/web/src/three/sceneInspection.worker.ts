import { inspectSceneGeometry } from './sceneInspection.ts'
import { validateScene } from './sceneDocument.ts'
self.onmessage = (event: MessageEvent<unknown>) => {
  try { self.postMessage({ report: inspectSceneGeometry(validateScene(event.data)) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
