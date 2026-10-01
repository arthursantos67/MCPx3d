import { useState } from 'react'
import type { CadAssemblySpec } from '../../../../packages/domain/ts/src/cad-assembly.ts'
import { CadAssemblyValidationError, type CadAssemblyOutcome, type CadAssemblyProgress } from '../../../../packages/agent/src/generate-cad-assembly.ts'
import { downloadCadAssemblyDraft, downloadCadAssemblyStep, downloadCadComponentStl, downloadCadRevisionStl, saveCadAssembly, type CadAssemblyProject } from '../api/client.ts'
import CadAssemblyProgressView, { type CadProgressStatus } from './CadAssemblyProgressView.tsx'

interface Props {
  readonly spec: CadAssemblySpec | null
  readonly project: CadAssemblyProject | null
  readonly onChange: (spec: CadAssemblySpec) => void
  readonly onSaved: (project: CadAssemblyProject) => void
  readonly onNew: () => void
  readonly plan: (request: string, previous?: CadAssemblySpec) => Promise<CadAssemblyOutcome>
  readonly agentReady: boolean
  readonly onOpenProviderSettings: () => void
  readonly initialAssumptions?: readonly string[]
  readonly cadProgress: CadAssemblyProgress | null
  readonly cadProgressStatus: CadProgressStatus | null
  readonly cadProgressUpdatedAt: number | null
  readonly onRequestChanged: () => void
  readonly cancelGeneration: () => void
}

export default function CadAssemblyPanel({ spec, project, onChange, onSaved, onNew, plan, agentReady, onOpenProviderSettings, initialAssumptions, cadProgress, cadProgressStatus, cadProgressUpdatedAt, onRequestChanged, cancelGeneration }: Props) {
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failedSpec, setFailedSpec] = useState<CadAssemblySpec | null>(null)
  const [assumptions, setAssumptions] = useState<readonly string[]>(initialAssumptions ?? [])
  const dirty = !!spec && JSON.stringify(spec) !== JSON.stringify(project?.spec)

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(null)
    try { await action() }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (error instanceof CadAssemblyValidationError) setFailedSpec(error.spec)
      setMessage(/status 429/.test(detail) ? `${detail} Aguarde a cota liberar e repita o mesmo pedido nesta aba. Os componentes já concluídos serão reutilizados.` : detail)
    }
    finally { setBusy(false) }
  }
  const generate = () => run(async () => {
    setFailedSpec(null)
    const outcome = await plan(request, spec ?? undefined)
    if (outcome.kind === 'clarify') { setMessage(outcome.question); return }
    onChange(outcome.spec)
    setAssumptions(outcome.assumptions)
    setMessage('Conjunto validado. Confira os componentes e salve a revisão.')
  })
  const save = () => run(async () => {
    if (!spec) return
    const saved = await saveCadAssembly(spec, project?.spec.partId === spec.partId ? project : null)
    onSaved(saved)
    onChange(saved.spec)
    setMessage(`Revisão ${saved.revision} salva com ${saved.inspection.solidCount} corpos.`)
  })
  const updateTravel = (index: number, value: number) => {
    if (!spec) return
    const active = spec.components[index].motion
    if (!active) return
    onChange({ ...spec, components: spec.components.map((component, componentIndex) => {
      const movement = component.motion
      if (!movement || !(componentIndex === index || (active.group && movement.group === active.group))) return component
      return { ...component, motion: { ...movement, value } }
    }) })
  }
  const updatePosition = (index: number, axis: 'x' | 'y' | 'z', value: number) => {
    if (!spec) return
    onChange({ ...spec, components: spec.components.map((component, i) => i === index
      ? { ...component, position: { ...component.position, [axis]: value } } : component) })
  }
  return <div className="cad-program">
    <h2>Conjunto CAD</h2>
    <p>Descreva um mecanismo ou produto. O agente planeja corpos separados, constrói cada peça e define seus movimentos.</p>
    <textarea aria-label="Descrever conjunto CAD" rows={5} value={request} disabled={busy} onChange={(event) => { setRequest(event.target.value); onRequestChanged() }} placeholder="Descreva o mecanismo, produto ou máquina e as funções que suas peças devem cumprir." />
    <div className="cad-program__actions">
      <button type="button" disabled={busy || !agentReady || !request.trim()} onClick={() => void generate()}>{cadProgressStatus === 'paused' && !!cadProgress?.components.length ? 'Retomar geração' : spec ? 'Modificar conjunto com IA' : 'Criar conjunto com IA'}</button>
      {busy && <button type="button" onClick={cancelGeneration}>Cancelar geração</button>}
      {!agentReady && <button type="button" onClick={onOpenProviderSettings}>Configurar IA</button>}
      <button type="button" disabled={busy} onClick={() => { onNew(); setRequest(''); setAssumptions([]); setMessage(null); setFailedSpec(null) }}>Novo conjunto</button>
    </div>
    <CadAssemblyProgressView progress={cadProgress} status={cadProgressStatus} updatedAt={cadProgressUpdatedAt} compact />
    {message && <p role="status">{message}</p>}
    {failedSpec && <button type="button" onClick={() => downloadCadAssemblyDraft(failedSpec)}>Baixar rascunho com erro (JSON)</button>}
    {assumptions.length > 0 && <details><summary>Premissas ({assumptions.length})</summary><ul>{assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {spec && <>
      <p>{spec.partId} · {spec.components.length} componentes</p>
      {spec.components.map((component, index) => <details key={component.id} open={!!component.motion}>
        <summary>{component.id} · {component.motion ? `${component.motion.kind} ${component.motion.axis}` : 'fixo'} · {component.steps.length} etapas</summary>
        <div className="cad-program__grid">
          {(['x', 'y', 'z'] as const).map((axis) => <label className="cad-program__field" key={axis}>Posição {axis} (mm)
            <input type="number" step="any" value={component.position[axis]} onChange={(event) => updatePosition(index, axis, Number(event.target.value))} />
          </label>)}
        </div>
        {component.motion && <label className="cad-program__field">Curso {component.motion.kind === 'rotary' ? '(°)' : '(mm)'}: {component.motion.value}
          <input type="range" min={component.motion.minimum} max={component.motion.maximum} step="any" value={component.motion.value} onChange={(event) => updateTravel(index, Number(event.target.value))} />
        </label>}
        {component.motion?.group && <p>Movimento vinculado: {component.motion.group}</p>}
        <p>Operações: {component.steps.map((step) => step.id).join(', ')}</p>
        {project && !dirty && <button type="button" disabled={busy} onClick={() => void run(() => downloadCadComponentStl(project, component.id))}>Baixar STL de {component.id}</button>}
      </details>)}
      <div className="cad-program__actions">
        <button type="button" disabled={busy} onClick={() => void save()}>Salvar revisão</button>
        {project && !dirty && <>
          <button type="button" disabled={busy} onClick={() => void run(() => downloadCadAssemblyStep(project))}>Baixar STEP do conjunto</button>
          <button type="button" disabled={busy} onClick={() => void run(() => downloadCadRevisionStl(project, project.revision))}>Baixar STL do conjunto</button>
        </>}
      </div>
      {dirty && <p>Salve a posição atual para baixar esta revisão.</p>}
      {project && <p>Projeto {project.projectId} · revisão {project.revision}</p>}
    </>}
  </div>
}
