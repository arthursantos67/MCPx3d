import { useEffect, useState } from 'react'
import type { CadProgramSpec } from '../../../../packages/domain/ts/src/cad-program.ts'
import type { CadAssemblySpec } from '../../../../packages/domain/ts/src/cad-assembly.ts'
import type { CadAssemblyOutcome, CadAssemblyProgress } from '../../../../packages/agent/src/generate-cad-assembly.ts'
import { isCadClarification, type CadDesignOutcome } from '../../../../packages/agent/src/classify-cad-design.ts'
import type { AgentProvider } from '../ai/types.ts'
import * as api from '../api/cad.ts'
import { CadAgentController } from './CadAgentController.ts'
import CadProgramPanel from './CadProgramPanel.tsx'
import CadAssemblyPanel from './CadAssemblyPanel.tsx'
import CadMeshView from './CadMeshView.tsx'
import { initialCadProgram } from './cadProgramDraft.ts'
import type { CadProgressStatus } from './CadAssemblyProgressView.tsx'
import { useCadPreview } from './useCadPreview.ts'
import './CadWorkspace.css'
import { ProviderRequestError } from '../../../../packages/agent/src/provider.ts'
import type { CadDraftSnapshot } from '../../../../packages/domain/ts/src/cad-draft.ts'
import { readCadDraft, storeCadDraft, clearCadDraft } from './cadDraftStorage.ts'
import CadDraftPanel from './CadDraftPanel.tsx'

interface Props {
  readonly provider: AgentProvider
  readonly active: boolean
  readonly ready: boolean
  readonly agentDetail?: string
  readonly onOpenProviderSettings: () => void
  readonly onBusyChange: (busy: boolean) => void
}

export default function CadWorkspace({ provider, active, ready, agentDetail, onOpenProviderSettings, onBusyChange }: Props) {
  const [agent] = useState(() => new CadAgentController(provider, api))
  const [editor, setEditor] = useState<'program' | 'assembly'>(() => localStorage.getItem('modeler:cad-editor') === 'assembly' ? 'assembly' : 'program')
  const [program, setProgram] = useState<CadProgramSpec>(initialCadProgram)
  const [programProject, setProgramProject] = useState<api.CadProgramProject | null>(null)
  const [assembly, setAssembly] = useState<CadAssemblySpec | null>(null)
  const [assemblyProject, setAssemblyProject] = useState<api.CadAssemblyProject | null>(null)
  const [assumptions, setAssumptions] = useState<readonly string[]>([])
  const [progress, setProgress] = useState<CadAssemblyProgress | null>(null)
  const [progressStatus, setProgressStatus] = useState<CadProgressStatus | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [recovered, setRecovered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<CadDraftSnapshot | null>(readCadDraft)
  const [draftPersistenceFailed, setDraftPersistenceFailed] = useState(false)
  const [requireMechanics, setRequireMechanics] = useState(() => localStorage.getItem('modeler:cad-mechanics') !== 'concept')
  const currentProject = editor === 'program' ? programProject : assemblyProject
  const currentSpec = draft?.spec ?? (editor === 'program' ? program : assembly)
  const dirty = !currentProject || JSON.stringify(currentProject.spec) !== JSON.stringify(currentSpec)
  const exportableDraft = draft ?? (dirty && currentSpec &&
    (currentSpec.schemaVersion === '4.0' || JSON.stringify(currentSpec) !== JSON.stringify(initialCadProgram))
    ? { spec: currentSpec, request: '' } : null)
  const preview = useCadPreview(currentSpec, active && recovered && !busy, !!draft || dirty)
  const discardDraft = () => { setDraft(null); clearCadDraft(); setDraftPersistenceFailed(false) }

  useEffect(() => () => agent.cancelGeneration(), [agent])
  useEffect(() => { agent.setProvider(provider) }, [agent, provider])
  useEffect(() => { agent.setDraftListener((snapshot) => { setDraft(snapshot); setDraftPersistenceFailed(!storeCadDraft(snapshot)) }) }, [agent])
  useEffect(() => { localStorage.setItem('modeler:cad-editor', editor) }, [editor])
  useEffect(() => {
    if (!active || recovered) return
    let cancelled = false
    void Promise.allSettled([api.resumeCadProgram(), api.resumeCadAssembly()]).then(([programResult, assemblyResult]) => {
      if (cancelled) return
      const savedProgram = programResult.status === 'fulfilled' ? programResult.value : null
      const savedAssembly = assemblyResult.status === 'fulfilled' ? assemblyResult.value : null
      if (savedProgram) { setProgram(savedProgram.spec); setProgramProject(savedProgram) }
      if (savedAssembly) { setAssembly(savedAssembly.spec); setAssemblyProject(savedAssembly) }
      const errors = [programResult, assemblyResult].filter((result) => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason))
      if (errors.length) setRecoveryError(errors.join(' '))
      setRecovered(true)
    })
    return () => { cancelled = true }
  }, [active, recovered])

  const clearProgress = () => { agent.clearCompletedGeneration(); setProgress(null); setProgressStatus(null); setUpdatedAt(null) }
  const reportProgress = (value: CadAssemblyProgress) => { setProgress(value); setUpdatedAt(Date.now()) }
  const reportBusy = (value: boolean) => { setBusy(value); onBusyChange(value) }
  const run = async <T extends CadAssemblyOutcome | CadDesignOutcome,>(phase: CadAssemblyProgress['phase'], action: () => Promise<T>): Promise<T> => {
    reportProgress({ phase, components: [], completed: 0 }); setProgressStatus('running')
    try {
      const outcome = await action()
      setProgressStatus(isCadClarification(outcome) ? 'paused' : 'complete')
      return outcome
    } catch (error) {
      setProgressStatus(error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : error instanceof ProviderRequestError || /status 429/.test(String(error)) ? 'paused' : 'failed')
      throw error
    }
  }
  const planDesign = (request: string, previous?: CadProgramSpec) => run('classifying', () => agent.planCadDesign(request, previous, reportProgress, requireMechanics))
  const planAssembly = (request: string, previous?: CadAssemblySpec) => run('planning', () => agent.planCadAssembly(request, previous, reportProgress, requireMechanics))
  const correctMechanics = (spec: CadAssemblySpec) => run('planning', () => agent.planCadAssembly(
    'Corrija a montagem para funcionar fisicamente. Preserve a finalidade, os componentes e as roscas. Declare e verifique fixação à base, alinhamento de guias e mancais, retenção axial do fuso, antirrotação e retenção da porca e transmissão coerente com o passo. Corrija offsets locais/globais duplicados e furos desalinhados; não basta remover colisões. Reutilize peças não afetadas. Liste fixadores necessários e premissas de montagem.', spec, reportProgress, true))
  const repairAssembly = (spec: CadAssemblySpec) => run('checking-assembly', () => agent.repairCadAssembly(spec, reportProgress))
  const receiveAssembly = async (outcome: Extract<CadAssemblyOutcome, { kind: 'create' }>) => {
    const saved = await api.saveCadAssembly(outcome.spec)
    agent.clearCompletedGeneration()
    discardDraft()
    setAssemblyProject(saved); setAssembly(saved.spec); setAssumptions(outcome.assumptions); setEditor('assembly')
  }
  const cancel = () => { agent.cancelGeneration(); setProgressStatus('cancelled') }

  return <div className="cad-workspace" hidden={!active}>
    <aside className="cad-workspace__sidebar">
      <div className="cad-workspace__tabs" role="group" aria-label="Modo de construção CAD">
        <button type="button" aria-pressed={editor === 'program'} disabled={busy} onClick={() => setEditor('program')}>Projeto livre</button>
        <button type="button" aria-pressed={editor === 'assembly'} disabled={busy} onClick={() => setEditor('assembly')}>Conjunto composto</button>
      </div>
      <label className="cad-program__field"><span><input type="checkbox" checked={requireMechanics} disabled={busy}
        onChange={(event) => { setRequireMechanics(event.target.checked); localStorage.setItem('modeler:cad-mechanics', event.target.checked ? 'mechanical' : 'concept'); clearProgress() }} /> Verificar vínculos mecânicos ao criar</span></label>
      {!ready && <p className="cad-workspace__notice" role="status">{agentDetail || 'A IA está sendo preparada. Você já pode editar a geometria manualmente.'}</p>}
      {recoveryError && <p className="cad-workspace__notice" role="alert">{recoveryError}</p>}
      {!recovered && <p className="cad-workspace__notice" role="status">Recuperando seus projetos…</p>}
      {exportableDraft && <CadDraftPanel draft={exportableDraft} busy={busy} persistenceFailed={draftPersistenceFailed} />}
      <div hidden={!recovered || editor !== 'program'}><CadProgramPanel spec={program} project={programProject} onChange={(spec) => { discardDraft(); setProgram(spec) }} onSaved={(saved) => { setProgramProject(saved); agent.clearCompletedGeneration(); discardDraft() }}
        onBusyChange={reportBusy}
        onNew={() => { api.clearActiveCadProgram(); setProgramProject(null); setProgram(initialCadProgram); clearProgress(); discardDraft() }}
        planDesign={planDesign} onAssemblyGenerated={receiveAssembly} agentReady={ready} onOpenProviderSettings={onOpenProviderSettings}
        cadProgress={progress} cadProgressStatus={progressStatus} cadProgressUpdatedAt={updatedAt} onRequestChanged={clearProgress} cancelGeneration={cancel} /></div>
      <div hidden={!recovered || editor !== 'assembly'}><CadAssemblyPanel spec={assembly} project={assemblyProject} onChange={(spec) => {
        setAssembly(spec)
        if (draft?.spec.partId === spec.partId) {
          const next = { ...draft, spec }; setDraft(next); setDraftPersistenceFailed(!storeCadDraft(next))
        } else discardDraft()
      }} onSaved={(saved) => { setAssemblyProject(saved); agent.clearCompletedGeneration(); discardDraft() }}
        onBusyChange={reportBusy}
        onNew={() => { api.clearActiveCadAssembly(); setAssemblyProject(null); setAssembly(null); setAssumptions([]); clearProgress(); discardDraft() }}
        plan={planAssembly} repair={repairAssembly} correctMechanics={correctMechanics} requireMechanics={requireMechanics}
        agentReady={ready} onOpenProviderSettings={onOpenProviderSettings} initialAssumptions={assumptions}
        cadProgress={progress} cadProgressStatus={progressStatus} cadProgressUpdatedAt={updatedAt} onRequestChanged={clearProgress} cancelGeneration={cancel} /></div>
    </aside>
    <section className="cad-workspace__viewer" aria-label="Visualização CAD">
      <div className="cad-workspace__viewer-heading"><div><span className="workspace-eyebrow">GEOMETRIA CAD · MILÍMETROS</span>
        <h2>{currentSpec?.partId ?? 'Seu próximo projeto começa aqui'}</h2></div>
        <span className="workspace-badge">{currentSpec?.schemaVersion === '4.0' ? `${currentSpec.components.length} componentes` : `${currentSpec?.steps.length ?? 0} operações`}</span>
      </div>
      <div className="cad-workspace__canvas">
        <CadMeshView mesh={preview.mesh} />
        {!preview.mesh && <div className="cad-workspace__empty"><span className="workspace-eyebrow">DO PEDIDO À GEOMETRIA</span>
          <h2>Descreva. Construa. Exporte.</h2><p>O agente constrói cada componente, verifica os sólidos e prepara os arquivos STEP e STL.</p></div>}
      </div>
      {preview.error && <p className="cad-workspace__notice" role="alert">{preview.error}{preview.stale ? ' A prévia mantém a última geometria válida.' : ''}</p>}
      {preview.mesh?.draftReport && <p className="cad-workspace__notice" role="status">Prévia do rascunho · montagem não aprovada.{preview.mesh.draftReport.partial ? ' Algumas etapas ou peças foram omitidas; consulte o relatório da exportação.' : ''}</p>}
      {preview.pending && <p className="cad-workspace__notice" role="status">Atualizando a geometria da prévia…</p>}
      <footer className="cad-workspace__footer"><span>{dirty || draft ? 'Rascunho · geometria disponível para exportação' : currentProject ? `Revisão ${currentProject.revision} salva` : 'Rascunho'}</span>
        <span>{preview.mesh ? preview.mesh.boundsMm.map((value) => value.toFixed(1)).join(' × ') + ' mm' : 'STEP + STL'}</span>
      </footer>
    </section>
  </div>
}
