import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ThreeViewport, { type GizmoMode, type TransformPatch, type ViewportController } from './ThreeViewport.tsx'
import ThreeStage from './ThreeStage.tsx'
import GeometryEditor from './GeometryEditor.tsx'
import { importGlb } from './importGlb.ts'
import { inspectSceneAsync } from './inspectSceneAsync.ts'
import type { SceneInspection } from './sceneInspection.ts'
import { insertionPosition } from './scenePlacement.ts'
import { expandSceneRecipe, generateThreeScene, editThreeScene, healScene, SceneGenerationTimeoutError, type SceneGenerationEvent, type SceneGenerationReport } from './sceneGeneration.ts'
import ThreeGenerationProgress, { type SceneGenerationRun } from './ThreeGenerationProgress.tsx'
import { auditScene, describeAudit, type SceneAudit } from './sceneLayout.ts'
import type { AgentProvider } from '../ai/types.ts'
import { createPavilionScene, createOrbitalScene, createIslandScene } from './scenePreset.ts'
import { createArchitectureScene, createValleyScene } from './sceneShowcase.ts'
import { createCreationStage,createCombatArenaScene,createPlatformCourseScene,createLabPuzzleScene,createSolarSystemScene,createEnchantedForestScene,createCryptScene,createMarketTownScene,createSkyIslandsScene,createWastelandSurvivalScene,creationIdeas } from './sceneExperiences.ts'
import { creativeIdeas, inferSceneAction } from './sceneDirection.ts'
import { serializeSceneDraft } from './sceneDraft.ts'
import { conformTerrainPaths } from './sceneGrounding.ts'
import { prefabLabels, prefabTypes, type PrefabSpec, type PrefabType } from './scenePrefabs.ts'
import { characterTypes, isCharacterType } from './sceneCharacters.ts'
import { worldPrefabTypes } from './scenePrefabsWorld.ts'
import { actionOptionLabels, ageLabels, ambienceLabels, attackLabels, avatarLabels, beardLabels, behaviorLabels, buildLabels, emitterLabels, faunaLabels, gradeLabels, grassLabels, hairLabels, musicLabels, objectiveLabels, powerLabels, reactionLabels, routineLabels, soundLabels, styleLabels, weaponLabels, weatherLabels } from './sceneLabels.ts'
import { beardStyles, characterAges, characterBuilds, characterStyles, defaultCharacterSpec, hairStyles, type CharacterSpec } from './sceneCharacterArchetype.ts'
import { rebuildPrefab } from './sceneAssetEdit.ts'
import { normalizeProjectName } from '../workspace/projectName.ts'
import { editorShortcut, editorShortcutList, isTypingTarget, type EditorCommand } from './sceneKeyboard.ts'
import { ambiencePresets, attackStyles, DEFAULT_MOTION, emitterPresets, faunaDensities, grassDensities, MAX_PREMISE, MAX_ROUTINE_STEPS, npcReactions, routineActivities, avatarKinds, behaviorTypes, commitScene, createEmptyScene, createNode, duplicateSubtree, gradePresets, hasSurface, INTERACTION_KEYS, interactionActions, MAX_MESSAGE, MAX_SCENE_BYTES, MAX_SCENE_NODES, musicPresets, nodeLabels, objectiveTypes, powerKinds, soundPresets, weaponKinds, weatherKinds,
  parseScene, redoScene, removeSubtree, SCENE_STORAGE_KEY, skyLabels, skyPresets, subtreeIds, textureKinds, textureLabels, undoScene, validateAnimation,validateScene,
  type NodeKind, type SceneAnimation, type SceneBehavior, type SceneHistory, type SceneInteraction, type SceneKeyframe, type SceneNode, type ScenePlayer, type SceneEmitter, type SceneRoutineStep, type SceneSound, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import './ThreeWorkspace.css'

function RoutineEditor({ steps, places, onChange }: { steps: SceneRoutineStep[]; places: SceneNode[]; onChange: (steps: SceneRoutineStep[]) => void }) {
  const set = (index: number, patch: Partial<SceneRoutineStep>) => onChange(steps.map((step, i) => i === index ? { ...step, ...patch } : step))
  return <div className="three-routine" aria-label="Rotina do NPC">
    <p className="three-hint">Rotina diária: com ciclo dia/noite segue as horas; sem ciclo, os períodos se alternam durante o jogo.</p>
    {steps.map((step, index) => <div key={index} className="three-routine__step">
      <SelectField label={`Período ${index + 1}`} value={step.activity} options={routineActivities.map((activity) => [activity, routineLabels[activity]])} onChange={(activity) => set(index, { activity })} />
      <label className="three-field">Local<select value={step.target ?? ''} onChange={(event) => set(index, { target: event.target.value || null })}>
        <option value="">Perto da base</option>{places.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
      <div className="three-material"><NumericField key={`from-${index}-${step.from}`} label="Das (h)" value={step.from} min={0} max={24} step={0.5} onChange={(from) => set(index, { from })} />
        <NumericField key={`to-${index}-${step.to}`} label="Até (h)" value={step.to} min={0} max={24} step={0.5} onChange={(to) => set(index, { to })} /></div>
      <button type="button" onClick={() => onChange(steps.filter((_, i) => i !== index))}>Remover período</button>
    </div>)}
    <button type="button" disabled={steps.length >= MAX_ROUTINE_STEPS} onClick={() => onChange([...steps, { activity: 'wander', target: null, from: steps.at(-1)?.to ?? 8, to: Math.min(24, (steps.at(-1)?.to ?? 8) + 4) }])}>Adicionar período</button>
  </div>
}
function loadDraft(): { document: ThreeSceneDocument; error: string | null; restored?: boolean } {
  try {
    const stored = localStorage.getItem(SCENE_STORAGE_KEY)
    return { document: stored ? validateScene(conformTerrainPaths(parseScene(stored))) : createCreationStage(), error: null, restored: !!stored }
  } catch (error) {
    return { document: createCreationStage(), error: `Não foi possível recuperar o rascunho: ${error instanceof Error ? error.message : String(error)} O espaço de criação foi aberto; o rascunho anterior será preservado até sua próxima edição.` }
  }
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
function TextField({ label, value, max = 120, onChange }: { label: string; value: string; max?: number; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  return <label className="three-field">{label}<input value={draft} maxLength={max}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft.trim()) onChange(draft); else setDraft(value) }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}
function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <label className="three-field">{label}<select value={value} onChange={(event) => onChange(event.target.value as T)}>
    {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>
}
function VectorFields({ label, value, min, max, step, onChange }: {
  label: string; value: Vector3Tuple; min: number; max: number; step?: number; onChange: (value: Vector3Tuple) => void
}) {
  return <fieldset><legend>{label}</legend><div className="three-vector">{['X', 'Y', 'Z'].map((axis, index) =>
    <NumericField key={`${axis}-${value[index]}`} label={`${label} ${axis}`} value={value[index]} min={min} max={max} step={step}
      onChange={(next) => { const vector: Vector3Tuple = [...value]; vector[index] = next; onChange(vector) }} />)}</div></fieldset>
}
function KeyframeEditor({ animation, onApply }: { animation: SceneAnimation; onApply: (keys: SceneKeyframe[]) => boolean }) {
  const [draft, setDraft] = useState(() => JSON.stringify(animation.keys ?? [], null, 1))
  const [error, setError] = useState('')
  return <div className="three-keyframes"><p>Chaves {'{'}at 0–1, move [m], turn [°], scale [×]{'}'} relativas à pose base.</p>
    <textarea aria-label="Keyframes" rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button type="button" onClick={() => {
      try { if (onApply(validateAnimation({ ...animation, keys: JSON.parse(draft) }).keys!)) setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    }}>Aplicar keyframes</button>{error && <p role="alert">{error}</p>}</div>
}
const animationLabels: Record<SceneAnimation['kind'], string> = { none: 'Sem movimento', spin: 'Rotação contínua', float: 'Flutuação', orbit: 'Órbita circular', pulse: 'Pulsar (escala)', swing: 'Balanço', bounce: 'Quicar', keyframes: 'Keyframes' }
const kindIcons: Partial<Record<NodeKind, string>> = { group: '▤', light: '✺', terrain: '⛰', text: 'T' }

export default function ThreeWorkspace({ active, provider, ready, onBusyChange, onOpenProviderSettings }: {
  active: boolean; provider: AgentProvider; ready: boolean; onBusyChange: (busy: boolean) => void; onOpenProviderSettings: () => void
}) {
  const [initial] = useState(loadDraft)
  const [history, setHistory] = useState<SceneHistory>(() => ({ past: [], present: initial.document, future: [] }))
  const doc = history.present
  const lastCommitted = useRef(doc)
  const historyRef = useRef(history)
  historyRef.current = history
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = doc.nodes.find((node) => node.id === selectedId) ?? null
  const [error, setError] = useState<string | null>(initial.error)
  const [saveStatus, setSaveStatus] = useState(initial.error ? 'Rascunho não recuperado' : 'Rascunho local')
  const [storageError, setStorageError] = useState<string | null>(null)
  const [storageEnabled, setStorageEnabled] = useState(!initial.error)
  const [fitRequest, setFitRequest] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const glbInput = useRef<HTMLInputElement>(null)
  const viewport = useRef<ViewportController | null>(null)
  const [assetBusy, setAssetBusy] = useState(false)
  const [assetNotice, setAssetNotice] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const inspection = useRef<AbortController | null>(null)
  const [spatial, setSpatial] = useState<{ document: ThreeSceneDocument; report: SceneInspection; audit?: SceneAudit } | null>(null)
  const [action, setAction] = useState<'auto' | 'create' | 'edit' | 'repair'>('auto')
  const [filter, setFilter] = useState('')
  const [addKind, setAddKind] = useState<NodeKind | `prefab:${PrefabType}`>('box')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [seekTime, setSeekTime] = useState(0)
  const [seekRequest, setSeekRequest] = useState(0)
  const [gizmo, setGizmo] = useState<GizmoMode>('translate')
  const [snap, setSnap] = useState(false)
  const [playMode, setPlayMode] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [projectMenu, setProjectMenu] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [hasCreated, setHasCreated] = useState(!!initial.restored)
  const [prompt, setPrompt] = useState('')
  const effectiveAction = action === 'auto' ? inferSceneAction(prompt, hasCreated) : action
  const [generating, setGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState('')
  const [timeoutSeconds, setTimeoutSeconds] = useState(300)
  const [generationRun, setGenerationRun] = useState<SceneGenerationRun | null>(null)
  const [generationNotes, setGenerationNotes] = useState<string[]>([])
  const generation = useRef<AbortController | null>(null)
  useEffect(() => () => { generation.current?.abort(); inspection.current?.abort(); onBusyChange(false) }, [onBusyChange])
  // Every opened scene (draft, import, example, AI result) is audited in the background so problems surface without asking.
  const [auditRequest, setAuditRequest] = useState(1)
  useEffect(() => {
    if (!auditRequest || !active) return
    const controller = new AbortController(), target = doc
    const timer = setTimeout(() => {
      inspectSceneAsync(target, controller.signal).then((report) => { if (!controller.signal.aborted) setSpatial({ document: target, report, audit: auditScene(target, report) }) }).catch(() => {})
    }, 800)
    return () => { clearTimeout(timer); controller.abort() }
  // The audit runs per opened scene, not per edit.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [auditRequest, active])
  const seek = (value: number) => { setSeekTime(value); setSeekRequest((request) => request + 1); setTime(value) }

  useEffect(() => {
    if (!storageEnabled) return
    // Storage is an external system; reflect its synchronous result in the status.
    // oxlint-disable-next-line react/set-state-in-effect
    try { localStorage.setItem(SCENE_STORAGE_KEY, serializeSceneDraft(doc)); setSaveStatus('Salvo neste navegador'); setStorageError(null) }
    // oxlint-disable-next-line react/set-state-in-effect
    catch { setSaveStatus('Não salvo'); setStorageError('Não foi possível salvar no navegador. Exporte o JSON para guardar este projeto.') }
  }, [doc, storageEnabled])

  const commit = (document: ThreeSceneDocument): boolean => {
    try {
      // Async actions (AI, import, auto-fix) commit later: always extend the latest history, never the one from their start.
      const next = commitScene(historyRef.current, document)
      historyRef.current = next
      setHistory(next)
      lastCommitted.current = next.present
      setStorageEnabled(true)
      setPlayMode(false)
      setError(null)
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false }
  }
  const updateNode = (patch: Partial<SceneNode>) => {
    if (selected) return commit({ ...doc, nodes: doc.nodes.map((node) => node.id === selected.id ? { ...node, ...patch } : node) })
  }
  const transformNode = (id: string, patch: TransformPatch) => commit({ ...doc, nodes: doc.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) })
  const updateEnvironment = (patch: Partial<ThreeSceneDocument['environment']>) => commit({ ...doc, environment: { ...doc.environment, ...patch } })
  const updatePlayer = (patch: Partial<ScenePlayer>) => updateEnvironment({ player: { ...doc.environment.player!, ...patch } })
  const updateAnimation = (patch: Partial<SceneAnimation>) => {
    if (!selected) return
    const next = { ...selected.animation, ...patch }
    if (next.kind === 'keyframes' && (next.keys?.length ?? 0) < 2) next.keys = [{ at: 0, move: [0, 0, 0], turn: [0, 0, 0], scale: [1, 1, 1] }, { at: 1, move: [0, 1, 0], turn: [0, 0, 0], scale: [1, 1, 1] }]
    return updateNode({ animation: next })
  }
  const updateInteraction = (patch: Partial<SceneInteraction> | null) => {
    if (!selected) return
    if (!patch) { const { interaction: _removed, ...rest } = selected; return commit({ ...doc, nodes: doc.nodes.map((node) => node.id === selected.id ? rest : node) }) }
    const base: SceneInteraction = selected.interaction ?? { trigger: 'click', key: '', radius: 3, action: selected.animation.kind !== 'none' ? 'toggleAnimation' : 'message', targetId: null, message: '' }
    const next = { ...base, ...patch }
    if (next.trigger === 'key' && !INTERACTION_KEYS.test(next.key)) next.key = '1'
    if (['collect', 'heal', 'powerup'].includes(next.action)) next.targetId = null
    for (const key of ['item', 'requires'] as const) if (next[key] === '') delete next[key]
    return updateNode({ interaction: next })
  }
  const updateBehavior = (patch: Partial<SceneBehavior> | null) => {
    if (!selected) return
    if (!patch) { const { behavior: _removed, ...rest } = selected; return commit({ ...doc, nodes: doc.nodes.map((node) => node.id === selected.id ? rest : node) }) }
    return updateNode({ behavior: { ...(selected.behavior ?? { type: 'enemy', speed: 2.5, range: 10, damage: 20 }), ...patch } })
  }
  const rebuildAsset = (patch: Partial<PrefabSpec>) => {
    if (!selected) return
    try { commit(rebuildPrefab(doc, selected.id, patch)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const updateSound = (patch: Partial<SceneSound> | null) => {
    if (!selected) return
    if (!patch) { const { sound: _removed, ...rest } = selected; return commit({ ...doc, nodes: doc.nodes.map((node) => node.id === selected.id ? rest : node) }) }
    return updateNode({ sound: { ...(selected.sound ?? { preset: 'wind', volume: 0.6, radius: 12 }), ...patch } })
  }
  const add = () => {
    const parentId = selected?.kind === 'group' ? selected.id : selected?.parentId ?? null
    if (addKind.startsWith('prefab:')) {
      try {
        const type = addKind.slice(7) as PrefabType, id = `${type}-${crypto.randomUUID().slice(0, 8)}`
        const expanded = expandSceneRecipe({ name: doc.name, background: doc.environment.background, exposure: doc.environment.exposure, lightIntensity: doc.environment.lightIntensity, duration: doc.timeline.duration, environment: doc.environment,
          nodes: [{ ...createNode('group', parentId), id, name: prefabLabels[type], color: '#cccccc', metalness: 0, roughness: 0.6, repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' },
            prefab: { type, size: 1, seed: Math.floor(Math.random() * 1000), primary: null, secondary: null, text: '', lit: true, interactive: true } }] }, () => {}, doc.nodes)
        const added = expanded.nodes.slice(doc.nodes.length), root = added[0]
        root.position = insertionPosition(doc, { ...root, position: [0, 0, 0] }, added)
        if (commit({ ...doc, nodes: [...doc.nodes, ...added] })) { setSelectedId(root.id); setFilter('') }
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      return
    }
    const node = createNode(addKind as NodeKind, parentId)
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
    if (commit(removeSubtree(doc, selected.id))) setSelectedId(null)
  }
  const replace = (document: ThreeSceneDocument) => {
    if (commit(document)) { setSelectedId(null); setFilter(''); setProjectMenu(false); setPlaying(false); seek(0); setFitRequest((value) => value + 1); setAuditRequest((value) => value + 1) }
  }
  const importFile = async (file: File) => {
    try {
      if (file.size > MAX_SCENE_BYTES) throw new Error('O projeto excede o limite de 32 MB.')
      const document = validateScene(conformTerrainPaths(parseScene(await file.text())))
      replace(document)
      setHasCreated(true)
      setAction('auto')
      setPrompt('')
    } catch (cause) { setError(`Importação recusada: ${cause instanceof Error ? cause.message : String(cause)}`) }
  }
  const exportFile = () => { download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${normalizeProjectName(doc.name)}.three.json`); setProjectMenu(false) }
  const exportGlb = async () => {
    if (assetBusy) return
    setAssetBusy(true)
    setAssetNotice('')
    try {
      const { exportSceneGlb } = await import('./sceneExport.ts')
      download(new Blob([await exportSceneGlb(doc)], { type: 'model/gltf-binary' }), `${normalizeProjectName(doc.name)}.glb`)
      setAssetNotice('GLB exportado com materiais PBR, luzes e animações em clipes. Interações, céu e efeitos de pós-processamento são do estúdio e não fazem parte do arquivo.')
    } catch (cause) { setError(`Exportação GLB falhou: ${cause instanceof Error ? cause.message : String(cause)}`) }
    finally { setAssetBusy(false) }
  }
  const capture = async () => {
    try { const blob = await viewport.current?.capture(); if (blob) download(blob, `${normalizeProjectName(doc.name)}.png`) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const generate = async () => {
    if (generation.current || inspecting || assetBusy || !ready || (effectiveAction !== 'repair' && !prompt.trim())) return
    const controller = new AbortController()
    generation.current = controller
    setGenerating(true)
    onBusyChange(true)
    setError(null)
    setGenerationNotes([])
    setPlaying(false)
    setPlayMode(false)
    // Timestamp capture runs only after an explicit form submission.
    // oxlint-disable-next-line react/purity
    const started = performance.now()
    // oxlint-disable-next-line react/purity
    const startedAt = Date.now()
    let lastEvent: SceneGenerationEvent = { stage: 'prepare', attempt: 1, detail: 'Preparando o pedido…' }
    setGenerationRun({ startedAt, budgetSeconds: timeoutSeconds, events: [], outcome: 'running' })
    const deadline = setTimeout(() => controller.abort(new SceneGenerationTimeoutError(timeoutSeconds, lastEvent)), timeoutSeconds * 1000)
    try {
      let checked: SceneInspection | null = null, outcome: SceneGenerationReport | null = null
      const collect = (report: SceneGenerationReport) => { outcome = report; if (report.inspection) checked = report.inspection }
      const progress = (event: SceneGenerationEvent) => {
        lastEvent = event
        setGenerationStatus(event.detail)
        setGenerationRun((run) => run ? { ...run, events: [...run.events, { ...event, at: Date.now() }] } : run)
      }
      const document = effectiveAction === 'create'
        ? await generateThreeScene(provider, prompt, controller.signal, setGenerationStatus, progress, collect)
        : await editThreeScene(provider, doc, prompt, controller.signal, { mode: effectiveAction, selectedId, onProgress: progress, onReport: collect, onInspection: (report) => { if (!checked) setSpatial({ document: doc, report }); checked = report } })
      if (controller.signal.aborted && !(controller.signal.reason instanceof SceneGenerationTimeoutError)) return
      replace(document)
      setHasCreated(true)
      setAction('auto')
      setPrompt('')
      if (checked) setSpatial({ document: lastCommitted.current, report: checked, audit: auditScene(lastCommitted.current, checked) })
      if (studioOpen) setReportsOpen(true)
      setGenerationNotes((outcome as SceneGenerationReport | null)?.warnings ?? [])
      setPlaying(document.nodes.some((node) => node.animation.kind !== 'none' && node.animation.start !== 'trigger'))
      setGenerationRun((run) => run ? { ...run, outcome: 'success', finishedAt: Date.now(), events: [...run.events, { stage: 'application', attempt: lastEvent.attempt,maxAttempts:lastEvent.maxAttempts, at: Date.now(), detail: `Cena aplicada no editor: ${document.nodes.length} objetos.`, objects: document.nodes.length }] } : run)
      // oxlint-disable-next-line react/purity
      setGenerationStatus(`Cena aplicada em ${((performance.now() - started) / 1000).toFixed(1)} s · ${document.nodes.length} objetos`)
    } catch (cause) {
      const outcome = cause instanceof SceneGenerationTimeoutError ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'error'
      setReportsOpen(true)
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
    setReportsOpen(true)
    setProjectMenu(false)
    const controller = new AbortController()
    inspection.current = controller
    setInspecting(true)
    setPlaying(false)
    setPlayMode(false)
    onBusyChange(true)
    setError(null)
    try { const report = await inspectSceneAsync(doc, controller.signal); if (!controller.signal.aborted) setSpatial({ document: doc, report, audit: auditScene(doc, report) }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { inspection.current = null; setInspecting(false); onBusyChange(false) }
  }
  /** Scene doctor without AI: flattens terrain under structures, rescues objects from the water, rests, separates and fixes reach and spawn. */
  const autoFix = async () => {
    if (generating || assetBusy || inspection.current) return
    setReportsOpen(true)
    const controller = new AbortController()
    inspection.current = controller
    setInspecting(true)
    setPlaying(false)
    setPlayMode(false)
    onBusyChange(true)
    setError(null)
    try {
      const before = spatial?.document === doc ? spatial.report : await inspectSceneAsync(doc, controller.signal)
      const healed = await healScene(doc, before, controller.signal)
      if (controller.signal.aborted) return
      if (healed.document !== doc && commit(healed.document)) setSpatial({ document: lastCommitted.current, report: healed.inspection ?? before, audit: healed.audit })
      else setSpatial({ document: doc, report: healed.inspection ?? before, audit: healed.audit })
      const remaining = describeAudit(healed.audit)
      setGenerationNotes([...healed.notes, ...(remaining.length ? [`Ainda restam: ${remaining.join('; ')}. Use Corrigir cena com IA para as sobreposições.`] : ['Nenhum problema restante nas verificações automáticas.'])])
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
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
  const enterPlay = () => { if (!busy && doc.nodes.length) { setPlaying(false); setHelpOpen(false); setPlayMode(true) } }
  const runShortcut = (shortcut: EditorCommand) => {
    switch (shortcut.command) {
      case 'translate': case 'rotate': case 'scale': setGizmo(shortcut.command); break
      case 'frame': setFitRequest((value) => value + 1); break
      case 'delete': remove(); break
      case 'duplicate': duplicate(); break
      case 'undo': setHistory(undoScene(history)); setError(null); break
      case 'redo': setHistory(redoScene(history)); setError(null); break
      case 'toggleVisible': if (selected) updateNode({ visible: !selected.visible }); break
      case 'deselect': if (helpOpen) setHelpOpen(false); else setSelectedId(null); break
      case 'playPause': setPlaying(!playing); break
      case 'grid': updateEnvironment({ grid: !doc.environment.grid }); break
      case 'play': enterPlay(); break
      case 'snap': setSnap(!snap); break
      case 'help': setHelpOpen(true); break
      case 'capture': void capture(); break
      case 'view': viewport.current?.view(shortcut.view); break
      case 'nudge': if (selected) { const position: Vector3Tuple = [...selected.position]; position[shortcut.axis] = Math.round((position[shortcut.axis] + shortcut.amount) * 1000) / 1000; updateNode({ position }) } break
    }
  }
  const shortcuts = useRef(runShortcut)
  useEffect(() => { shortcuts.current = runShortcut })
  useEffect(() => {
    if (!active || playMode || busy) return
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return
      const target = event.target as HTMLElement | null
      if ((event.code === 'Space' || event.code === 'Enter') && target?.closest?.('button, a, summary, [role="slider"]')) return
      const shortcut = editorShortcut(event)
      if (!shortcut) return
      if (!studioOpen && !['play', 'frame', 'help', 'capture', 'deselect', 'undo', 'redo'].includes(shortcut.command)) return
      event.preventDefault()
      shortcuts.current(shortcut)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, playMode, busy, studioOpen])
  useEffect(() => {
    if (!projectMenu) return
    const dismiss = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.three-toolbar, .three-commandbar')) setProjectMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setProjectMenu(false) }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [projectMenu])

  const descendants = selected ? subtreeIds(doc.nodes, selected.id) : new Set<string>()
  const children = useMemo(() => {
    const map = new Map<string | null, SceneNode[]>()
    for (const node of doc.nodes) map.set(node.parentId, [...map.get(node.parentId) ?? [], node])
    return map
  }, [doc.nodes])
  const visibleRows = (parentId: string | null, depth = 0): ReactNode => (children.get(parentId) ?? []).map((node) => {
    const matches = !filter || node.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
    return <div key={node.id}>{matches && <button type="button" className="three-tree__node" aria-pressed={selectedId === node.id}
      style={{ paddingLeft: 12 + depth * 14 }} onClick={() => setSelectedId(node.id)}>
      <span aria-hidden="true">{kindIcons[node.kind] ?? '◇'}</span><span>{node.name}</span>
      <small>{!node.visible ? 'Oculto' : node.interaction ? 'Interativo' : nodeLabels[node.kind]}</small></button>}{visibleRows(node.id, depth + 1)}</div>
  })
  const env = doc.environment, player = env.player!, audio = env.audio ?? { ambience: 'auto', music: 'auto', volume: 0.7 }, motion = env.motion ?? DEFAULT_MOTION
  const material = selected?.material

  return <div className={`three-workspace three-workspace--${studioOpen ? 'studio' : 'create'}${playMode ? ' three-workspace--playing' : ''}`} hidden={!active}>
    <header className="three-commandbar">
      <div className="three-commandbar__identity"><span className="three-brandmark" aria-hidden="true">◈</span><div><span className="workspace-eyebrow">FORMA / MUNDOS</span><strong>{doc.name}</strong></div></div>
      <span className="three-save-indicator" title={saveStatus}><span className="three-dot" />{storageError || (initial.error && !storageEnabled) ? 'Não salvo' : 'Salvo localmente'}</span>
      <div className="three-commandbar__actions">
        <button type="button" aria-pressed={studioOpen} onClick={() => { setStudioOpen(!studioOpen); setSelectedId(null); setProjectMenu(false) }}>Editor avançado</button>
        <button type="button" aria-expanded={projectMenu} onClick={() => setProjectMenu(!projectMenu)}>Projeto ▾</button>
        <button type="button" aria-label="Atividade" aria-expanded={reportsOpen || generating || inspecting} onClick={() => setReportsOpen(!reportsOpen)}>Atividade{generating ? ' ◌' : generationNotes.length ? <span className="three-activity-count" aria-hidden="true">{generationNotes.length}</span> : ''}</button>
        <button type="button" className="three-button--primary" disabled={busy || !doc.nodes.length} onClick={enterPlay}>▶ Jogar</button>
      </div>
    </header>
    <form className="three-prompt" onSubmit={(event) => { event.preventDefault(); void generate() }}>
      <div className="three-prompt__intro"><span className="workspace-eyebrow">{hasCreated ? 'CONTINUE CRIANDO' : 'SEU PRÓXIMO MUNDO'}</span><strong>{hasCreated ? 'O que vamos mudar?' : 'Imagine. Descreva. Explore.'}</strong>
        <span>Você traz a ideia. A IA cuida da cena.</span></div>
      <div className="three-prompt__composer"><textarea aria-label="Descreva a cena Three.js" maxLength={4000} rows={2} disabled={busy}
        placeholder="Descreva o lugar, o que o jogador faz e seu objetivo: combate, plataformas, enigmas, exploração…" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        {!hasCreated && !prompt && <div className="three-prompt__suggestions" aria-label="Ideias para começar">{[...creationIdeas.slice(0, 4), ...creativeIdeas.slice(0, 4)].map(([label, idea]) => <button key={label} type="button" disabled={busy} onClick={() => setPrompt(idea)}>{label} ↗</button>)}</div>}
        <div className="three-prompt__buttons"><details className="three-prompt__options"><summary>Opções de criação</summary><div><label className="three-generation-limit">Ação da IA
          <select aria-label="Ação da IA" value={action} disabled={busy} onChange={(event) => setAction(event.target.value as typeof action)}>
            <option value="auto">Automática pelo pedido</option><option value="create">Criar nova cena</option><option value="edit">Editar cena atual</option><option value="repair">Corrigir cena</option></select></label><label className="three-generation-limit">Tempo máximo de geração
          <select aria-label="Tempo máximo de geração" value={timeoutSeconds} disabled={busy} onChange={(event) => setTimeoutSeconds(Number(event.target.value))}>
            <option value={120}>2 minutos</option><option value={300}>5 minutos</option><option value={600}>10 minutos</option></select></label></div></details>
          {generating ? <button type="button" onClick={(event) => { event.preventDefault(); generation.current?.abort(new DOMException('Geração cancelada. A cena anterior foi preservada.', 'AbortError')) }}>Cancelar geração</button>
          : ready ? <button type="submit" className="three-button--primary" disabled={inspecting || assetBusy || (effectiveAction !== 'repair' && !prompt.trim())}>{effectiveAction === 'create' ? 'Criar cena com IA' : effectiveAction === 'edit' ? 'Editar cena com IA' : 'Corrigir cena'}</button>
            : <button type="button" onClick={onOpenProviderSettings}>Configurar IA para criar</button>}
          <span className="three-prompt__status" role="status">{generationStatus || (effectiveAction === 'edit' ? 'Alterando a cena atual · Desfazer disponível' : 'Composição, materiais e iluminação automáticos')}</span></div>
      </div>
    </form>
    <div className="three-reports" hidden={!reportsOpen && !generating && !inspecting}>
    {generationRun && <ThreeGenerationProgress run={generationRun} model={`${provider.id === 'local-codex' ? 'Codex' : provider.id === 'local-claude' ? 'Claude Code' : 'IA'} · ${provider.model?.trim() || 'modelo padrão'}`} />}
    {generationNotes.length > 0 && <details className="three-generation-notes" open><summary>Cena aplicada com {generationNotes.length} {generationNotes.length === 1 ? 'observação' : 'observações'}</summary>
      <ul>{generationNotes.map((note) => <li key={note}>{note}</li>)}</ul>
      <p>Peça mudanças com <strong>Editar cena atual</strong> ou use <strong>Corrigir cena</strong> para resolver o que restou. Desfazer restaura a cena anterior.</p>
      <button type="button" onClick={() => setGenerationNotes([])}>Dispensar</button></details>}
    {inspecting && <div className="three-spatial three-inspecting" role="status">Verificando superfícies e poses em segundo plano… <button type="button" onClick={() => inspection.current?.abort(new Error('Inspeção cancelada.'))}>Cancelar inspeção</button></div>}
    {spatial && <details className="three-spatial" open={(spatial.audit?.total ?? spatial.report.intersections.length) > 0 && !generationNotes.length}><summary>Diagnóstico: {spatial.report.intersections.length} pares{spatial.audit ? ` · ${spatial.audit.total - spatial.audit.overlaps} outros problemas` : ''} · {spatial.document === doc ? spatial.report.complete ? 'amostras concluídas' : 'cobertura incompleta' : 'desatualizado — verifique novamente'}</summary>
      {spatial.audit && describeAudit({ ...spatial.audit, overlaps: 0 }).length > 0 && <ul className="three-spatial__audit">{describeAudit({ ...spatial.audit, overlaps: 0 }).map((item) => <li key={item}>{item}</li>)}</ul>}
      <p>{spatial.report.sampledTimes.length} poses · {spatial.report.checkedPairs} pares refinados por triângulos · {spatial.report.skippedContacts} contatos declarados, apoios no solo ou decoração não colidível · {spatial.report.assemblyContacts ?? 0} encaixes internos de montagens. Não é uma prova contínua de ausência de colisões.</p>
      {spatial.report.intersections.slice(0, 30).map((issue) => <div key={`${issue.a}-${issue.b}`} className="three-spatial__pair"><button type="button" onClick={() => { setSelectedId(issue.a); setFitRequest((value) => value + 1) }}>{issue.nameA}</button><span>↔</span><button type="button" onClick={() => { setSelectedId(issue.b); setFitRequest((value) => value + 1) }}>{issue.nameB}</button><small>{issue.kind === 'surface' ? 'Superfícies se cruzam' : 'Contenção'} · t={issue.times.map((time) => time.toFixed(1)).join(', ')} s</small></div>)}
      {(spatial.report.surfaceConflicts ?? []).slice(0, 30).map((issue) => <div key={`surface-${issue.a}-${issue.b}`} className="three-spatial__pair"><button type="button" onClick={() => { setSelectedId(issue.a); setFitRequest(value => value + 1) }}>{issue.nameA}</button><span>↔</span><button type="button" onClick={() => { setSelectedId(issue.b); setFitRequest(value => value + 1) }}>{issue.nameB}</button><small>Superfícies na mesma profundidade · {issue.area.toFixed(2)} m²</small></div>)}
      {spatial.report.surfaceCheckComplete === false && <p>A verificação de superfícies coplanares atingiu o orçamento de análise; a cobertura dessa etapa está incompleta.</p>}
      <div className="three-spatial__actions"><button type="button" className="three-button--primary" disabled={busy} onClick={() => void autoFix()}>Corrigir automaticamente (sem IA)</button>
        <button type="button" disabled={busy} onClick={() => setAction('repair')}>Preparar Corrigir cena com IA</button></div>
    </details>}
    </div>
    <fieldset className="three-editor" disabled={busy}>
    <div className="three-toolbar" hidden={!projectMenu}>
      <div className="three-toolbar__title"><span className="workspace-eyebrow">ARQUIVOS, EXEMPLOS E FERRAMENTAS</span></div>
      <div className="three-toolbar__actions">
        <button type="button" onClick={() => replace(createEmptyScene())}>Cena vazia</button>
        <button type="button" onClick={() => replace(createPavilionScene())}>Abrir exemplo</button>
        <button type="button" onClick={() => replace(createOrbitalScene())}>Exemplo detalhado</button>
        <button type="button" onClick={() => replace(createIslandScene())}>Exemplo jogável</button>
        <button type="button" onClick={() => replace(createCombatArenaScene())}>Arena de combate</button>
        <button type="button" onClick={() => replace(createPlatformCourseScene())}>Plataformas no espaço</button>
        <button type="button" onClick={() => replace(createLabPuzzleScene())}>Puzzle no laboratório</button>
        <button type="button" onClick={() => replace(createSolarSystemScene())}>Sistema solar</button>
        <button type="button" onClick={() => replace(createEnchantedForestScene())}>Floresta encantada</button>
        <button type="button" onClick={() => replace(createCryptScene())}>Cripta do Rei Esqueleto</button>
        <button type="button" onClick={() => replace(createMarketTownScene())}>Mercado de Valemar</button>
        <button type="button" onClick={() => replace(createSkyIslandsScene())}>Ilhas Celestes</button>
        <button type="button" onClick={() => replace(createWastelandSurvivalScene())}>Ermo dos Saqueadores</button>
        <button type="button" onClick={() => replace(createValleyScene())}>Vale dos Ventos</button>
        <button type="button" onClick={() => replace(createArchitectureScene())}>Casa com dois pavimentos</button>
        <span className="three-toolbar__separator" />
        <button type="button" disabled={!history.past.length} onClick={() => { setHistory(undoScene(history)); setError(null) }}>Desfazer</button>
        <button type="button" disabled={!history.future.length} onClick={() => { setHistory(redoScene(history)); setError(null) }}>Refazer</button>
        <button type="button" onClick={() => fileInput.current?.click()}>Importar JSON</button>
        <button type="button" onClick={() => glbInput.current?.click()}>Importar GLB</button>
        <input ref={glbInput} type="file" accept=".glb,model/gltf-binary" aria-label="Importar modelo GLB" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importAsset(file) }} />
        <button type="button" onClick={() => void verify()}>Verificar cena</button>
        <button type="button" onClick={() => void capture()}>Capturar PNG</button>
        <button type="button" onClick={() => void exportGlb()}>Exportar GLB</button>
        <button type="button" className="three-button--primary" onClick={exportFile}>Exportar JSON</button>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Importar projeto Three.js" hidden
          onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file) }} />
      </div>
    </div>
    {(assetNotice || assetBusy) && <p className="three-asset-notice" role="status">{assetBusy ? 'Processando o modelo GLB…' : assetNotice}</p>}
    {(error || storageError) && <div className="three-notice" role="alert">{error && <span>{error}</span>}{storageError && <span>{storageError}</span>}</div>}
    <div className="three-layout">
      <aside className="three-panel three-hierarchy" aria-label="Hierarquia da cena" hidden={!studioOpen}>
        <div className="three-panel__heading"><h2>Cena</h2><span>{doc.nodes.length} / {MAX_SCENE_NODES}</span></div>
        <p className="three-panel__intro">Organize formas, luzes e grupos para compor cada detalhe.</p>
        <div className="three-add"><select aria-label="Tipo de objeto" value={addKind} onChange={(event) => setAddKind(event.target.value as typeof addKind)}>
          <optgroup label="Formas e luzes">{Object.entries(nodeLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</optgroup>
          <optgroup label="Pré-fabricados">{prefabTypes.filter((type) => !(characterTypes as readonly string[]).includes(type) && !(worldPrefabTypes as readonly string[]).includes(type)).map((type) => <option key={type} value={`prefab:${type}`}>{prefabLabels[type]}</option>)}</optgroup>
          <optgroup label="Personagens e criaturas">{characterTypes.map((type) => <option key={type} value={`prefab:${type}`}>{prefabLabels[type]}</option>)}</optgroup>
          <optgroup label="Mundo e jogabilidade">{worldPrefabTypes.map((type) => <option key={type} value={`prefab:${type}`}>{prefabLabels[type]}</option>)}</optgroup></select>
          <button type="button" onClick={add} disabled={doc.nodes.length >= MAX_SCENE_NODES}>Adicionar</button></div>
        <input className="three-search" aria-label="Buscar objetos" placeholder="Buscar na cena…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <div className="three-tree">{visibleRows(null)}{!doc.nodes.length && <p className="three-empty">Sua cena começa aqui. Adicione uma forma ou um grupo.</p>}</div>
        <div className="three-panel__footnote">{selected?.kind === 'group' ? 'Novos objetos entram no grupo selecionado.' : 'Selecione um grupo para adicionar objetos dentro dele.'}</div>
      </aside>
      <ThreeStage showPlayback={studioOpen && !playMode} playing={playing} time={time} duration={doc.timeline.duration} onPlay={() => setPlaying(!playing)} onSeek={(seconds) => { setPlaying(false); seek(seconds) }}>
        <ThreeViewport document={doc} selectedId={selected?.id ?? null} active={active} fitRequest={fitRequest} playing={playing} seekTime={seekTime} seekRequest={seekRequest}
          gizmo={studioOpen ? gizmo : null} snap={snap} playMode={playMode} presentation={!studioOpen} controller={viewport} onTimeChange={setTime} onSelect={studioOpen ? setSelectedId : () => {}} onTransform={transformNode} onExitPlay={() => setPlayMode(false)} />
        {!playMode && !studioOpen && <div className="three-scene-caption"><span className="workspace-eyebrow">{hasCreated ? 'SUA CRIAÇÃO' : 'EXPLORE UMA CENA'}</span><strong>{doc.name}</strong><span>Arraste para olhar ao redor · Role para aproximar</span>
          <div><button type="button" disabled={busy} onClick={() => { replace(createCombatArenaScene()); setProjectMenu(false) }}>Jogar arena ↗</button><button type="button" disabled={busy} onClick={() => { replace(createPlatformCourseScene()); setProjectMenu(false) }}>Jogar plataformas ↗</button><button type="button" disabled={busy} onClick={() => { replace(createLabPuzzleScene()); setProjectMenu(false) }}>Resolver puzzle ↗</button><button type="button" disabled={busy} onClick={() => { replace(createCryptScene()); setProjectMenu(false) }}>Explorar cripta ↗</button><button type="button" disabled={busy} onClick={() => { replace(createMarketTownScene()); setProjectMenu(false) }}>Visitar mercado ↗</button></div></div>}
        {!playMode && studioOpen && <div className="three-stage__tools">
          <div className="three-segmented" role="group" aria-label="Ferramenta de transformação">
            {([['translate', 'Mover', 'W'], ['rotate', 'Girar', 'E'], ['scale', 'Escalar', 'R']] as const).map(([mode, label, key]) =>
              <button key={mode} type="button" aria-pressed={gizmo === mode} title={`${label} (${key})`} onClick={() => setGizmo(gizmo === mode ? null : mode)}>{label}</button>)}
          </div>
          <button type="button" aria-pressed={snap} title="Encaixe (S)" onClick={() => setSnap(!snap)}>Encaixe</button>
          <button type="button" onClick={() => setFitRequest((value) => value + 1)}>{selected ? 'Enquadrar seleção' : 'Enquadrar cena'}</button>
          {selected && <button type="button" onClick={() => setSelectedId(null)}>Limpar seleção</button>}
          <select aria-label="Vista da câmera" value="" onChange={(event) => { if (event.target.value) viewport.current?.view(event.target.value as 'front') }}>
            <option value="">Vista…</option><option value="front">Frente (1)</option><option value="right">Lateral (3)</option><option value="top">Topo (7)</option><option value="perspective">Perspectiva (0)</option></select>
          <button type="button" onClick={() => setHelpOpen(true)}>Atalhos</button>
        </div>}
        {!playMode && <button type="button" className="three-stage__play three-button--primary" disabled={busy || !doc.nodes.length} onClick={enterPlay}>Explorar em primeira pessoa</button>}
        {helpOpen && <div className="three-help" role="dialog" aria-modal="true" aria-label="Atalhos de teclado">
          <div className="three-help__heading"><strong>Atalhos do editor</strong><button type="button" onClick={() => setHelpOpen(false)}>Fechar</button></div>
          <dl>{editorShortcutList.map(([keys, label]) => <div key={keys}><dt>{keys}</dt><dd>{label}</dd></div>)}</dl>
          <p>No modo jogo: WASD anda, mouse olha, Espaço pula, Shift corre, F alterna voo, E interage e Esc sai.</p>
        </div>}
      </ThreeStage>
      <aside className="three-panel three-inspector" aria-label="Inspector de cena" hidden={!studioOpen}>
        <div className="three-panel__heading"><h2>Inspector</h2><span>{selected ? nodeLabels[selected.kind] : 'Ambiente'}</span></div>
        <div className="three-inspector__body">
          {selected && material ? <div key={selected.id}>
            <TextField key={selected.name} label="Nome do objeto" value={selected.name} onChange={(name) => updateNode({ name })} />
            <label className="three-field">Grupo pai<select value={selected.parentId ?? ''} onChange={(event) => updateNode({ parentId: event.target.value || null })}>
              <option value="">Raiz da cena</option>{doc.nodes.filter((node) => node.kind === 'group' && !descendants.has(node.id)).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
            <p className="three-hint">Transformações locais ao grupo. Trocar o pai conserva os valores locais.{selected.animation.kind !== 'none' ? ' Objetos animados são editados pelos campos, não pelo gizmo.' : ''}</p>
            <label className="three-check"><input type="checkbox" checked={selected.visible} onChange={(event) => updateNode({ visible: event.target.checked })} /> Visível</label>
            {hasSurface(selected.kind) && <label className="three-check"><input type="checkbox" checked={selected.collidable !== false} onChange={(event) => updateNode({ collidable: event.target.checked })} /> Colide com o jogador</label>}
            <VectorFields label="Posição (m)" value={selected.position} min={-10000} max={10000} onChange={(position) => updateNode({ position })} />
            <VectorFields label="Rotação (°)" value={selected.rotation} min={-360} max={360} step={1} onChange={(rotation) => updateNode({ rotation })} />
            <VectorFields label="Escala" value={selected.scale} min={0.01} max={100} onChange={(scale) => updateNode({ scale })} />
            {selected.kind === 'light' && selected.light && <>
              <h3>Luz</h3>
              <SelectField label="Tipo de luz" value={selected.light.type} options={[['point', 'Pontual'], ['spot', 'Spot (aponta para -Y)']]} onChange={(type) => updateNode({ light: { ...selected.light!, type } })} />
              <label className="three-color">Cor da luz<input type="color" value={selected.light.color} onChange={(event) => updateNode({ light: { ...selected.light!, color: event.target.value } })} /></label>
              <div className="three-material"><NumericField key={`li-${selected.light.intensity}`} label="Intensidade (cd)" value={selected.light.intensity} min={0} max={2000} step={1} onChange={(intensity) => updateNode({ light: { ...selected.light!, intensity } })} />
                <NumericField key={`ld-${selected.light.distance}`} label="Alcance (m, 0 = infinito)" value={selected.light.distance} min={0} max={1000} step={1} onChange={(distance) => updateNode({ light: { ...selected.light!, distance } })} /></div>
              {selected.light.type === 'spot' && <div className="three-material"><NumericField key={`la-${selected.light.angle}`} label="Abertura (°)" value={selected.light.angle} min={1} max={89} step={1} onChange={(angle) => updateNode({ light: { ...selected.light!, angle } })} />
                <NumericField key={`lp-${selected.light.penumbra}`} label="Penumbra" value={selected.light.penumbra} min={0} max={1} step={0.05} onChange={(penumbra) => updateNode({ light: { ...selected.light!, penumbra } })} /></div>}
              <label className="three-check"><input type="checkbox" checked={selected.light.castShadow} onChange={(event) => updateNode({ light: { ...selected.light!, castShadow: event.target.checked } })} /> Projeta sombras (até 4 luzes)</label>
            </>}
            {hasSurface(selected.kind) && <>
              <VectorFields label="Dimensões (m)" value={selected.dimensions} min={0.01} max={1000} onChange={(dimensions) => updateNode({ dimensions })} />
              {selected.kind === 'text' && <TextField key={selected.geometry.text} label="Texto da placa" max={160} value={selected.geometry.text} onChange={(text) => updateNode({ geometry: { ...selected.geometry, text } })} />}
              <GeometryEditor key={`${selected.id}-${history.past.length}-${history.future.length}`} node={selected} onApply={(geometry) => updateNode({ geometry }) ?? false} />
              <h3>Material físico</h3>
              <label className="three-color">{selected.kind === 'text' ? 'Cor do texto' : 'Cor'}<input type="color" value={material.color} onChange={(event) => updateNode({ material: { ...material, color: event.target.value } })} /></label>
              <div className="three-material"><NumericField key={`Metalicidade-${material.metalness}`} label="Metalicidade" value={material.metalness} min={0} max={1} step={0.05} onChange={(metalness) => updateNode({ material: { ...material, metalness } })} />
                <NumericField key={`Rugosidade-${material.roughness}`} label="Rugosidade" value={material.roughness} min={0} max={1} step={0.05} onChange={(roughness) => updateNode({ material: { ...material, roughness } })} /></div>
              <SelectField label="Textura" value={material.texture ?? 'none'} options={textureKinds.map((kind) => [kind, textureLabels[kind]])} onChange={(texture) => updateNode({ material: { ...material, texture, textureImage: '' } })} />
              <div className="three-material"><NumericField key={`texscale-${material.textureScale}`} label="Repetição da textura" value={material.textureScale ?? 1} min={0.1} max={64} step={0.5} onChange={(textureScale) => updateNode({ material: { ...material, textureScale } })} />
                <NumericField key={`normal-${material.normalStrength}`} label="Relevo da textura" value={material.normalStrength ?? 1} min={0} max={3} step={0.1} onChange={(normalStrength) => updateNode({ material: { ...material, normalStrength } })} /></div>
              <div className="three-material"><NumericField key={`coat-${material.clearcoat}`} label="Verniz" value={material.clearcoat ?? 0} min={0} max={1} step={0.05} onChange={(clearcoat) => updateNode({ material: { ...material, clearcoat } })} />
                <NumericField key={`glass-${material.transmission}`} label="Transmissão" value={material.transmission ?? 0} min={0} max={1} step={0.05} onChange={(transmission) => updateNode({ material: { ...material, transmission } })} /></div>
              <NumericField key={`opacity-${material.opacity}`} label="Opacidade" value={material.opacity ?? 1} min={0} max={1} step={0.05} onChange={(opacity) => updateNode({ material: { ...material, opacity, transparent: opacity < 1 } })} />
              <label className="three-color">Cor de emissão<input type="color" value={material.emissive ?? '#000000'} onChange={(event) => updateNode({ material: { ...material, emissive: event.target.value } })} /></label>
              <NumericField key={`emissive-${material.emissiveIntensity}`} label="Intensidade de emissão" value={material.emissiveIntensity ?? 0} min={0} max={20} step={0.1} onChange={(emissiveIntensity) => updateNode({ material: { ...material, emissiveIntensity } })} />
              <details className="three-geometry-editor"><summary>Acabamentos avançados</summary>
                <div className="three-material"><NumericField key={`ior-${material.ior}`} label="Índice de refração" value={material.ior ?? 1.5} min={1} max={2.333} step={0.01} onChange={(ior) => updateNode({ material: { ...material, ior } })} />
                  <NumericField key={`thick-${material.thickness}`} label="Espessura (vidro)" value={material.thickness ?? 0} min={0} max={10} step={0.05} onChange={(thickness) => updateNode({ material: { ...material, thickness } })} /></div>
                <div className="three-material"><NumericField key={`sheen-${material.sheen}`} label="Brilho têxtil" value={material.sheen ?? 0} min={0} max={1} step={0.05} onChange={(sheen) => updateNode({ material: { ...material, sheen } })} />
                  <NumericField key={`irid-${material.iridescence}`} label="Iridescência" value={material.iridescence ?? 0} min={0} max={1} step={0.05} onChange={(iridescence) => updateNode({ material: { ...material, iridescence } })} /></div>
                <label className="three-check"><input type="checkbox" checked={material.flatShading ?? false} onChange={(event) => updateNode({ material: { ...material, flatShading: event.target.checked } })} /> Sombreamento facetado (low poly)</label>
              </details>
            </>}
            <details className="three-geometry-editor"><summary>Contatos intencionais</summary><p>Selecione somente objetos com encaixe intencional. Outros pares continuam sendo verificados.</p>
              <label className="three-field">Encaixes intencionais com<select multiple size={4} value={selected.overlapWith} onChange={(event) => updateNode({ overlapWith: Array.from(event.target.selectedOptions, (option) => option.value) })}>
                {doc.nodes.filter((node) => node.id !== selected.id && hasSurface(node.kind)).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label></details>
            <h3>Animação</h3>
            <SelectField label="Movimento" value={selected.animation.kind} options={Object.entries(animationLabels) as [SceneAnimation['kind'], string][]} onChange={(kind) => updateAnimation({ kind })} />
            {selected.animation.kind !== 'none' && <>
              <SelectField label="Início" value={selected.animation.start ?? 'auto'} options={[['auto', 'Automático em loop'], ['trigger', 'Ao interagir (modo jogo)']]} onChange={(start) => updateAnimation({ start })} />
              {selected.animation.kind !== 'keyframes' && <SelectField label="Eixo do movimento" value={selected.animation.axis} options={[['x', 'X'], ['y', 'Y'], ['z', 'Z']]} onChange={(axis) => updateAnimation({ axis })} />}
              <div className="three-material"><NumericField key={`period-${selected.animation.duration}`} label="Período (s)" value={selected.animation.duration} min={0.2} max={120} onChange={(duration) => updateAnimation({ duration })} />
                <NumericField key={`phase-${selected.animation.phase}`} label="Fase (°)" value={selected.animation.phase} min={0} max={360} step={1} onChange={(phase) => updateAnimation({ phase })} /></div>
              {!['spin', 'keyframes'].includes(selected.animation.kind) && <NumericField key={`amplitude-${selected.animation.amplitude}`} label={selected.animation.kind === 'swing' ? 'Amplitude (°)' : selected.animation.kind === 'pulse' ? 'Amplitude (fração 0–0,95)' : 'Amplitude / raio (m)'} value={selected.animation.amplitude} min={0} max={100} onChange={(amplitude) => updateAnimation({ amplitude })} />}
              {selected.animation.kind === 'keyframes' && <>
                <SelectField label="Suavização" value={selected.animation.easing ?? 'smooth'} options={[['smooth', 'Suave'], ['linear', 'Linear'], ['step', 'Degrau']]} onChange={(easing) => updateAnimation({ easing })} />
                <KeyframeEditor key={`${selected.id}-${history.past.length}-${history.future.length}`} animation={selected.animation} onApply={(keys) => updateAnimation({ keys }) ?? false} />
              </>}
            </>}
            <h3>Interação (modo jogo)</h3>
            <SelectField label="Gatilho" value={selected.interaction?.trigger ?? 'none'} options={[['none', 'Sem interação'], ['click', 'Mirar e pressionar E'], ['proximity', 'Ao se aproximar'], ['key', 'Tecla global']]}
              onChange={(trigger) => updateInteraction(trigger === 'none' ? null : { trigger })} />
            {selected.interaction && <>
              <SelectField label="Ação" value={selected.interaction.action} options={interactionActions.map((action) => [action, actionOptionLabels[action]])}
                onChange={(next) => updateInteraction({ action: next })} />
              {!['collect', 'heal', 'powerup'].includes(selected.interaction.action) && <label className="three-field">Alvo<select value={selected.interaction.targetId ?? ''} onChange={(event) => updateInteraction({ targetId: event.target.value || null })}>
                <option value="">Este objeto</option>{doc.nodes.filter((node) => node.id !== selected.id).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>}
              <div className="three-material">
                {selected.interaction.trigger === 'key' ? <TextField key={`key-${selected.interaction.key}`} label="Tecla" max={1} value={selected.interaction.key} onChange={(key) => updateInteraction({ key: key.toLowerCase() })} />
                  : <NumericField key={`radius-${selected.interaction.radius}`} label="Alcance (m)" value={selected.interaction.radius} min={0.5} max={50} onChange={(radius) => updateInteraction({ radius })} />}
              </div>
              <label className="three-field">{selected.interaction.action === 'dialogue' ? 'Falas (separe com |)' : 'Mensagem'}<textarea key={`msg-${selected.interaction.message}`} rows={selected.interaction.action === 'dialogue' ? 4 : 2} defaultValue={selected.interaction.message} maxLength={MAX_MESSAGE} onBlur={(event) => { if (event.target.value !== selected.interaction!.message) updateInteraction({ message: event.target.value }) }} /></label>
              {selected.interaction.action === 'collect' && <label className="three-field">Item no inventário<input key={`item-${selected.interaction.item ?? ''}`} defaultValue={selected.interaction.item ?? ''} maxLength={40} placeholder="ex.: Chave dourada" onBlur={(event) => { if (event.target.value.trim() !== (selected.interaction!.item ?? '')) updateInteraction({ item: event.target.value.trim() }) }} /></label>}
              <label className="three-field">Exige item<input key={`req-${selected.interaction.requires ?? ''}`} defaultValue={selected.interaction.requires ?? ''} maxLength={40} placeholder="vazio = livre" onBlur={(event) => { if (event.target.value.trim() !== (selected.interaction!.requires ?? '')) updateInteraction({ requires: event.target.value.trim() }) }} /></label>
              {selected.interaction.action === 'powerup' && <SelectField label="Poder" value={selected.interaction.power ?? 'speed'} options={powerKinds.map((power) => [power, powerLabels[power]])} onChange={(power) => updateInteraction({ power })} />}
              {['heal', 'powerup'].includes(selected.interaction.action) && <NumericField key={`amount-${selected.interaction.amount}`} label={selected.interaction.action === 'heal' ? 'Vida restaurada' : 'Duração (s)'} value={selected.interaction.amount ?? (selected.interaction.action === 'heal' ? 25 : 10)} min={0} max={1000} step={1} onChange={(amount) => updateInteraction({ amount })} />}
            </>}
            {selected.asset && isCharacterType(selected.asset.type) && (() => {
              const character = selected.asset.character ?? defaultCharacterSpec(), set = (patch: Partial<CharacterSpec>) => rebuildAsset({ character: { ...character, ...patch } })
              return <>
                <h3>Personagem</h3>
                <div className="three-material"><SelectField label="Idade" value={character.age} options={characterAges.map((age) => [age, ageLabels[age]])} onChange={(age) => set({ age })} />
                  <SelectField label="Porte" value={character.build} options={characterBuilds.map((build) => [build, buildLabels[build]])} onChange={(build) => set({ build })} /></div>
                <div className="three-material"><SelectField label="Estilo" value={character.style} options={characterStyles.map((style) => [style, styleLabels[style]])} onChange={(style) => set({ style })} />
                  <NumericField key={`cheight-${character.height}`} label="Altura (×)" value={character.height} min={0.85} max={1.15} step={0.01} onChange={(height) => set({ height })} /></div>
                <div className="three-material"><SelectField label="Cabelo" value={character.hairStyle} options={hairStyles.map((hair) => [hair, hairLabels[hair]])} onChange={(hairStyle) => set({ hairStyle })} />
                  <SelectField label="Barba" value={character.beard} options={beardStyles.map((beard) => [beard, beardLabels[beard]])} onChange={(beard) => set({ beard })} /></div>
                <div className="three-material"><label className="three-color">Pele<input type="color" value={character.skin ?? '#d9a882'} onChange={(event) => set({ skin: event.target.value })} /></label>
                  <label className="three-color">Cor do cabelo<input type="color" value={character.hair ?? '#4a3222'} onChange={(event) => set({ hair: event.target.value })} /></label></div>
                <div className="three-material"><NumericField key={`cseed-${selected.asset.seed}`} label="Semente" value={selected.asset.seed} min={0} max={9999} step={1} onChange={(seed) => rebuildAsset({ seed: Math.round(seed) })} />
                  <button type="button" onClick={() => rebuildAsset({ character: undefined })} disabled={!selected.asset.character}>Arquétipo padrão</button></div>
              </>
            })()}
            <h3>Comportamento (modo jogo)</h3>
            <SelectField label="Função" value={selected.behavior?.type ?? 'none'} options={[['none', 'Sem comportamento'], ...behaviorTypes.map((type): [string, string] => [type, behaviorLabels[type]])]}
              onChange={(type) => updateBehavior(type === 'none' ? null : { type: type as SceneBehavior['type'] })} />
            {selected.behavior && <>
              <div className="three-material"><NumericField key={`bspeed-${selected.behavior.speed}`} label="Velocidade (m/s)" value={selected.behavior.speed} min={0} max={12} step={0.1} onChange={(speed) => updateBehavior({ speed })} />
                <NumericField key={`brange-${selected.behavior.range}`} label={selected.behavior.type === 'launcher' ? 'Altura do lançamento (m)' : 'Alcance (m)'} value={selected.behavior.range} min={0.5} max={80} step={0.5} onChange={(range) => updateBehavior({ range })} /></div>
              {['enemy', 'hazard'].includes(selected.behavior.type) && <NumericField key={`bdmg-${selected.behavior.damage}`} label="Dano" value={selected.behavior.damage} min={0} max={1000} step={1} onChange={(damage) => updateBehavior({ damage })} />}
              {selected.behavior.type === 'enemy' && <>
                <div className="three-material"><NumericField key={`bhp-${selected.behavior.health}`} label="Resistência (golpes)" value={selected.behavior.health ?? 1} min={1} max={100} step={1} onChange={(health) => updateBehavior({ health: Math.round(health) })} />
                  <NumericField key={`bdelay-${selected.behavior.delay}`} label="Aparece após (s)" value={selected.behavior.delay ?? 0} min={0} max={3600} step={1} onChange={(delay) => updateBehavior({ delay })} /></div>
                <SelectField label="Ataque" value={selected.behavior.attack ?? 'touch'} options={attackStyles.map((attack) => [attack, attackLabels[attack]])} onChange={(attack) => updateBehavior({ attack })} />
                <label className="three-check"><input type="checkbox" checked={selected.behavior.flying ?? false} onChange={(event) => updateBehavior({ flying: event.target.checked })} /> Voa sobre o terreno</label>
              </>}
              {selected.behavior.type === 'npc' && <>
                <SelectField label="Reação" value={selected.behavior.reaction ?? 'greet'} options={npcReactions.map((reaction) => [reaction, reactionLabels[reaction]])} onChange={(reaction) => updateBehavior({ reaction })} />
                <RoutineEditor steps={selected.behavior.routine ?? []} places={doc.nodes.filter((node) => node.id !== selected.id && !node.parentId)} onChange={(routine) => {
                  const { routine: _old, ...rest } = selected.behavior!
                  updateNode({ behavior: routine.length ? { ...rest, routine } : rest })
                }} />
              </>}
            </>}
            <h3>Partículas</h3>
            <SelectField label="Emissor" value={selected.emitter?.preset ?? 'none'} options={[['none', 'Sem partículas'], ...emitterPresets.map((preset): [string, string] => [preset, emitterLabels[preset]])]}
              onChange={(preset) => { if (preset === 'none') { const { emitter: _removed, ...rest } = selected; commit({ ...doc, nodes: doc.nodes.map((node) => node.id === selected.id ? rest : node) }) } else updateNode({ emitter: { rate: 1, spread: 0.3, ...selected.emitter, preset: preset as SceneEmitter['preset'] } }) }} />
            {selected.emitter && <div className="three-material"><NumericField key={`erate-${selected.emitter.rate}`} label="Intensidade" value={selected.emitter.rate} min={0.1} max={4} step={0.1} onChange={(rate) => updateNode({ emitter: { ...selected.emitter!, rate } })} />
              <NumericField key={`espread-${selected.emitter.spread}`} label="Raio (m)" value={selected.emitter.spread} min={0} max={20} step={0.1} onChange={(spread) => updateNode({ emitter: { ...selected.emitter!, spread } })} /></div>}
            <h3>Som posicional</h3>
            <SelectField label="Som" value={selected.sound?.preset ?? 'none'} options={[['none', 'Sem som'], ...soundPresets.map((preset): [string, string] => [preset, soundLabels[preset]])]}
              onChange={(preset) => updateSound(preset === 'none' ? null : { preset: preset as SceneSound['preset'] })} />
            {selected.sound && <div className="three-material"><NumericField key={`svol-${selected.sound.volume}`} label="Volume" value={selected.sound.volume} min={0} max={1} step={0.05} onChange={(volume) => updateSound({ volume })} />
              <NumericField key={`srad-${selected.sound.radius}`} label="Alcance (m)" value={selected.sound.radius} min={1} max={200} step={1} onChange={(radius) => updateSound({ radius })} /></div>}
            <div className="three-object-actions"><button type="button" onClick={duplicate}>Duplicar{selected.kind === 'group' ? ' grupo' : ''}</button>
              <button type="button" className="three-button--danger" onClick={remove}>Excluir{selected.kind === 'group' ? ' grupo' : ''}</button></div>
            {selected.kind === 'group' && <p className="three-hint">Duplicar e excluir incluem todos os descendentes.</p>}
          </div> : <div className="three-selection-tip"><span aria-hidden="true">◇</span><strong>Escolha um detalhe</strong><p>Clique em um objeto na cena ou na hierarquia para editar suas propriedades. Pressione ? para ver os atalhos.</p></div>}
          <details open={!selected} className="three-environment"><summary>Projeto e ambiente</summary>
            <TextField key={doc.name} label="Nome do projeto" value={doc.name} onChange={(name) => commit({ ...doc, name })} />
            <NumericField key={`timeline-${doc.timeline.duration}`} label="Duração da timeline (s)" value={doc.timeline.duration} min={1} max={120} onChange={(duration) => { if (commit({ ...doc, timeline: { duration } })) seek(0) }} />
            <SelectField label="Céu e iluminação" value={env.sky ?? 'studio'} options={skyPresets.map((sky) => [sky, skyLabels[sky]])}
              onChange={(sky) => updateEnvironment({ sky, ...(sky === 'sunset' ? { sunElevation: 5 } : sky === 'day' || sky === 'overcast' ? { sunElevation: Math.max(25, env.sunElevation ?? 38) } : {}) })} />
            {(env.sky ?? 'studio') === 'studio' && <label className="three-color">Cor de fundo<input type="color" value={env.background} onChange={(event) => updateEnvironment({ background: event.target.value })} /></label>}
            <div className="three-material"><NumericField key={`elev-${env.sunElevation}`} label="Elevação do sol (°)" value={env.sunElevation ?? 38} min={-10} max={90} step={1} onChange={(sunElevation) => updateEnvironment({ sunElevation })} />
              <NumericField key={`azim-${env.sunAzimuth}`} label="Azimute do sol (°)" value={env.sunAzimuth ?? 35} min={0} max={360} step={1} onChange={(sunAzimuth) => updateEnvironment({ sunAzimuth })} /></div>
            <div className="three-material"><NumericField key={`Exposição-${env.exposure}`} label="Exposição" value={env.exposure} min={0.1} max={3} onChange={(exposure) => updateEnvironment({ exposure })} />
              <NumericField key={`Intensidade da luz-${env.lightIntensity}`} label="Intensidade da luz" value={env.lightIntensity} min={0} max={5} onChange={(lightIntensity) => updateEnvironment({ lightIntensity })} /></div>
            <div className="three-material"><NumericField key={`fog-${env.fog}`} label="Neblina" value={env.fog ?? 0} min={0} max={0.2} step={0.002} onChange={(fog) => updateEnvironment({ fog })} />
              <NumericField key={`bloom-${env.bloom}`} label="Brilho (bloom)" value={env.bloom ?? 0} min={0} max={3} step={0.1} onChange={(bloom) => updateEnvironment({ bloom })} /></div>
            <SelectField label="Mapeamento tonal" value={env.toneMapping ?? 'aces'} options={[['aces', 'ACES Filmic'], ['agx', 'AgX'], ['neutral', 'Neutro (Khronos)']]} onChange={(toneMapping) => updateEnvironment({ toneMapping })} />
            <label className="three-check"><input type="checkbox" checked={env.shadows ?? true} onChange={(event) => updateEnvironment({ shadows: event.target.checked })} /> Sombras suaves</label>
            <label className="three-check"><input type="checkbox" checked={env.reflections ?? true} onChange={(event) => updateEnvironment({ reflections: event.target.checked })} /> Reflexões do ambiente</label>
            <label className="three-check"><input type="checkbox" checked={env.grid} onChange={(event) => updateEnvironment({ grid: event.target.checked })} /> Grade de referência</label>
            <label className="three-check"><input type="checkbox" checked={env.wireframe} onChange={(event) => updateEnvironment({ wireframe: event.target.checked })} /> Wireframe</label>
            <div className="three-material"><SelectField label="Clima" value={env.weather ?? 'none'} options={weatherKinds.map((kind) => [kind, weatherLabels[kind]])} onChange={(weather) => updateEnvironment({ weather })} />
              <SelectField label="Gradação de cor" value={env.grade ?? 'none'} options={gradePresets.map((grade) => [grade, gradeLabels[grade]])} onChange={(grade) => updateEnvironment({ grade })} /></div>
            <h3>Mundo em movimento</h3>
            <NumericField key={`wind-${motion.wind}`} label="Vento (0 calmo · 2 tempestade)" value={motion.wind} min={0} max={2} step={0.1} onChange={(wind) => updateEnvironment({ motion: { ...motion, wind } })} />
            <div className="three-material"><SelectField label="Grama" value={motion.grass} options={grassDensities.map((grass) => [grass, grassLabels[grass]])} onChange={(grass) => updateEnvironment({ motion: { ...motion, grass } })} />
              <SelectField label="Fauna" value={motion.fauna} options={faunaDensities.map((fauna) => [fauna, faunaLabels[fauna]])} onChange={(fauna) => updateEnvironment({ motion: { ...motion, fauna } })} /></div>
            <label className="three-check"><input type="checkbox" checked={!!env.dayCycle?.enabled} onChange={(event) => updateEnvironment({ dayCycle: { duration: 600, start: 9, ...env.dayCycle, enabled: event.target.checked } })} /> Ciclo dia/noite no jogo</label>
            {env.dayCycle?.enabled && <div className="three-material"><NumericField key={`dlen-${env.dayCycle.duration}`} label="Duração do dia (s)" value={env.dayCycle.duration} min={60} max={7200} step={30} onChange={(duration) => updateEnvironment({ dayCycle: { ...env.dayCycle!, duration } })} />
              <NumericField key={`dstart-${env.dayCycle.start}`} label="Hora inicial" value={env.dayCycle.start} min={0} max={24} step={0.5} onChange={(start) => updateEnvironment({ dayCycle: { ...env.dayCycle!, start } })} /></div>}
            <label className="three-field">Premissa (cartão de título)<textarea key={`premise-${env.premise ?? ''}`} rows={2} maxLength={MAX_PREMISE} defaultValue={env.premise ?? ''} placeholder="Uma frase sobre a história da fase"
              onBlur={(event) => { const premise = event.target.value.trim(); if (premise === (env.premise ?? '')) return; if (premise) updateEnvironment({ premise }); else { const { premise: _removed, ...rest } = env; commit({ ...doc, environment: rest }) } }} /></label>
            <h3>Som</h3>
            <div className="three-material"><SelectField label="Ambiência" value={audio.ambience} options={ambiencePresets.map((preset) => [preset, ambienceLabels[preset]])} onChange={(ambience) => updateEnvironment({ audio: { ...audio, ambience } })} />
              <SelectField label="Música" value={audio.music} options={musicPresets.map((preset) => [preset, musicLabels[preset]])} onChange={(music) => updateEnvironment({ audio: { ...audio, music } })} /></div>
            <NumericField key={`vol-${audio.volume}`} label="Volume geral" value={audio.volume} min={0} max={1} step={0.05} onChange={(volume) => updateEnvironment({ audio: { ...audio, volume } })} />
            <p className="three-hint">Sons sintetizados localmente no modo jogo; M silencia.</p>
            <h3>Objetivo</h3>
            <div className="three-material"><SelectField label="Tipo" value={env.objective?.type ?? 'auto'} options={[['auto', 'Automático pela cena'], ...objectiveTypes.map((type): [string, string] => [type, objectiveLabels[type]])]}
              onChange={(type) => { if (type === 'auto') { const { objective: _removed, ...rest } = env; commit({ ...doc, environment: rest }) } else updateEnvironment({ objective: { title: '', timeLimit: 0, ...env.objective, type: type as NonNullable<typeof env.objective>['type'] } }) }} />
              {env.objective && <NumericField key={`limit-${env.objective.timeLimit}`} label="Tempo limite (s, 0 = livre)" value={env.objective.timeLimit} min={0} max={3600} step={5} onChange={(timeLimit) => updateEnvironment({ objective: { ...env.objective!, timeLimit } })} />}</div>
            {env.objective && <label className="three-field">Título do objetivo<input key={`otitle-${env.objective.title}`} defaultValue={env.objective.title} maxLength={160} onBlur={(event) => { if (event.target.value !== env.objective!.title) updateEnvironment({ objective: { ...env.objective!, title: event.target.value } }) }} /></label>}
            <h3>Jogador</h3>
            <p className="three-hint">Início: {player.spawn ? player.spawn.map((value) => value.toFixed(1)).join(' · ') : 'automático, diante da cena'}{player.spawn ? ` · direção ${player.yaw.toFixed(0)}°` : ''}</p>
            <div className="three-object-actions"><button type="button" onClick={() => { const camera = viewport.current?.cameraSpawn(); if (camera) updatePlayer(camera) }}>Início na câmera atual</button>
              <button type="button" disabled={!player.spawn} onClick={() => updatePlayer({ spawn: null, yaw: 0 })}>Início automático</button></div>
            <div className="three-material"><NumericField key={`speed-${player.speed}`} label="Velocidade (m/s)" value={player.speed} min={1} max={20} step={0.5} onChange={(speed) => updatePlayer({ speed })} />
              <NumericField key={`jump-${player.jumpHeight}`} label="Altura do pulo (m)" value={player.jumpHeight} min={0} max={5} step={0.1} onChange={(jumpHeight) => updatePlayer({ jumpHeight })} /></div>
            <SelectField label="Modo inicial" value={player.mode} options={[['walk', 'Caminhada com gravidade'], ['fly', 'Voo livre']]} onChange={(mode) => updatePlayer({ mode })} />
            <div className="three-material"><SelectField label="Arma" value={player.weapon ?? 'none'} options={weaponKinds.map((weapon) => [weapon, weaponLabels[weapon]])} onChange={(weapon) => updatePlayer({ weapon })} />
              <SelectField label="Avatar (3ª pessoa)" value={player.avatar ?? 'explorer'} options={avatarKinds.map((avatar) => [avatar, avatarLabels[avatar]])} onChange={(avatar) => updatePlayer({ avatar })} /></div>
            <div className="three-material"><SelectField label="Câmera inicial" value={player.camera ?? 'first'} options={[['first', 'Primeira pessoa'], ['third', 'Terceira pessoa']]} onChange={(camera) => updatePlayer({ camera })} />
              <NumericField key={`hp-${player.health}`} label="Vida" value={player.health ?? 100} min={1} max={1000} step={5} onChange={(health) => updatePlayer({ health })} /></div>
            <label className="three-check"><input type="checkbox" checked={player.allowFly !== false} onChange={(event) => updatePlayer({ allowFly: event.target.checked })} /> Permitir voo (F)</label>
          </details>
          <div className="three-roadmap"><span className="workspace-eyebrow">PRONTO PARA JOGAR</span><p>Pressione P ou ▶ Jogar para explorar em primeira pessoa com colisão, interações e coletáveis. Colisões e inspeções usam aproximações declaradas; não há física de corpos rígidos.</p></div>
        </div>
      </aside>
    </div>
    </fieldset>
    <div className="three-playback" role="group" aria-label="Reprodução da cena" hidden={!studioOpen || playMode}>
      <button type="button" disabled={busy || playMode} aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? 'Pausar' : 'Reproduzir'}</button>
      <button type="button" disabled={playMode} onClick={() => { setPlaying(false); seek(0) }}>Reiniciar</button>
      <input type="range" aria-label="Tempo da cena" disabled={playMode} min={0} max={doc.timeline.duration} step={0.01} value={Math.min(time, doc.timeline.duration)}
        onChange={(event) => { setPlaying(false); seek(Number(event.target.value)) }} />
      <output aria-label="Tempo atual">{time.toFixed(1)} / {doc.timeline.duration} s</output>
      <span>{doc.nodes.filter((node) => node.animation.kind !== 'none').length} animações · {doc.nodes.filter((node) => node.interaction).length} interações</span>
    </div>
    <footer className="three-statusbar" hidden={!studioOpen || playMode}><span><span className="three-dot" /> Three.js · local</span><span>{doc.nodes.filter((node) => hasSurface(node.kind)).length} malhas · {doc.nodes.filter((node) => node.kind === 'light').length} luzes</span><span role="status">{saveStatus}</span><span>Projeto JSON 1.3</span></footer>
  </div>
}
