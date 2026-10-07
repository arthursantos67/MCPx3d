import { useState } from 'react'
import type { CadDraftSnapshot } from '../../../../packages/domain/ts/src/cad-draft.ts'
import { downloadCadDraftBundle, downloadCadDraftJson } from '../api/cad.ts'

export default function CadDraftPanel({ draft, busy, persistenceFailed }: {
  readonly draft: CadDraftSnapshot; readonly busy: boolean; readonly persistenceFailed: boolean
}) {
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const count = draft.spec.schemaVersion === '4.0' ? draft.spec.components.length : 1
  const download = async () => {
    setExporting(true); setMessage(null)
    try { await downloadCadDraftBundle(draft); setMessage('Rascunho exportado. Consulte report.json para saber quais componentes e etapas foram incluídos.') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setExporting(false) }
  }
  return <div className="cad-workspace__notice" aria-label="Geometria disponível do rascunho">
    <strong>Rascunho disponível · {draft.spec.partId}</strong>
    <p>{count} componentes no rascunho{draft.plannedComponentIds ? ` de ${draft.plannedComponentIds.length} planejados` : ''}. Montagem ainda não aprovada.</p>
    <p>Baixe a geometria disponível mesmo se a geração falhou. O ZIP contém STEP, STL, o JSON original e um relatório de etapas ou peças omitidas. Uma etapa inválida pode deixar apenas a geometria construída antes dela.</p>
    {draft.issue && <details><summary>Falha pendente</summary><p>{draft.issue}</p></details>}
    {draft.request && <details><summary>Pedido conservado</summary><p>{draft.request}</p></details>}
    {persistenceFailed && <p>O navegador não conseguiu guardar este rascunho. Baixe o JSON para conservar o trabalho.</p>}
    <div className="cad-program__actions">
      <button type="button" disabled={busy || exporting} onClick={() => void download()}>{exporting ? 'Preparando rascunho…' : 'Baixar rascunho STEP/STL (ZIP)'}</button>
      <button type="button" disabled={busy} onClick={() => downloadCadDraftJson(draft)}>Baixar geometria original (JSON)</button>
    </div>
    {message && <p role="status">{message}</p>}
  </div>
}
