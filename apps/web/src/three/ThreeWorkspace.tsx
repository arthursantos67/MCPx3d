import { useEffect, useRef, useState, type ReactNode } from 'react'
import ThreeViewport from './ThreeViewport.tsx'
import ThreeStage from './ThreeStage.tsx'
import GeometryEditor from './GeometryEditor.tsx'
import { importGlb } from './importGlb.ts'
import { inspectSceneAsync } from './inspectSceneAsync.ts'
import type { SceneInspection } from './sceneInspection.ts'
import { insertionPosition } from './scenePlacement.ts'
import { generateThreeScene, editThreeScene, SceneGenerationTimeoutError, type SceneGenerationEvent } from './sceneGeneration.ts'
import ThreeGenerationProgress, { type SceneGenerationRun } from './ThreeGenerationProgress.tsx'
import type { AgentProvider } from '../ai/types.ts'
import { createPavilionScene, createOrbitalScene } from './scenePreset.ts'
import { normalizeProjectName } from '../workspace/projectName.ts'
import { commitScene, createEmptyScene, createNode, duplicateSubtree, MAX_SCENE_BYTES, MAX_SCENE_NODES, nodeLabels,
  parseScene, redoScene, SCENE_STORAGE_KEY, subtreeIds, undoScene,
  type NodeKind, type SceneHistory, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import './ThreeWorkspace.css'

function loadDraft(): { document: ThreeSceneDocument; error: string | null } {
  try {
    const stored = localStorage.getItem(SCENE_STORAGE_KEY)
    return { document: stored ? parseScene(stored) : createPavilionScene(), error: null }
  } catch (error) {
    return { document: createPavilionScene(), error: `Não foi possível recuperar o rascunho: ${error instanceof Error ? error.message : String(error)} O exemplo foi aberto; o rascunho anterior será preservado até sua próxima edição.` }
  }
}
function NumericField({ label, value, min, max, step = 0.1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [invalid, setInvalid] = useState(false)
  const apply = () => {
    const parsed = Number(draft)
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) { setInvalid(true); return }
    setInvalid(false)
    onChange(parsed)
  }
  return <label className="three-field">{label}<input type="number" aria-label={label} value={draft} min={min} max={max} step={step}
    aria-invalid={invalid} title={invalid ? `Use um valor entre ${min} e ${max}` : undefined}
    onChange={(event) => setDraft(event.target.value)} onBlur={apply}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    {invalid && <small role="alert">Use {min} a {max}.</small>}</label>
}
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  return <label className="three-field">{label}<input value={draft} maxLength={120}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft.trim()) onChange(draft); else setDraft(value) }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}
function VectorFields({ label, value, min, max, step, onChange }: {
  label: string; value: Vector3Tuple; min: number; max: number; step?: number; onChange: (value: Vector3Tuple) => void
}) {
  return <fieldset><legend>{label}</legend><div className="three-vector">{['X', 'Y', 'Z'].map((axis, index) =>
    <NumericField key={`${axis}-${value[index]}`} label={`${label} ${axis}`} value={value[index]} min={min} max={max} step={step}
      onChange={(next) => { const vector: Vector3Tuple = [...value]; vector[index] = next; onChange(vector) }} />)}</div></fieldset>
}

export default function ThreeWorkspace({ active, provider, ready, onBusyChange, onOpenProviderSettings }: {
  active: boolean; provider: AgentProvider; ready: boolean; onBusyChange: (busy: boolean) => void; onOpenProviderSettings: () => void
}) {
  const [initial] = useState(loadDraft)
  const [history, setHistory] = useState<SceneHistory>(() => ({ past: [], present: initial.document, future: [] }))
  const doc = history.present
  const lastCommitted = useRef(doc)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = doc.nodes.find((node) => node.id === selectedId) ?? null
  const [error, setError] = useState<string | null>(initial.error)
  const [saveStatus, setSaveStatus] = useState(initial.error ? 'Rascunho não recuperado' : 'Rascunho local')
  const [storageError, setStorageError] = useState<string | null>(null)
  const [storageEnabled, setStorageEnabled] = useState(!initial.error)
  const [fitRequest, setFitRequest] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const glbInput = useRef<HTMLInputElement>(null)
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetNotice, setAssetNotice] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const inspection = useRef<AbortController | null>(null)
  const [spatial, setSpatial] = useState<{ document: ThreeSceneDocument; report: SceneInspection } | null>(null)
  const [action, setAction] = useState<'create' | 'edit' | 'repair'>('create')
  const [filter, setFilter] = useState('')
  const [addKind, setAddKind] = useState<NodeKind>('box')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [seekTime, setSeekTime] = useState(0)
  const [seekRequest, setSeekRequest] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState('')
  const [timeoutSeconds, setTimeoutSeconds] = useState(300)
  const [generationRun, setGenerationRun] = useState<SceneGenerationRun | null>(null)
  const generation = useRef<AbortController | null>(null)
  useEffect(() => () => { generation.current?.abort(); inspection.current?.abort(); onBusyChange(false) }, [onBusyChange])
  const seek = (value: number) => { setSeekTime(value); setSeekRequest((request) => request + 1); setTime(value) }

  useEffect(() => {
    if (!storageEnabled) return
    // Storage is an external system; reflect its synchronous result in the status.
    // oxlint-disable-next-line react/set-state-in-effect
    try { localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(doc)); setSaveStatus('Salvo neste navegador'); setStorageError(null) }
    // oxlint-disable-next-line react/set-state-in-effect
    catch { setSaveStatus('Não salvo'); setStorageError('Não foi possível salvar no navegador. Exporte o JSON para guardar este projeto.') }
  }, [doc, storageEnabled])

  const commit = (document: ThreeSceneDocument): boolean => {
    try {
      const next = commitScene(history, document)
      setHistory(next)
      lastCommitted.current = next.present
      setStorageEnabled(true)
      setError(null)
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false }
  }
  const updateNode = (patch: Partial<SceneNode>) => {
    if (selected) return commit({ ...doc, nodes: doc.nodes.map((node) => node.id === selected.id ? { ...node, ...patch } : node) })
  }
  const updateEnvironment = (patch: Partial<ThreeSceneDocument['environment']>) => commit({ ...doc, environment: { ...doc.environment, ...patch } })
  const add = () => {
    const node = createNode(addKind, selected?.kind === 'group' ? selected.id : selected?.parentId ?? null)
    node.position = insertionPosition(doc, node)
    if (commit({ ...doc, nodes: [...doc.nodes, node] })) { setSelectedId(node.id); setFilter('') }
  }
  const duplicate = () => {
    if (!selected) return
    try { const result = duplicateSubtree(doc, selected.id); if (commit(result.document)) setSelectedId(result.selectedId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const remove = () => {
    if (!selected) return
    const ids = subtreeIds(doc.nodes, selected.id)
    if (commit({ ...doc, nodes: doc.nodes.filter((node) => !ids.has(node.id)).map((node) => ({ ...node, overlapWith: node.overlapWith.filter((id) => !ids.has(id)) })) })) setSelectedId(null)
  }
  const replace = (document: ThreeSceneDocument) => {
    if (commit(document)) { setSelectedId(null); setFilter(''); setPlaying(false); seek(0); setFitRequest((value) => value + 1) }
  }
  const importFile = async (file: File) => {
    try {
      if (file.size > MAX_SCENE_BYTES) throw new Error('O projeto excede o limite de 32 MB.')
      const document = parseScene(await file.text())
      replace(document)
    } catch (cause) { setError(`Importação recusada: ${cause instanceof Error ? cause.message : String(cause)}`) }
  }
  const exportFile = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${normalizeProjectName(doc.name)}.three.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const generate = async () => {
    if (generation.current || inspecting || assetBusy || !ready || (action !== 'repair' && !prompt.trim())) return
    const controller = new AbortController()
    generation.current = controller
    setGenerating(true)
    onBusyChange(true)
    setError(null)
    setPlaying(false)
    // Timestamp capture runs only after an explicit form submission.
    // oxlint-disable-next-line react/purity
    const started = performance.now()
    // oxlint-disable-next-line react/purity
    const startedAt = Date.now()
    let lastEvent: SceneGenerationEvent = { stage: 'prepare', attempt: 1, detail: 'Preparando o pedido…' }
    setGenerationRun({ startedAt, budgetSeconds: timeoutSeconds, events: [], outcome: 'running' })
    const deadline = setTimeout(() => controller.abort(new SceneGenerationTimeoutError(timeoutSeconds, lastEvent)), timeoutSeconds * 1000)
    try {
      let checked: SceneInspection | null = null
      const progress = (event: SceneGenerationEvent) => {
        lastEvent = event
        setGenerationStatus(event.detail)
        setGenerationRun((run) => run ? { ...run, events: [...run.events, { ...event, at: Date.now() }] } : run)
      }
      const document = action === 'create'
        ? await generateThreeScene(provider, prompt, controller.signal, setGenerationStatus, progress)
        : await editThreeScene(provider, doc, prompt, controller.signal, { mode: action, selectedId, onProgress: progress, onInspection: (report) => { checked = report; setSpatial({ document: doc, report }) } })
      if (controller.signal.aborted) return
      replace(document)
      if (checked) setSpatial({ document: lastCommitted.current, report: checked })
      setPlaying(document.nodes.some((node) => node.animation.kind !== 'none'))
      setGenerationRun((run) => run ? { ...run, outcome: 'success', finishedAt: Date.now(), events: [...run.events, { stage: 'application', attempt: lastEvent.attempt, at: Date.now(), detail: `Cena aplicada no editor: ${document.nodes.length} objetos.`, objects: document.nodes.length }] } : run)
      // oxlint-disable-next-line react/purity
      setGenerationStatus(`Cena aplicada em ${((performance.now() - started) / 1000).toFixed(1)} s · ${document.nodes.length} objetos`)
    } catch (cause) {
      const outcome = cause instanceof SceneGenerationTimeoutError ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'error'
      setGenerationRun((run) => run ? { ...run, outcome, finishedAt: Date.now(), events: [...run.events, { ...lastEvent, at: Date.now(), detail: cause instanceof Error ? cause.message : String(cause) }] } : run)
      setGenerationStatus('A cena anterior foi preservada.')
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      clearTimeout(deadline)
      generation.current = null
      setGenerating(false)
      onBusyChange(false)
    }
  }
  const verify = async () => {
    if (generating || assetBusy || inspection.current) return
    const controller = new AbortController()
    inspection.current = controller
    setInspecting(true)
    setPlaying(false)
    onBusyChange(true)
    setError(null)
    try { const report = await inspectSceneAsync(doc, controller.signal); if (!controller.signal.aborted) setSpatial({ document: doc, report }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { inspection.current = null; setInspecting(false); onBusyChange(false) }
  }
  const importAsset = async (file: File) => {
    if (generating || inspecting || assetBusy) return
    setAssetBusy(true)
    setAssetNotice('')
    onBusyChange(true)
    setError(null)
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('GLB: o limite por arquivo é 16 MB.')
      const result = await importGlb(await file.arrayBuffer(), file.name, doc)
      if (commit(result.document)) {
        setSelectedId(result.selectedId)
        setFitRequest((value) => value + 1)
        setAssetNotice(result.warnings.length ? result.warnings.join(' ') : 'Modelo GLB importado como malhas editáveis.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setAssetBusy(false); onBusyChange(false) }
  }
  const busy = generating || inspecting || assetBusy
  const descendants = selected ? subtreeIds(doc.nodes, selected.id) : new Set<string>()
  const visibleRows = (parentId: string | null, depth = 0): ReactNode => doc.nodes.filter((node) => node.parentId === parentId).map((node) => {
    const matches = !filter || node.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    return <div key={node.id}>{matches && <button type="button" className="three-tree__node" aria-pressed={selectedId === node.id}
      style={{ paddingLeft: 12 + depth * 14 }} onClick={() => setSelectedId(node.id)}>
      <span aria-hidden="true">{node.kind === 'group' ? '▤' : '◇'}</span><span>{node.name}</span>
      <small>{!node.visible ? 'Oculto' : nodeLabels[node.kind]}</small></button>}{visibleRows(node.id, depth + 1)}</div>
  })

  return <div className="three-workspace" hidden={!active}>
    <form className="three-prompt" onSubmit={(event) => { event.preventDefault(); void generate() }}>
      <div className="three-prompt__intro"><span className="workspace-eyebrow">DA DESCRIÇÃO À CENA</span><strong>Crie um mundo em movimento</strong>
        <span>Composição, detalhes e animação com sua IA.</span></div>
      <div className="three-prompt__composer"><textarea aria-label="Descreva a cena Three.js" maxLength={4000} rows={2} disabled={busy}
        placeholder="Uma estação orbital detalhada, com anéis girando, painéis solares e pequenos satélites em órbita…" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        <div className="three-prompt__buttons"><label className="three-generation-limit">Ação da IA
          <select aria-label="Ação da IA" value={action} disabled={busy} onChange={(event) => setAction(event.target.value as typeof action)}>
            <option value="create">Criar nova cena</option><option value="edit">Editar cena atual</option><option value="repair">Corrigir sobreposições</option></select></label><label className="three-generation-limit">Tempo máximo de geração
          <select aria-label="Tempo máximo de geração" value={timeoutSeconds} disabled={busy} onChange={(event) => setTimeoutSeconds(Number(event.target.value))}>
            <option value={120}>2 minutos</option><option value={300}>5 minutos</option><option value={600}>10 minutos</option></select></label>
          {generating ? <button type="button" onClick={(event) => { event.preventDefault(); generation.current?.abort(new DOMException('Geração cancelada. A cena anterior foi preservada.', 'AbortError')) }}>Cancelar geração</button>
          : ready ? <button type="submit" className="three-button--primary" disabled={inspecting || assetBusy || (action !== 'repair' && !prompt.trim())}>{action === 'create' ? 'Criar cena com IA' : action === 'edit' ? 'Editar cena com IA' : 'Corrigir sobreposições com IA'}</button>
            : <button type="button" onClick={onOpenProviderSettings}>Configurar IA para criar</button>}
          {provider.id.startsWith('local-') && <span>Na assinatura, cada chamada tem limite próprio de 5 minutos. Este prazo vale para a ação inteira.</span>}
          <span role="status">{generationStatus || 'Você também pode construir e animar manualmente.'}</span></div>
      </div>
    </form>
    {generationRun && <ThreeGenerationProgress run={generationRun} model={`${provider.id === 'local-codex' ? 'Codex' : provider.id === 'local-claude' ? 'Claude Code' : 'IA'} · ${provider.model?.trim() || 'modelo padrão'}`} />}
    {inspecting && <div className="three-spatial" role="status">Verificando superfícies e poses em segundo plano… <button type="button" onClick={() => inspection.current?.abort(new Error('Inspeção cancelada.'))}>Cancelar inspeção</button></div>}
    {spatial && <details className="three-spatial" open={spatial.report.intersections.length > 0}><summary>Diagnóstico espacial: {spatial.report.intersections.length} pares · {spatial.document === doc ? spatial.report.complete ? 'amostras concluídas' : 'cobertura incompleta' : 'desatualizado — verifique novamente'}</summary>
      <p>{spatial.report.sampledTimes.length} poses · {spatial.report.checkedPairs} pares refinados por triângulos · {spatial.report.skippedContacts} contatos declarados. Não é uma prova contínua de ausência de colisões.</p>
      {spatial.report.intersections.slice(0, 30).map((issue) => <div key={`${issue.a}-${issue.b}`} className="three-spatial__pair"><button type="button" onClick={() => { setSelectedId(issue.a); setFitRequest((value) => value + 1) }}>{issue.nameA}</button><span>↔</span><button type="button" onClick={() => { setSelectedId(issue.b); setFitRequest((value) => value + 1) }}>{issue.nameB}</button><small>{issue.kind === 'surface' ? 'Superfícies se cruzam' : 'Contenção'} · t={issue.times.map((time) => time.toFixed(1)).join(', ')} s</small></div>)}
      <button type="button" disabled={busy} onClick={() => setAction('repair')}>Preparar reparo da cena atual</button>
    </details>}
    <fieldset className="three-editor" disabled={busy}>
    <div className="three-toolbar">
      <div className="three-toolbar__title"><span className="workspace-eyebrow">ESTÚDIO DE CENAS</span><strong>{doc.name}</strong></div>
      <div className="three-toolbar__actions">
        <button type="button" onClick={() => replace(createEmptyScene())}>Cena vazia</button>
        <button type="button" onClick={() => replace(createPavilionScene())}>Abrir exemplo</button>
        <button type="button" onClick={() => replace(createOrbitalScene())}>Exemplo detalhado</button>
        <span className="three-toolbar__separator" />
        <button type="button" disabled={!history.past.length} onClick={() => { setHistory(undoScene(history)); setError(null) }}>Desfazer</button>
        <button type="button" disabled={!history.future.length} onClick={() => { setHistory(redoScene(history)); setError(null) }}>Refazer</button>
        <button type="button" onClick={() => fileInput.current?.click()}>Importar JSON</button>
        <button type="button" onClick={() => glbInput.current?.click()}>Importar GLB</button>
        <input ref={glbInput} type="file" accept=".glb,model/gltf-binary" aria-label="Importar modelo GLB" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importAsset(file) }} />
        <button type="button" onClick={() => void verify()}>Verificar sobreposições</button>
        <button type="button" className="three-button--primary" onClick={exportFile}>Exportar JSON</button>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Importar projeto Three.js" hidden
          onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file) }} />
      </div>
    </div>
    {(assetNotice || assetBusy) && <p className="three-asset-notice" role="status">{assetBusy ? 'Convertendo o GLB em malhas editáveis…' : assetNotice}</p>}
    {(error || storageError) && <div className="three-notice" role="alert">{error && <span>{error}</span>}{storageError && <span>{storageError}</span>}</div>}
    <div className="three-layout">
      <aside className="three-panel three-hierarchy" aria-label="Hierarquia da cena">
        <div className="three-panel__heading"><h2>Cena</h2><span>{doc.nodes.length} / {MAX_SCENE_NODES}</span></div>
        <p className="three-panel__intro">Organize formas e grupos para compor cada detalhe.</p>
        <div className="three-add"><select aria-label="Tipo de objeto" value={addKind} onChange={(event) => setAddKind(event.target.value as NodeKind)}>
          {Object.entries(nodeLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
          <button type="button" onClick={add} disabled={doc.nodes.length >= MAX_SCENE_NODES}>Adicionar</button></div>
        <input className="three-search" aria-label="Buscar objetos" placeholder="Buscar na cena…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <div className="three-tree">{visibleRows(null)}{!doc.nodes.length && <p className="three-empty">Sua cena começa aqui. Adicione uma forma ou um grupo.</p>}</div>
        <div className="three-panel__footnote">{selected?.kind === 'group' ? 'Novos objetos entram no grupo selecionado.' : 'Selecione um grupo para adicionar objetos dentro dele.'}</div>
      </aside>
      <ThreeStage playing={playing} time={time} duration={doc.timeline.duration} onPlay={() => setPlaying(!playing)} onSeek={(seconds) => { setPlaying(false); seek(seconds) }}><ThreeViewport document={doc} selectedId={selected?.id ?? null} active={active} fitRequest={fitRequest} playing={playing} seekTime={seekTime} seekRequest={seekRequest} onTimeChange={setTime} onSelect={setSelectedId} />
        <div className="three-stage__tools"><button type="button" onClick={() => setFitRequest((value) => value + 1)}>{selected ? 'Enquadrar seleção' : 'Enquadrar cena'}</button>
          {selected && <button type="button" onClick={() => setSelectedId(null)}>Limpar seleção</button>}</div>
      </ThreeStage>
      <aside className="three-panel three-inspector" aria-label="Inspector de cena">
        <div className="three-panel__heading"><h2>Inspector</h2><span>{selected ? nodeLabels[selected.kind] : 'Ambiente'}</span></div>
        <div className="three-inspector__body">
          {selected ? <div key={selected.id}>
            <TextField key={selected.name} label="Nome do objeto" value={selected.name} onChange={(name) => updateNode({ name })} />
            <label className="three-field">Grupo pai<select value={selected.parentId ?? ''} onChange={(event) => updateNode({ parentId: event.target.value || null })}>
              <option value="">Raiz da cena</option>{doc.nodes.filter((node) => node.kind === 'group' && !descendants.has(node.id)).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
            <p className="three-hint">Transformações locais ao grupo. Trocar o pai conserva os valores locais.</p>
            <label className="three-check"><input type="checkbox" checked={selected.visible} onChange={(event) => updateNode({ visible: event.target.checked })} /> Visível</label>
            <VectorFields label="Posição (m)" value={selected.position} min={-10000} max={10000} onChange={(position) => updateNode({ position })} />
            <VectorFields label="Rotação (°)" value={selected.rotation} min={-360} max={360} step={1} onChange={(rotation) => updateNode({ rotation })} />
            <VectorFields label="Escala" value={selected.scale} min={0.01} max={100} onChange={(scale) => updateNode({ scale })} />
            {selected.kind !== 'group' && <>
              <VectorFields label="Dimensões (m)" value={selected.dimensions} min={0.01} max={1000} onChange={(dimensions) => updateNode({ dimensions })} />
              <GeometryEditor key={`${selected.id}-${history.past.length}-${history.future.length}`} node={selected} onApply={(geometry) => updateNode({ geometry }) ?? false} />
              <h3>Material físico</h3>
              <label className="three-color">Cor<input type="color" value={selected.material.color} onChange={(event) => updateNode({ material: { ...selected.material, color: event.target.value } })} /></label>
              <div className="three-material"><NumericField key={`Metalicidade-${selected.material.metalness}`} label="Metalicidade" value={selected.material.metalness} min={0} max={1} step={0.05} onChange={(metalness) => updateNode({ material: { ...selected.material, metalness } })} />
                <NumericField key={`Rugosidade-${selected.material.roughness}`} label="Rugosidade" value={selected.material.roughness} min={0} max={1} step={0.05} onChange={(roughness) => updateNode({ material: { ...selected.material, roughness } })} /></div>
              <label className="three-field">Textura<select value={selected.material.texture ?? 'none'} onChange={(event) => updateNode({ material: { ...selected.material, texture: event.target.value as SceneNode['material']['texture'], textureImage: '' } })}>
                <option value="none">Sem textura procedural</option><option value="metal">Metal escovado</option><option value="concrete">Concreto</option><option value="wood">Madeira</option><option value="solar">Células solares</option><option value="tiles">Revestimento</option></select></label>
              <div className="three-material"><NumericField key={`coat-${selected.material.clearcoat}`} label="Verniz" value={selected.material.clearcoat ?? 0} min={0} max={1} step={0.05} onChange={(clearcoat) => updateNode({ material: { ...selected.material, clearcoat } })} />
                <NumericField key={`glass-${selected.material.transmission}`} label="Transmissão" value={selected.material.transmission ?? 0} min={0} max={1} step={0.05} onChange={(transmission) => updateNode({ material: { ...selected.material, transmission } })} /></div>
              <NumericField key={`opacity-${selected.material.opacity}`} label="Opacidade" value={selected.material.opacity ?? 1} min={0} max={1} step={0.05} onChange={(opacity) => updateNode({ material: { ...selected.material, opacity, transparent: opacity < 1 } })} />
              <label className="three-color">Cor de emissão<input type="color" value={selected.material.emissive ?? '#000000'} onChange={(event) => updateNode({ material: { ...selected.material, emissive: event.target.value } })} /></label>
              <div className="three-material"><NumericField key={`emissive-${selected.material.emissiveIntensity}`} label="Intensidade de emissão" value={selected.material.emissiveIntensity ?? 0} min={0} max={10} step={0.1} onChange={(emissiveIntensity) => updateNode({ material: { ...selected.material, emissiveIntensity } })} />
                <NumericField key={`texscale-${selected.material.textureScale}`} label="Repetição da textura" value={selected.material.textureScale ?? 1} min={0.1} max={32} step={0.5} onChange={(textureScale) => updateNode({ material: { ...selected.material, textureScale } })} /></div>
            </>}
            <details className="three-geometry-editor"><summary>Contatos intencionais</summary><p>Selecione somente objetos com encaixe intencional. Outros pares continuam sendo verificados.</p>
              <label className="three-field">Encaixes intencionais com<select multiple size={4} value={selected.overlapWith} onChange={(event) => updateNode({ overlapWith: Array.from(event.target.selectedOptions, (option) => option.value) })}>
                {doc.nodes.filter((node) => node.id !== selected.id && node.kind !== 'group').map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label></details>
            <h3>Animação</h3>
            <label className="three-field">Movimento<select value={selected.animation.kind} onChange={(event) => updateNode({ animation: { ...selected.animation, kind: event.target.value as SceneNode['animation']['kind'] } })}>
              <option value="none">Sem movimento</option><option value="spin">Rotação contínua</option><option value="float">Flutuação</option><option value="orbit">Órbita circular</option></select></label>
            {selected.animation.kind !== 'none' && <>
              <label className="three-field">Eixo do movimento<select value={selected.animation.axis} onChange={(event) => updateNode({ animation: { ...selected.animation, axis: event.target.value as 'x' | 'y' | 'z' } })}>
                <option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
              <div className="three-material"><NumericField key={`period-${selected.animation.duration}`} label="Período (s)" value={selected.animation.duration} min={1} max={120} onChange={(duration) => updateNode({ animation: { ...selected.animation, duration } })} />
                <NumericField key={`phase-${selected.animation.phase}`} label="Fase (°)" value={selected.animation.phase} min={0} max={360} step={1} onChange={(phase) => updateNode({ animation: { ...selected.animation, phase } })} /></div>
              {selected.animation.kind !== 'spin' && <NumericField key={`amplitude-${selected.animation.amplitude}`} label="Amplitude / raio (m)" value={selected.animation.amplitude} min={0} max={100} onChange={(amplitude) => updateNode({ animation: { ...selected.animation, amplitude } })} />}
            </>}
            <div className="three-object-actions"><button type="button" onClick={duplicate}>Duplicar{selected.kind === 'group' ? ' grupo' : ''}</button>
              <button type="button" className="three-button--danger" onClick={remove}>Excluir{selected.kind === 'group' ? ' grupo' : ''}</button></div>
            {selected.kind === 'group' && <p className="three-hint">Duplicar e excluir incluem todos os descendentes.</p>}
          </div> : <div className="three-selection-tip"><span aria-hidden="true">◇</span><strong>Escolha um detalhe</strong><p>Clique em um objeto na cena ou na hierarquia para editar suas propriedades.</p></div>}
          <details open={!selected} className="three-environment"><summary>Projeto e ambiente</summary>
            <TextField key={doc.name} label="Nome do projeto" value={doc.name} onChange={(name) => commit({ ...doc, name })} />
            <NumericField key={`timeline-${doc.timeline.duration}`} label="Duração da timeline (s)" value={doc.timeline.duration} min={1} max={120} onChange={(duration) => { if (commit({ ...doc, timeline: { duration } })) seek(0) }} />
            <label className="three-color">Cor de fundo<input type="color" value={doc.environment.background} onChange={(event) => updateEnvironment({ background: event.target.value })} /></label>
            <div className="three-material"><NumericField key={`Exposição-${doc.environment.exposure}`} label="Exposição" value={doc.environment.exposure} min={0.1} max={3} onChange={(exposure) => updateEnvironment({ exposure })} />
              <NumericField key={`Intensidade da luz-${doc.environment.lightIntensity}`} label="Intensidade da luz" value={doc.environment.lightIntensity} min={0} max={5} onChange={(lightIntensity) => updateEnvironment({ lightIntensity })} /></div>
            <label className="three-check"><input type="checkbox" checked={doc.environment.shadows ?? true} onChange={(event) => updateEnvironment({ shadows: event.target.checked })} /> Sombras suaves</label>
            <label className="three-check"><input type="checkbox" checked={doc.environment.reflections ?? true} onChange={(event) => updateEnvironment({ reflections: event.target.checked })} /> Reflexões de estúdio</label>
            <label className="three-check"><input type="checkbox" checked={doc.environment.grid} onChange={(event) => updateEnvironment({ grid: event.target.checked })} /> Grade de referência</label>
            <label className="three-check"><input type="checkbox" checked={doc.environment.wireframe} onChange={(event) => updateEnvironment({ wireframe: event.target.checked })} /> Wireframe</label>
          </details>
          <div className="three-roadmap"><span className="workspace-eyebrow">EM EVOLUÇÃO</span><p>Perfis, curvas, malhas GLB, materiais físicos e reparo contextual disponíveis. A análise de interferências é amostrada; animação esquelética e física exigem recursos próprios.</p></div>
        </div>
      </aside>
    </div>
    </fieldset>
    <div className="three-playback" role="group" aria-label="Reprodução da cena">
      <button type="button" disabled={busy} aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? 'Pausar' : 'Reproduzir'}</button>
      <button type="button" onClick={() => { setPlaying(false); seek(0) }}>Reiniciar</button>
      <input type="range" aria-label="Tempo da cena" min={0} max={doc.timeline.duration} step={0.01} value={Math.min(time, doc.timeline.duration)}
        onChange={(event) => { setPlaying(false); seek(Number(event.target.value)) }} />
      <output aria-label="Tempo atual">{time.toFixed(1)} / {doc.timeline.duration} s</output>
      <span>{doc.nodes.filter((node) => node.animation.kind !== 'none').length} animações · loop</span>
    </div>
    <footer className="three-statusbar"><span><span className="three-dot" /> Three.js · local</span><span>{doc.nodes.filter((node) => node.kind !== 'group').length} malhas</span><span role="status">{saveStatus}</span><span>Projeto JSON 1.1</span></footer>
  </div>
}
