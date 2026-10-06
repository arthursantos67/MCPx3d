import { useState } from 'react'
import type { CadProgramSpec, CadProgramStep } from '../../../../packages/domain/ts/src/cad-program.ts'
import type { CadAssemblySpec } from '../../../../packages/domain/ts/src/cad-assembly.ts'
import type { CadDesignOutcome } from '../../../../packages/agent/src/classify-cad-design.ts'
import { CadAssemblyPausedError, CadAssemblyValidationError, type CadAssemblyOutcome, type CadAssemblyProgress } from '../../../../packages/agent/src/generate-cad-assembly.ts'
import { downloadCadAssemblyDraft, downloadCadProgramStep, downloadCadRevisionStl, saveCadProgram, type CadProgramProject } from '../api/cad.ts'
import CadAssemblyProgressView, { type CadProgressStatus } from './CadAssemblyProgressView.tsx'
import { initialCadProgram } from './cadProgramDraft.ts'
import { CAD_FEATURES } from '../../../../packages/domain/ts/src/cad-features.ts'
import { createCadFeature } from './cadFeatureDraft.ts'
import CadFeatureFields from './CadFeatureFields.tsx'

interface Props {
  readonly spec: CadProgramSpec
  readonly project: CadProgramProject | null
  readonly onChange: (spec: CadProgramSpec) => void
  readonly onSaved: (project: CadProgramProject) => void
  readonly onNew: () => void
  readonly onBusyChange: (busy: boolean) => void
  readonly planDesign: (request: string, previous?: CadProgramSpec) => Promise<CadDesignOutcome>
  readonly onAssemblyGenerated: (outcome: Extract<CadAssemblyOutcome, { kind: 'create' }>) => Promise<void>
  readonly agentReady: boolean
  readonly onOpenProviderSettings: () => void
  readonly cadProgress: CadAssemblyProgress | null
  readonly cadProgressStatus: CadProgressStatus | null
  readonly cadProgressUpdatedAt: number | null
  readonly onRequestChanged: () => void
  readonly cancelGeneration: () => void
}

export default function CadProgramPanel({ spec, project, onChange, onSaved, onNew, onBusyChange, planDesign, onAssemblyGenerated, agentReady, onOpenProviderSettings, cadProgress, cadProgressStatus, cadProgressUpdatedAt, onRequestChanged, cancelGeneration }: Props) {
  const [request, setRequest] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [failedAssemblySpec, setFailedAssemblySpec] = useState<CadAssemblySpec | null>(null)
  const [busy, setLocalBusy] = useState(false)
  const setBusy = (value: boolean) => { setLocalBusy(value); onBusyChange(value) }
  const [assumptions, setAssumptions] = useState<readonly string[]>([])
  const [newShape, setNewShape] = useState<CadProgramStep['shape']>('cylinder')
  const dirty = !!project && JSON.stringify(spec) !== JSON.stringify(project.spec)

  const updateStep = (index: number, patch: Partial<CadProgramStep>) => onChange({ ...spec, steps: spec.steps.map((step, i) => i === index ? { ...step, ...patch } as CadProgramStep : step) })
  const addStep = (shape: CadProgramStep['shape'], op: 'union' | 'cut') => {
    let suffix = spec.steps.length + 1
    while (spec.steps.some((step) => step.id === `${shape}_${suffix}`)) suffix++
    const next = createCadFeature(shape, `${shape}_${suffix}`, op)
    onChange({ ...spec, steps: [...spec.steps, next] })
  }
  const generate = async () => {
    if (!request.trim()) return
    setBusy(true); setMessage(null); setFailedAssemblySpec(null)
    try {
      const result = await planDesign(request, project || JSON.stringify(spec) !== JSON.stringify(initialCadProgram) ? spec : undefined)
      if (result.outcome.kind === 'clarify') { setMessage('Não foi possível concluir a decisão de projeto automaticamente. O progresso disponível foi conservado.') }
      else if (result.mode === 'assembly') { await onAssemblyGenerated(result.outcome); setRequest('') }
      else {
        const saved = await saveCadProgram(result.outcome.spec, project?.spec.partId === result.outcome.spec.partId ? project : null)
        onSaved(saved); onChange(saved.spec); setAssumptions(result.outcome.assumptions)
        setMessage('Geometria validada e salva. STEP e STL disponíveis para baixar.')
        setRequest('')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (error instanceof CadAssemblyValidationError || error instanceof CadAssemblyPausedError) setFailedAssemblySpec(error.spec)
      setMessage(/status 429/.test(detail) ? `${detail} Retome o mesmo pedido nesta aba para reutilizar o progresso. Recarregar a página descarta a geração em andamento.` : detail)
    }
    finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setMessage(null)
    try {
      const saved = await saveCadProgram(spec, project?.spec.partId === spec.partId ? project : null)
      onSaved(saved); onChange(saved.spec); setMessage(`Revisão ${saved.revision} salva. STEP e STL disponíveis.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return <div className="cad-program">
    <span className="workspace-eyebrow">AGENTE CAD</span>
    <h2>Da ideia ao modelo</h2>
    <button type="button" disabled={busy} onClick={() => { onNew(); setMessage(null); setAssumptions([]); setRequest(''); setFailedAssemblySpec(null) }}>Nova peça</button>
    <p>Descreva uma peça ou um produto completo. O agente escolhe a construção e organiza os componentes.</p>
    <textarea aria-label="Describe CAD part" rows={5} value={request} disabled={busy} onChange={(event) => { setRequest(event.target.value); onRequestChanged() }} placeholder="Ex.: suporte com base retangular, tubo inclinado e quatro furos de fixação..." />
    <div className="cad-program__actions">
      <button type="button" disabled={busy || !agentReady || !request.trim()} onClick={() => void generate()}>{cadProgressStatus === 'paused' && !!cadProgress?.components.length ? 'Retomar geração' : project ? 'Modificar com IA' : 'Criar com IA'}</button>
      {busy && cadProgressStatus === 'running' && <button type="button" onClick={cancelGeneration}>Cancelar geração</button>}
      {(!agentReady || cadProgressStatus === 'paused') && <button type="button" onClick={onOpenProviderSettings}>{agentReady ? 'Trocar modelo ou provedor' : 'Configurar IA'}</button>}
    </div>
    <CadAssemblyProgressView progress={cadProgress} status={cadProgressStatus} updatedAt={cadProgressUpdatedAt} compact />
    {message && <p role="status">{message}</p>}
    {failedAssemblySpec && <button type="button" onClick={() => downloadCadAssemblyDraft(failedAssemblySpec)}>Baixar rascunho com erro (JSON)</button>}
    {assumptions.length > 0 && <div><strong>Premissas</strong><ul>{assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    <details className="cad-program__construction"><summary>Editar construção · {spec.steps.length} operações</summary>
    <fieldset disabled={busy}>
    <label className="cad-program__field">Identificador
      <input value={spec.partId} onChange={(event) => onChange({ ...spec, partId: event.target.value })} disabled={!!project} />
    </label>
    <h3>Etapas ({spec.steps.length}/32)</h3>
    {spec.steps.map((step, index) => <details key={`${step.id}-${index}`} open={index === spec.steps.length - 1}>
      <summary>{index + 1}. {step.op} · {step.shape} · {step.id}</summary>
      <label className="cad-program__field">Nome <input value={step.id} onChange={(event) => updateStep(index, { id: event.target.value })} /></label>
      {index > 0 && CAD_FEATURES[step.shape].mode === 'primitive' && <label className="cad-program__field">Operação <select value={step.op} onChange={(event) => {
        const op = event.target.value as 'union' | 'cut'
        updateStep(index, { op, ...(step.shape === 'thread' ? { clearance: op === 'cut' ? Math.min(0.1, step.pitch / 8) : 0 } : {}) })
      }}><option value="union">Adicionar</option><option value="cut">Cortar</option></select></label>}
      <div className="cad-program__grid">
        <CadFeatureFields step={step} onChange={(patch) => updateStep(index, patch)} />
        {CAD_FEATURES[step.shape].mode !== 'modifier' && <>
          {(['x', 'y', 'z'] as const).map((axis) => <label key={`p${axis}`} className="cad-program__field">Posição {axis} (mm)<input type="number" step="any" value={step.position[axis]} onChange={(event) => updateStep(index, { position: { ...step.position, [axis]: Number(event.target.value) } })} /></label>)}
          {(['x', 'y', 'z'] as const).map((axis) => <label key={`r${axis}`} className="cad-program__field">Rotação {axis} (°)<input type="number" step="any" value={step.rotation[axis]} onChange={(event) => updateStep(index, { rotation: { ...step.rotation, [axis]: Number(event.target.value) } })} /></label>)}
        </>}
      </div>
      {step.shape === 'hole' && <p>A posição marca a entrada do furo. A profundidade segue o sentido negativo do eixo Z local.</p>}
      {step.shape === 'thread' && <p>Rosca geométrica: diâmetro nominal, passo entre filetes e folga radial da rosca interna. Avanço por volta: {step.pitch * (step.starts ?? 1)} mm.</p>}
      {(step.shape === 'polygon_prism' || step.shape === 'revolve_profile') && <div><strong>{step.shape === 'revolve_profile' ? 'Perfil: x = raio, y = eixo Z (mm)' : 'Vértices do perfil (mm)'}</strong>
        {step.points.map((point, pointIndex) => <div className="cad-program__actions" key={pointIndex}>
          {(['x', 'y'] as const).map((axis) => <label className="cad-program__field" key={axis}>{axis}<input type="number" step="any" value={point[axis]} onChange={(event) => updateStep(index, { points: step.points.map((old, i) => i === pointIndex ? { ...old, [axis]: Number(event.target.value) } : old) } as Partial<CadProgramStep>)} /></label>)}
          <button type="button" disabled={step.points.length <= 3} onClick={() => updateStep(index, { points: step.points.filter((_, i) => i !== pointIndex) } as Partial<CadProgramStep>)}>Remover vértice</button>
        </div>)}
        <button type="button" disabled={step.points.length >= 32} onClick={() => updateStep(index, { points: [...step.points, { x: 0, y: 0 }] } as Partial<CadProgramStep>)}>Adicionar vértice</button>
      </div>}
      {index > 0 && CAD_FEATURES[step.shape].mode !== 'modifier' && <div className="cad-program__grid">
        <label className="cad-program__field">Repetição
          <select value={step.pattern?.kind ?? 'none'} onChange={(event) => updateStep(index, { pattern: event.target.value === 'circular'
            ? { kind: 'circular', count: 4, axis: 'z', center: { x: 0, y: 0, z: 0 }, sweepAngle: 360 }
            : event.target.value === 'linear' ? { kind: 'linear', count: 4, offset: { x: 20, y: 0, z: 0 } } : undefined } as Partial<CadProgramStep>)}>
            <option value="none">Nenhuma</option><option value="circular">Circular</option><option value="linear">Linear</option>
          </select>
        </label>
        {step.pattern && <label className="cad-program__field">Quantidade
          <input type="number" min={2} max={64} step={1} value={step.pattern.count} onChange={(event) => updateStep(index, { pattern: { ...step.pattern!, count: Number(event.target.value) } } as Partial<CadProgramStep>)} />
        </label>}
        {step.pattern?.kind === 'circular' && <>
          <label className="cad-program__field">Eixo
            <select value={step.pattern.axis ?? 'z'} onChange={(event) => updateStep(index, { pattern: { ...step.pattern!, axis: event.target.value as 'x' | 'y' | 'z' } } as Partial<CadProgramStep>)}>
              <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
            </select>
          </label>
          <label className="cad-program__field">Ângulo total (°)
            <input type="number" min={0.1} max={360} step="any" value={step.pattern.sweepAngle ?? 360} onChange={(event) => updateStep(index, { pattern: { ...step.pattern!, sweepAngle: Number(event.target.value) } } as Partial<CadProgramStep>)} />
          </label>
          {(['x', 'y', 'z'] as const).map((axis) => <label className="cad-program__field" key={`center-${axis}`}>Centro {axis} (mm)
            <input type="number" step="any" value={step.pattern?.kind === 'circular' ? (step.pattern.center?.[axis] ?? 0) : 0} onChange={(event) => {
              const pattern = step.pattern
              if (pattern?.kind !== 'circular') return
              updateStep(index, { pattern: { ...pattern, center: { ...pattern.center ?? { x: 0, y: 0, z: 0 }, [axis]: Number(event.target.value) } } } as Partial<CadProgramStep>)
            }} />
          </label>)}
        </>}
        {step.pattern?.kind === 'linear' && (['x', 'y', 'z'] as const).map((axis) => <label className="cad-program__field" key={`offset-${axis}`}>Passo {axis} (mm)
          <input type="number" step="any" value={step.pattern?.kind === 'linear' ? step.pattern.offset[axis] : 0} onChange={(event) => {
            const pattern = step.pattern
            if (pattern?.kind !== 'linear') return
            updateStep(index, { pattern: { ...pattern, offset: { ...pattern.offset, [axis]: Number(event.target.value) } } } as Partial<CadProgramStep>)
          }} />
        </label>)}
      </div>}
      {index > 0 && <button type="button" onClick={() => onChange({ ...spec, steps: spec.steps.filter((_, i) => i !== index) })}>Remover etapa</button>}
    </details>)}
    <div className="cad-program__actions"><select aria-label="Nova forma" value={newShape} onChange={(event) => setNewShape(event.target.value as CadProgramStep['shape'])}>{Object.entries(CAD_FEATURES).map(([key, feature]) => <option key={key} value={key}>{feature.label}</option>)}</select>
      <button type="button" disabled={spec.steps.length >= 32 || CAD_FEATURES[newShape].mode === 'cut'} onClick={() => addStep(newShape, 'union')}>{CAD_FEATURES[newShape].mode === 'modifier' ? 'Aplicar acabamento' : 'Adicionar'}</button>
      <button type="button" disabled={spec.steps.length >= 32 || CAD_FEATURES[newShape].mode === 'modifier'} onClick={() => addStep(newShape, 'cut')}>Cortar</button>
    </div>
    </fieldset></details>
    <div className="cad-program__actions"><button type="button" disabled={busy || (!!project && !dirty)} onClick={() => void save()}>Salvar revisão</button>
      <button type="button" disabled={!project || busy || dirty} onClick={() => project && void downloadCadProgramStep(project).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))}>Baixar STEP</button>
      <button type="button" disabled={!project || busy || dirty} onClick={() => project && void downloadCadRevisionStl(project, project.revision).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))}>Baixar STL</button></div>
    {dirty && <p>Salve a geometria atual para baixar esta revisão.</p>}
    {project && <p>Projeto {project.projectId} · revisão {project.revision} · volume {project.inspection.volumeMm3.toFixed(1)} mm³</p>}
  </div>
}
