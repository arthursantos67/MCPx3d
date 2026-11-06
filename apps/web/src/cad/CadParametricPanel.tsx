import { useRef, useState } from 'react'
import { CAD_DESIGNS, CadDesignError, compileCadDesign, newCadDesign, type CadDesignDocument, type CadDesignKind } from '../../../../packages/domain/ts/src/cad-parametric.ts'
import type { CadProgramSpec } from '../../../../packages/domain/ts/src/cad-program.ts'
import { cadIdentity } from '../../../../packages/agent/src/cad-identity.ts'
import { downloadBlob } from '../api/http.ts'
import { downloadCadProgramStep, downloadCadRevisionStl, inspectCadProgram, saveCadProgram, type CadProgramProject } from '../api/cad.ts'

const STORAGE_KEY = 'forma:cad-parametric-1'
function recoverDesign(): CadDesignDocument {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return compileCadDesign(JSON.parse(raw)).document } catch { /* A bad draft never prevents opening CAD. */ }
  return newCadDesign('plate')
}
function rememberDesign(doc: CadDesignDocument): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); return true } catch { return false }
}
interface Props {
  readonly spec: CadProgramSpec
  readonly project: CadProgramProject | null
  readonly onApply: (spec: CadProgramSpec) => void
  readonly onSaved: (project: CadProgramProject) => void
  readonly onBusyChange: (busy: boolean) => void
}

export default function CadParametricPanel({ spec, project, onApply, onSaved, onBusyChange }: Props) {
  const [source, setSource] = useState<CadDesignDocument>(recoverDesign)
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(source.parameters).map(([key, value]) => [key, String(value)])))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const definition = CAD_DESIGNS[source.kind]
  let candidate: ReturnType<typeof compileCadDesign> | null = null
  let issues: readonly string[] = []
  try {
    candidate = compileCadDesign({ ...source, parameters: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() ? Number(value) : NaN])) })
  } catch (error) { issues = error instanceof CadDesignError ? error.issues : [String(error)] }
  // Server-added defaults do not change whether an ordinary saved program is current.
  const applied = !!candidate && cadIdentity(spec) === cadIdentity(candidate.spec)
  const saved = !!project && cadIdentity(project.spec) === cadIdentity(spec)
  const load = (doc: CadDesignDocument) => {
    setSource(doc); setValues(Object.fromEntries(Object.entries(doc.parameters).map(([key, value]) => [key, String(value)]))); setMessage(null)
  }
  const apply = () => {
    if (!candidate) return
    onApply(candidate.spec)
    setMessage(rememberDesign(candidate.document) ? 'Medidas aplicadas. Confira a prévia e salve para validar no motor CAD.' : 'Medidas aplicadas. Não foi possível guardar no navegador; baixe o projeto paramétrico.')
  }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); onBusyChange(true); setMessage(null)
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); onBusyChange(false) }
  }
  const save = () => run(async () => {
    if (!candidate || !applied) return
    const inspection = await inspectCadProgram(spec)
    // Compare measured results with the independent analytic specification before saving.
    const close = (actual: number, expected: number) => Math.abs(actual - expected) <= Math.max(0.001, expected * 1e-6)
    if (inspection.solidCount !== 1 || !close(inspection.volumeMm3, candidate.expectedVolumeMm3) ||
      !candidate.expectedBoundsMm.every((expected, axis) => close(inspection.boundsMm[axis], expected))) {
      throw new Error('O resultado do motor divergiu das medidas paramétricas. A geometria não foi salva; confira as medidas antes de tentar novamente.')
    }
    const result = await saveCadProgram(spec, project?.spec.partId === spec.partId ? project : null)
    onSaved(result)
    setMessage(`Revisão ${result.revision} validada: um sólido, medidas e volume conferidos. STEP e STL disponíveis.`)
  })
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 32_768) throw new Error('O arquivo paramétrico deve ter até 32 KB.')
      const compiled = compileCadDesign(JSON.parse(await file.text()))
      load(compiled.document)
      setMessage('Projeto importado. Aplique as medidas para construir a geometria.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }
  return <div className="cad-program cad-parametric">
    <span className="workspace-eyebrow">BANCADA PARAMÉTRICA · SEM IA</span>
    <h2>Medidas que constroem</h2>
    <p>Escolha uma peça, ajuste as medidas e obtenha geometria editável. Furos e paredes acompanham as dimensões.</p>
    <fieldset disabled={busy}>
      <label className="cad-program__field">Família de peça
        <select value={source.kind} onChange={(event) => load(newCadDesign(event.target.value as CadDesignKind))}>
          {Object.entries(CAD_DESIGNS).map(([kind, design]) => <option key={kind} value={kind}>{design.label}</option>)}
        </select>
      </label>
      <p className="cad-parametric__description">{definition.description}</p>
      <label className="cad-program__field">Nome do projeto
        <input value={source.partId} maxLength={64} onChange={(event) => { setSource({ ...source, partId: event.target.value }); setMessage(null) }} />
      </label>
      <div className="cad-program__grid">
        {definition.fields.map((field) => <label className="cad-program__field" key={field.key}>{field.label}
          <input type="number" min={field.min} max={field.max} step={field.integer ? 1 : 'any'} value={values[field.key] ?? ''}
            onChange={(event) => { setValues({ ...values, [field.key]: event.target.value }); setMessage(null) }} />
        </label>)}
      </div>
      {issues.length > 0 && <div role="alert" className="cad-parametric__issues"><strong>Revise as medidas</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
      {candidate && <div className="cad-parametric__measurements" aria-label="Medidas previstas">
        <span>Envelope <strong>{candidate.expectedBoundsMm.map((n) => n.toLocaleString('pt-BR')).join(' × ')} mm</strong></span>
        <span>Volume previsto <strong>{candidate.expectedVolumeMm3.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm³</strong></span>
      </div>}
      <div className="cad-program__actions">
        <button type="button" disabled={!candidate || applied} onClick={apply}>Aplicar medidas</button>
        <button type="button" disabled={!candidate || !applied || saved} onClick={() => void save()}>Validar e salvar</button>
      </div>
      {!applied && <p>Aplique as medidas para atualizar a prévia. A geometria anterior permanece disponível.</p>}
    </fieldset>
    {message && <p role="status">{message}</p>}
    {applied && saved && project && <p>Revisão {project.revision} salva · volume medido {project.inspection.volumeMm3.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mm³</p>}
    <div className="cad-program__actions">
      <button type="button" disabled={busy || !applied || !saved} onClick={() => project && void run(() => downloadCadProgramStep(project))}>Baixar STEP</button>
      <button type="button" disabled={busy || !applied || !saved} onClick={() => project && void run(() => downloadCadRevisionStl(project, project.revision))}>Baixar STL</button>
    </div>
    <details><summary>Guardar e reabrir medidas</summary>
      <p>O JSON paramétrico conserva as relações entre medidas. STEP e STL contêm a geometria resultante.</p>
      <div className="cad-program__actions">
        <button type="button" disabled={busy || !candidate} onClick={() => candidate && downloadBlob(new Blob([JSON.stringify(candidate.document, null, 2)], { type: 'application/json' }), `${candidate.document.partId}.parametric.json`)}>Baixar projeto paramétrico</button>
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Importar projeto paramétrico</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = '' }} />
      </div>
    </details>
    <p className="cad-parametric__limit">As folgas de 1 mm verificam continuidade geométrica. Material, cargas, tolerâncias e processo de fabricação precisam de dimensionamento próprio.</p>
  </div>
}
