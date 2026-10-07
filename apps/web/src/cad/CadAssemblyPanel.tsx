import { useState } from 'react'
import { validateCadAssembly, type CadAssemblySpec } from '../../../../packages/domain/ts/src/cad-assembly.ts'
import { CadAssemblyPausedError, CadAssemblyValidationError, type CadAssemblyOutcome, type CadAssemblyProgress } from '../../../../packages/agent/src/generate-cad-assembly.ts'
import { downloadCadAssemblyDraft, downloadCadAssemblyStep, downloadCadComponent, downloadCadRevisionStl, saveCadAssembly, inspectCadMechanics, type CadMechanicsReport, type CadAssemblyProject } from '../api/cad.ts'
import CadAssemblyProgressView, { type CadProgressStatus } from './CadAssemblyProgressView.tsx'

interface Props {
  readonly spec: CadAssemblySpec | null
  readonly project: CadAssemblyProject | null
  readonly onChange: (spec: CadAssemblySpec) => void
  readonly onSaved: (project: CadAssemblyProject) => void
  readonly onNew: () => void
  readonly onBusyChange: (busy: boolean) => void
  readonly plan: (request: string, previous?: CadAssemblySpec) => Promise<CadAssemblyOutcome>
  readonly repair: (spec: CadAssemblySpec) => Promise<CadAssemblyOutcome>
  readonly correctMechanics: (spec: CadAssemblySpec) => Promise<CadAssemblyOutcome>
  readonly requireMechanics: boolean
  readonly agentReady: boolean
  readonly onOpenProviderSettings: () => void
  readonly initialAssumptions?: readonly string[]
  readonly cadProgress: CadAssemblyProgress | null
  readonly cadProgressStatus: CadProgressStatus | null
  readonly cadProgressUpdatedAt: number | null
  readonly onRequestChanged: () => void
  readonly cancelGeneration: () => void
}

export default function CadAssemblyPanel({ spec, project, onChange, onSaved, onNew, onBusyChange, plan, repair, correctMechanics, requireMechanics, agentReady, onOpenProviderSettings, initialAssumptions, cadProgress, cadProgressStatus, cadProgressUpdatedAt, onRequestChanged, cancelGeneration }: Props) {
  const [request, setRequest] = useState('')
  const [busy, setLocalBusy] = useState(false)
  const setBusy = (value: boolean) => { setLocalBusy(value); onBusyChange(value) }
  const [message, setMessage] = useState<string | null>(null)
  const [failedSpec, setFailedSpec] = useState<CadAssemblySpec | null>(null)
  const [assumptions, setAssumptions] = useState<readonly string[] | null>(null)
  const [lastAction, setLastAction] = useState<'generate' | 'repair' | null>(null)
  const [checkedMechanics, setCheckedMechanics] = useState<{ spec: CadAssemblySpec; report: CadMechanicsReport } | null>(null)
  const mechanicsReport = checkedMechanics?.spec === spec ? checkedMechanics.report : null
  const displayedAssumptions = assumptions ?? initialAssumptions ?? []
  const dirty = !!spec && JSON.stringify(spec) !== JSON.stringify(project?.spec)

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(null)
    try { await action() }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (error instanceof CadAssemblyValidationError || error instanceof CadAssemblyPausedError) { setFailedSpec(error.spec); onChange(error.spec) }
      setMessage(/status 429/.test(detail) ? `${detail} Retome o mesmo pedido nesta aba para reutilizar o progresso. Recarregar a página descarta a geração em andamento.` : detail)
    }
    finally { setBusy(false) }
  }
  const accept = async (outcome: CadAssemblyOutcome) => {
    if (outcome.kind === 'clarify') { setMessage('Não foi possível concluir a decisão de projeto automaticamente. O progresso disponível foi conservado.'); return }
    const saved = await saveCadAssembly(outcome.spec, project?.spec.partId === outcome.spec.partId ? project : null)
    onSaved(saved)
    onChange(saved.spec)
    setAssumptions(outcome.assumptions)
    setMessage(saved.spec.mechanics ? 'Conjunto salvo com vínculos mecânicos verificados nas poses amostradas. Cargas e fabricação não avaliadas.' : 'Geometria do conjunto validada e salva. Vínculos mecânicos não verificados.')
    setRequest('')
  }
  const generate = () => run(async () => { setLastAction('generate'); setFailedSpec(null); await accept(await plan(request, spec ?? undefined)) })
  const correct = () => run(async () => { if (spec) { setLastAction('repair'); setFailedSpec(null); await accept(await repair(spec)) } })
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
  const importDraft = async (file: File) => {
    try {
      const draft: unknown = JSON.parse(await file.text())
      validateCadAssembly(draft as CadAssemblySpec)
      onNew()
      onChange(draft as CadAssemblySpec)
      onRequestChanged()
      setFailedSpec(null)
      setLastAction(null)
      setAssumptions([])
      setRequest('Corrija as interferências deste conjunto. Preserve os componentes e os recursos não afetados; reutilize a geometria existente.')
      setMessage('Rascunho importado sem chamar a IA. Use Corrigir interferências para reutilizar as peças existentes. Downloads de revisões aprovadas exigem validação e salvamento.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Rascunho CAD inválido.') }
  }
  return <div className="cad-program">
    <span className="workspace-eyebrow">AGENTE CAD · CONJUNTOS</span>
    <h2>Peças que trabalham juntas</h2>
    <p>Descreva um mecanismo ou produto. O agente planeja corpos separados, constrói cada peça e define seus movimentos.</p>
    <p>{requireMechanics ? 'Exige fixações, guias, mancais e transmissão coerentes. Recursos mecânicos ainda não suportados exigem esclarecimento.' : 'Modo de conceito geométrico: permite corpos separados e movimentos sem comprovar montagem funcional.'}</p>
    <textarea aria-label="Descrever conjunto CAD" rows={5} value={request} disabled={busy} onChange={(event) => { setRequest(event.target.value); onRequestChanged() }} placeholder="Descreva o mecanismo, produto ou máquina e as funções que suas peças devem cumprir." />
    <div className="cad-program__actions">
      <button type="button" disabled={busy || !agentReady || !request.trim()} onClick={() => void generate()}>{lastAction === 'generate' && cadProgressStatus === 'paused' && !!cadProgress?.components.length ? 'Retomar geração' : spec ? 'Modificar conjunto com IA' : 'Criar conjunto com IA'}</button>
      {spec && <button type="button" disabled={busy || !agentReady} onClick={() => void correct()}>{lastAction === 'repair' && cadProgressStatus === 'paused' ? 'Retomar correção' : 'Corrigir interferências'}</button>}
      {spec && <button type="button" disabled={busy} onClick={() => void run(async () => { setCheckedMechanics({ spec, report: await inspectCadMechanics(spec) }) })}>Verificar montagem</button>}
      {spec && <button type="button" disabled={busy || !agentReady} onClick={() => void run(async () => { setLastAction('generate'); setFailedSpec(null); await accept(await correctMechanics(spec)) })}>Corrigir montagem com IA</button>}
      {busy && cadProgressStatus === 'running' && <button type="button" onClick={cancelGeneration}>Cancelar geração</button>}
      {(!agentReady || cadProgressStatus === 'paused') && <button type="button" onClick={onOpenProviderSettings}>{agentReady ? 'Trocar modelo ou provedor' : 'Configurar IA'}</button>}
      <button type="button" disabled={busy} onClick={() => { onNew(); setRequest(''); setAssumptions([]); setMessage(null); setFailedSpec(null) }}>Novo conjunto</button>
    </div>
    <label className="cad-program__field">Importar rascunho CAD (JSON)
      <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void importDraft(file)
        event.target.value = ''
      }} />
    </label>
    <CadAssemblyProgressView progress={cadProgress} status={cadProgressStatus} updatedAt={cadProgressUpdatedAt} compact />
    {message && <p role="status">{message}</p>}
    {failedSpec && <button type="button" onClick={() => downloadCadAssemblyDraft(failedSpec)}>Baixar rascunho com erro (JSON)</button>}
    {displayedAssumptions.length > 0 && <details><summary>Premissas ({displayedAssumptions.length})</summary><ul>{displayedAssumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {spec && <>
      <p>{spec.partId} · {spec.components.length} componentes</p>
      <p>{!dirty && project?.inspection.mechanicalStatus === 'verified' ? 'Vínculos mecânicos verificados nas poses amostradas.' : spec.mechanics ? 'Vínculos mecânicos declarados; salve para verificar esta revisão.' : 'Vínculos mecânicos não verificados. Ausência de colisões não comprova funcionamento.'}</p>
      {mechanicsReport && <div role="status"><p>{mechanicsReport.message}</p>
        {mechanicsReport.separatedFixedComponents.length > 0 && <ul>{mechanicsReport.separatedFixedComponents.map((item) => <li key={item.component}>{item.component}: distância de {item.gapMm.toFixed(2)} mm até {item.nearestFixedComponent}. Verifique a fixação.</li>)}</ul>}
        {mechanicsReport.requirements.length > 0 && <ul>{mechanicsReport.requirements.map((item) => <li key={item}>{item}</li>)}</ul>}
      </div>}
      <div className="cad-program__actions">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()}>Salvar revisão</button>
        {project && !dirty && <>
          <button type="button" disabled={busy} onClick={() => void run(() => downloadCadAssemblyStep(project))}>Baixar STEP do conjunto</button>
          <button type="button" disabled={busy} onClick={() => void run(() => downloadCadRevisionStl(project, project.revision))}>Baixar STL do conjunto</button>
        </>}
      </div>
      {spec.components.map((component, index) => <details key={component.id} open={!!component.motion}>
        <summary>{component.id} · {component.motion ? `${component.motion.kind} ${component.motion.axis}` : 'fixo'} · {component.steps.length} etapas</summary>
        <div className="cad-program__grid">
          {(['x', 'y', 'z'] as const).map((axis) => <label className="cad-program__field" key={axis}>Posição {axis} (mm)
            <input type="number" step="any" disabled={busy} value={component.position[axis]} onChange={(event) => updatePosition(index, axis, Number(event.target.value))} />
          </label>)}
        </div>
        {component.motion && <label className="cad-program__field">{component.motion.factor !== undefined ? 'Comando vinculado' : `Curso ${component.motion.kind === 'rotary' ? '(°)' : '(mm)'}`}: {component.motion.value}
          <input type="range" disabled={busy} min={component.motion.minimum} max={component.motion.maximum} step="any" value={component.motion.value} onChange={(event) => updateTravel(index, Number(event.target.value))} />
        </label>}
        {component.motion?.group && <p>Movimento vinculado: {component.motion.group}</p>}
        {component.motion?.factor !== undefined && <p>Posição comandada: {(component.motion.value * component.motion.factor).toFixed(2)} {component.motion.kind === 'rotary' ? '°' : 'mm'}</p>}
        <p>Operações: {component.steps.map((step) => step.id).join(', ')}</p>
        {project && !dirty && <div className="cad-program__actions">
          <button type="button" disabled={busy} onClick={() => void run(() => downloadCadComponent(project, component.id, 'step'))}>STEP de {component.id}</button>
          <button type="button" disabled={busy} onClick={() => void run(() => downloadCadComponent(project, component.id, 'stl'))}>STL de {component.id}</button>
        </div>}
      </details>)}
      {dirty && <p>Salve a posição atual para baixar esta revisão.</p>}
      {project && <p>Projeto {project.projectId} · revisão {project.revision}</p>}
    </>}
  </div>
}
