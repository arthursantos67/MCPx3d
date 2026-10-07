import { useEffect, useState } from 'react'
import type { CadDraftSpec } from '../../../../packages/domain/ts/src/cad-draft.ts'
import { meshCadAssembly, meshCadProgram, meshCadDraft, type CadProgramMesh } from '../api/cad.ts'

export function useCadPreview(spec: CadDraftSpec | null, enabled: boolean, draftMode = false) {
  const [preview, setPreview] = useState<{ mesh: CadProgramMesh; source: string } | null>(null)
  const [failure, setFailure] = useState<{ source: string; message: string } | null>(null)
  const source = spec ? JSON.stringify(spec) : ''
  useEffect(() => {
    if (!enabled || !source) return
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      const candidate = JSON.parse(source) as CadDraftSpec
      const request = draftMode ? meshCadDraft(candidate, abort.signal)
        : candidate.schemaVersion === '4.0' ? meshCadAssembly(candidate, abort.signal) : meshCadProgram(candidate, abort.signal)
      void request.then((mesh) => {
        if (!abort.signal.aborted) { setPreview({ mesh, source }); setFailure(null) }
      }).catch((error: unknown) => {
        if (!abort.signal.aborted) setFailure({ source, message: error instanceof Error ? error.message : String(error) })
      })
    }, 400)
    return () => { window.clearTimeout(timer); abort.abort() }
  }, [source, enabled, draftMode])
  return {
    mesh: source ? preview?.mesh ?? null : null,
    error: failure?.source === source ? failure.message : null,
    pending: !!source && preview?.source !== source && failure?.source !== source,
    stale: !!preview && preview.source !== source,
  }
}
