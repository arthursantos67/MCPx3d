import { useState } from 'react'
import type { CadProgramSpec, CadProgramStep } from '../../../../packages/domain/ts/src/cad-program.ts'
import type { CadProgramOutcome } from '../../../../packages/agent/src/generate-cad-program.ts'
import { downloadCadProgramStep, saveCadProgram, type CadProgramProject } from '../api/client.ts'

interface Props {
  readonly spec: CadProgramSpec
  readonly project: CadProgramProject | null
  readonly onChange: (spec: CadProgramSpec) => void
  readonly onSaved: (project: CadProgramProject) => void
  readonly onNew: () => void
  readonly plan: (request: string, previous?: CadProgramSpec) => Promise<CadProgramOutcome>
  readonly agentReady: boolean
  readonly onOpenProviderSettings: () => void
}

export default function CadProgramPanel({ spec, project, onChange, onSaved, onNew, plan, agentReady, onOpenProviderSettings }: Props) {
  const [request, setRequest] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [assumptions, setAssumptions] = useState<readonly string[]>([])
  const [newShape, setNewShape] = useState<CadProgramStep['shape']>('cylinder')

  const updateStep = (index: number, patch: Partial<CadProgramStep>) => onChange({ ...spec, steps: spec.steps.map((step, i) => i === index ? { ...step, ...patch } as CadProgramStep : step) })
  const setNumber = (index: number, field: string, value: number) => updateStep(index, { [field]: value } as Partial<CadProgramStep>)
  const addStep = (shape: CadProgramStep['shape'], op: 'union' | 'cut') => {
    let suffix = spec.steps.length + 1
    while (spec.steps.some((step) => step.id === `${shape}_${suffix}`)) suffix++
    const common = { id: `${shape}_${suffix}`, op, position: { x: 0, y: 0, z: op === 'union' ? 5 : 0 }, rotation: { x: 0, y: 0, z: 0 } }
    const next: CadProgramStep = shape === 'box' ? { ...common, shape, width: 20, depth: 20, height: 10 } :
      shape === 'cylinder' ? { ...common, shape, diameter: 12, height: 20 } :
      shape === 'sphere' ? { ...common, shape, diameter: 20 } :
      shape === 'cone' ? { ...common, shape, bottomDiameter: 20, topDiameter: 10, height: 20 } :
      shape === 'revolve_profile' ? { ...common, shape, points: [{ x: 0, y: -10 }, { x: 20, y: -10 }, { x: 20, y: 10 }, { x: 0, y: 10 }] } :
      { ...common, shape, points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }], height: 10 }
    onChange({ ...spec, steps: [...spec.steps, next] })
  }
  const generate = async () => {
    if (!request.trim()) return
    setBusy(true); setMessage(null)
    try {
      const result = await plan(request, project ? spec : spec.steps.length > 1 ? spec : undefined)
      if (result.kind === 'clarify') setMessage(result.question)
      else {
        onChange(result.spec); setAssumptions(result.assumptions)
        setMessage(result.geometryIssue
          ? `Programa gerado, mas a geometria ainda falha: ${result.geometryIssue}. Ajuste a etapa indicada abaixo e salve.`
          : 'Programa gerado. Revise a geometria e salve a revisão.')
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setMessage(null)
    try {
      const saved = await saveCadProgram(spec, project?.spec.partId === spec.partId ? project : null)
      onSaved(saved); setMessage(`Revisão ${saved.revision} salva. STEP disponível.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const fields = (index: number, step: CadProgramStep, names: readonly string[]) => names.map((name) => <label key={name} className="cad-program__field">{name} (mm)
    <input type="number" step="any" value={(step as unknown as Record<string, number>)[name]} onChange={(event) => setNumber(index, name, Number(event.target.value))} />
  </label>)

  return <div className="cad-program">
    <h2>Construção CAD</h2>
    <button type="button" onClick={() => { onNew(); setMessage(null); setAssumptions([]); setRequest('') }}>Nova peça</button>
    <p>Descreva a peça. O agente combina sólidos e cortes; cada etapa pode ser ajustada abaixo.</p>
    <textarea aria-label="Describe CAD part" rows={5} value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Ex.: suporte com base retangular, tubo inclinado e quatro furos de fixação..." />
    <div className="cad-program__actions">
      <button type="button" disabled={busy || !agentReady || !request.trim()} onClick={() => void generate()}>{project ? 'Modificar com IA' : 'Criar com IA'}</button>
      {!agentReady && <button type="button" onClick={onOpenProviderSettings}>Configurar IA</button>}
    </div>
    {message && <p role="status">{message}</p>}
    {assumptions.length > 0 && <div><strong>Premissas</strong><ul>{assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    <label className="cad-program__field">Identificador
      <input value={spec.partId} onChange={(event) => onChange({ ...spec, partId: event.target.value })} disabled={!!project} />
    </label>
    <h3>Etapas ({spec.steps.length}/32)</h3>
    {spec.steps.map((step, index) => <details key={`${step.id}-${index}`} open={index === spec.steps.length - 1}>
      <summary>{index + 1}. {step.op} · {step.shape} · {step.id}</summary>
      <label className="cad-program__field">Nome <input value={step.id} onChange={(event) => updateStep(index, { id: event.target.value })} /></label>
      {index > 0 && <label className="cad-program__field">Operação <select value={step.op} onChange={(event) => updateStep(index, { op: event.target.value as 'union' | 'cut' })}><option value="union">Adicionar</option><option value="cut">Cortar</option></select></label>}
      <div className="cad-program__grid">
        {fields(index, step, step.shape === 'box' ? ['width', 'depth', 'height'] : step.shape === 'cylinder' ? ['diameter', 'height'] : step.shape === 'sphere' ? ['diameter'] : step.shape === 'cone' ? ['bottomDiameter', 'topDiameter', 'height'] : step.shape === 'polygon_prism' ? ['height'] : [])}
        {(['x', 'y', 'z'] as const).map((axis) => <label key={`p${axis}`} className="cad-program__field">Posição {axis} (mm)<input type="number" step="any" value={step.position[axis]} onChange={(event) => updateStep(index, { position: { ...step.position, [axis]: Number(event.target.value) } })} /></label>)}
        {(['x', 'y', 'z'] as const).map((axis) => <label key={`r${axis}`} className="cad-program__field">Rotação {axis} (°)<input type="number" step="any" value={step.rotation[axis]} onChange={(event) => updateStep(index, { rotation: { ...step.rotation, [axis]: Number(event.target.value) } })} /></label>)}
      </div>
      {(step.shape === 'polygon_prism' || step.shape === 'revolve_profile') && <div><strong>{step.shape === 'revolve_profile' ? 'Perfil: x = raio, y = eixo Z (mm)' : 'Vértices do perfil (mm)'}</strong>
        {step.points.map((point, pointIndex) => <div className="cad-program__actions" key={pointIndex}>
          {(['x', 'y'] as const).map((axis) => <label className="cad-program__field" key={axis}>{axis}<input type="number" step="any" value={point[axis]} onChange={(event) => updateStep(index, { points: step.points.map((old, i) => i === pointIndex ? { ...old, [axis]: Number(event.target.value) } : old) } as Partial<CadProgramStep>)} /></label>)}
          <button type="button" disabled={step.points.length <= 3} onClick={() => updateStep(index, { points: step.points.filter((_, i) => i !== pointIndex) } as Partial<CadProgramStep>)}>Remover vértice</button>
        </div>)}
        <button type="button" disabled={step.points.length >= 32} onClick={() => updateStep(index, { points: [...step.points, { x: 0, y: 0 }] } as Partial<CadProgramStep>)}>Adicionar vértice</button>
      </div>}
      {index > 0 && <div className="cad-program__grid">
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
    <div className="cad-program__actions"><select aria-label="Nova forma" value={newShape} onChange={(event) => setNewShape(event.target.value as CadProgramStep['shape'])}><option value="box">Bloco</option><option value="cylinder">Cilindro</option><option value="sphere">Esfera</option><option value="cone">Cone</option><option value="polygon_prism">Perfil extrudado</option><option value="revolve_profile">Perfil de revolução</option></select>
      <button type="button" disabled={spec.steps.length >= 32} onClick={() => addStep(newShape, 'union')}>Adicionar</button>
      <button type="button" disabled={spec.steps.length >= 32} onClick={() => addStep(newShape, 'cut')}>Cortar</button>
    </div>
    <div className="cad-program__actions"><button type="button" disabled={busy} onClick={() => void save()}>Salvar revisão</button>
      <button type="button" disabled={!project || busy} onClick={() => project && void downloadCadProgramStep(project).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))}>Baixar STEP</button></div>
    {project && <p>Projeto {project.projectId} · revisão {project.revision} · volume {project.inspection.volumeMm3.toFixed(1)} mm³</p>}
  </div>
}
