import { useEffect, useRef, useState } from 'react'

import './WorkspaceShell.css'

import ChatPanel from '../chat/ChatPanel.tsx'
import { useChatController } from '../chat/useChatController.ts'
import ProviderSettings from '../settings/ProviderSettings.tsx'
import X3DPreviewFrame from '../viewer/X3DPreviewFrame.tsx'
import { clearActiveCadAssembly, clearActiveCadProgram, getMcpHealth, meshCadProgram, meshCadAssembly, resumeCadProgram, resumeCadAssembly, type CadProgramMesh, type CadProgramProject, type CadAssemblyProject, type CadPlateInput, type McpHealth } from '../api/client.ts'
import type { CadProgramSpec } from '../../../../packages/domain/ts/src/cad-program.ts'
import type { CadAssemblySpec } from '../../../../packages/domain/ts/src/cad-assembly.ts'
import type { CadAssemblyProgress } from '../../../../packages/agent/src/generate-cad-assembly.ts'
import DownloadMenu from './DownloadMenu.tsx'
import CadPlatePanel from './CadPlatePanel.tsx'
import CadTopView from './CadTopView.tsx'
import CadProgramPanel from './CadProgramPanel.tsx'
import CadAssemblyPanel from './CadAssemblyPanel.tsx'
import CadAssemblyProgressView, { type CadProgressStatus } from './CadAssemblyProgressView.tsx'
import { initialCadProgram } from './cadProgramDraft.ts'
import CadMeshView from './CadMeshView.tsx'
import { initialCadPlate } from './cadPlateDraft.ts'
import RecipeMenu from './RecipeMenu.tsx'
import StatusBar from './StatusBar.tsx'

/**
 * Desktop modeling workspace shell (PRD §3.1, Issue #25): top bar, a
 * side-by-side chat + viewer main area, and a status bar. The chat panel
 * (#26/#27) and X3D preview iframe (#28) are wired here; the status bar
 * remains a placeholder (#32).
 *
 * `useChatController` is called once, here, rather than inside `ChatPanel`:
 * it owns the single `WebLLMProvider`/project session for the whole
 * workspace, and `X3DPreviewFrame` needs that same controller's
 * `previewUrl` -- a second instance would double-initialize WebLLM.
 *
 * The "AI Provider" button + `ProviderSettings` panel let a user without a
 * WebGPU-capable GPU switch to a BYOK provider; `onOpenProviderSettings` is
 * threaded down into the composer so the exact moment it reports local AI
 * as unavailable, it also offers a direct way to configure that alternative.
 */
function WorkspaceShell() {
  const { state, sendMessage, applyRecipe, planCadEdit, planCadCreate, planCadDesign, planCadAssembly, importManifest, cancelGeneration, canSend, retryProject, resetProject, renameProject, persistProjectName, setViewerStatus } = useChatController()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<'web3d' | 'cad'>('web3d')
  const [cadOpen, setCadOpen] = useState(false)
  const [cadDraft, setCadDraft] = useState<CadPlateInput>(initialCadPlate)
  const [cadEditor, setCadEditor] = useState<'program' | 'templates' | 'assembly'>('program')
  const [programSpec, setProgramSpec] = useState<CadProgramSpec>(initialCadProgram)
  const [programProject, setProgramProject] = useState<CadProgramProject | null>(null)
  const [programMesh, setProgramMesh] = useState<CadProgramMesh | null>(null)
  const [programError, setProgramError] = useState<string | null>(null)
  const [assemblySpec, setAssemblySpec] = useState<CadAssemblySpec | null>(null)
  const [assemblyProject, setAssemblyProject] = useState<CadAssemblyProject | null>(null)
  const [assemblyMesh, setAssemblyMesh] = useState<CadProgramMesh | null>(null)
  const [assemblyError, setAssemblyError] = useState<string | null>(null)
  const [assemblyAssumptions, setAssemblyAssumptions] = useState<readonly string[]>([])
  const [cadProgress, setCadProgress] = useState<CadAssemblyProgress | null>(null)
  const [cadProgressStatus, setCadProgressStatus] = useState<CadProgressStatus | null>(null)
  const [cadProgressUpdatedAt, setCadProgressUpdatedAt] = useState<number | null>(null)
  const [mcpHealth, setMcpHealth] = useState<McpHealth | null>(null)
  const [activePanel, setActivePanel] = useState<'chat' | 'viewer'>('chat')
  const [importError, setImportError] = useState<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void getMcpHealth()
      .then((health) => active && setMcpHealth(health))
      .catch(() => active && setMcpHealth({ reachable: false, detail: 'health check failed' }))
    return () => { active = false }
  }, [])

  useEffect(() => {
    void resumeCadProgram().then((saved) => {
      if (saved) { setProgramProject(saved); setProgramSpec(saved.spec) }
    }).catch((error: unknown) => setProgramError(error instanceof Error ? error.message : String(error)))
    void resumeCadAssembly().then((saved) => {
      if (saved) { setAssemblyProject(saved); setAssemblySpec(saved.spec) }
    }).catch((error: unknown) => setAssemblyError(error instanceof Error ? error.message : String(error)))
  }, [])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void meshCadProgram(programSpec).then((mesh) => {
        if (active) { setProgramMesh(mesh); setProgramError(null) }
      }).catch((error: unknown) => {
        if (active) { setProgramMesh(null); setProgramError(error instanceof Error ? error.message : String(error)) }
      })
    }, 400)
    return () => { active = false; window.clearTimeout(timer) }
  }, [programSpec])

  useEffect(() => {
    if (!assemblySpec) { setAssemblyMesh(null); return }
    let active = true
    const timer = window.setTimeout(() => {
      void meshCadAssembly(assemblySpec).then((mesh) => {
        if (active) { setAssemblyMesh(mesh); setAssemblyError(null) }
      }).catch((error: unknown) => {
        if (active) { setAssemblyMesh(null); setAssemblyError(error instanceof Error ? error.message : String(error)) }
      })
    }, 400)
    return () => { active = false; window.clearTimeout(timer) }
  }, [assemblySpec])

  const hasProjectContent = state.messages.length > 0 || (state.modelSpec?.revision ?? 0) > 0
  const clearCadProgress = () => { setCadProgress(null); setCadProgressStatus(null); setCadProgressUpdatedAt(null) }
  const reportCadProgress = (progress: CadAssemblyProgress) => {
    setCadProgress(progress)
    setCadProgressUpdatedAt(Date.now())
  }
  const trackCadFailure = (error: unknown) => {
    setCadProgressStatus(/status 429/.test(error instanceof Error ? error.message : String(error)) ? 'paused' : 'failed')
  }
  const cancelCadGeneration = () => { cancelGeneration(); setCadProgressStatus('failed') }
  const planCadAssemblyWithProgress = async (request: string, previous?: CadAssemblySpec) => {
    setCadProgress({ phase: 'planning', components: [], completed: 0 })
    setCadProgressStatus('running')
    setCadProgressUpdatedAt(Date.now())
    try {
      const result = await planCadAssembly(request, previous, reportCadProgress)
      if (result.kind === 'create') setCadProgressStatus('complete')
      else clearCadProgress()
      return result
    } catch (error) { trackCadFailure(error); throw error }
  }
  const planCadDesignWithProgress = async (request: string, previous?: CadProgramSpec) => {
    setCadProgress({ phase: 'classifying', components: [], completed: 0 })
    setCadProgressStatus('running')
    setCadProgressUpdatedAt(Date.now())
    try {
      const result = await planCadDesign(request, previous, reportCadProgress)
      if (result.mode === 'assembly' && result.outcome.kind === 'create') setCadProgressStatus('complete')
      else clearCadProgress()
      return result
    } catch (error) { trackCadFailure(error); throw error }
  }
  const requestReset = () => {
    if (!hasProjectContent || window.confirm('Reset this project? The model and conversation will be cleared.')) {
      resetProject()
    }
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    if (hasProjectContent && !window.confirm('Import this model? It will replace the current model and conversation.')) return
    if (file.size > 10_000_000) {
      setImportError('Manifest exceeds the 10 MB upload limit.')
      return
    }
    try {
      importManifest(await file.text())
      setImportError(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="workspace">
      <header className="workspace-topbar">
        <span className="workspace-topbar__title">AI Web3D Modeler</span>
        <div className="workspace-topbar__modes" role="group" aria-label="Workspace mode">
          <button type="button" aria-pressed={workspaceMode === 'web3d'} onClick={() => setWorkspaceMode('web3d')}>Web3D</button>
          <button type="button" aria-pressed={workspaceMode === 'cad'} onClick={() => { setWorkspaceMode('cad'); setCadOpen(true) }}>CAD</button>
        </div>
        {workspaceMode === 'web3d' && <label className="workspace-topbar__project-name">
          <span>Project</span>
          <input
            value={state.projectName}
            disabled={state.isBusy}
            maxLength={80}
            onChange={(event) => renameProject(event.target.value)}
            onBlur={persistProjectName}
            aria-label="Project name"
          />
        </label>}
        {workspaceMode === 'web3d' && <DownloadMenu
          projectId={state.projectId}
          projectName={state.projectName}
          revision={state.modelSpec?.revision ?? null}
          artifacts={state.artifacts}
        />}
        {workspaceMode === 'web3d' && <RecipeMenu modelSpec={state.modelSpec} isBusy={state.isBusy} applyRecipe={applyRecipe} />}
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Project manifest"
          onChange={(event) => {
            void handleImport(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        {workspaceMode === 'web3d' && <button type="button" className="workspace-topbar__import-button" disabled={!state.projectId || state.isBusy} onClick={() => importInput.current?.click()}>
          Import
        </button>}
        {workspaceMode === 'cad' && <button type="button" className="workspace-topbar__import-button" onClick={() => setCadOpen((value) => !value)} aria-expanded={cadOpen} aria-controls="workspace-cad-sidebar">
          {cadOpen ? 'Hide CAD options' : 'Show CAD options'}
        </button>}
        {workspaceMode === 'cad' && <div role="group" aria-label="CAD editor"><button type="button" aria-pressed={cadEditor === 'program'} onClick={() => setCadEditor('program')}>Construção livre</button><button type="button" aria-pressed={cadEditor === 'assembly'} onClick={() => setCadEditor('assembly')}>Conjunto</button><button type="button" aria-pressed={cadEditor === 'templates'} onClick={() => setCadEditor('templates')}>Moldes</button></div>}
        {workspaceMode === 'web3d' && importError && <span role="alert">{importError}</span>}
        {workspaceMode === 'web3d' && <button type="button" className="workspace-topbar__reset-button" onClick={requestReset} disabled={state.isBusy}>
          Reset
        </button>}
        <button
          type="button"
          className="workspace-topbar__settings-button"
          onClick={() => setSettingsOpen((value) => !value)}
        >
          AI Provider
        </button>
        <ProviderSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </header>

      <div className={`workspace-main workspace-main--${workspaceMode} workspace-main--${activePanel}`}>
        <div className="workspace-panel-tabs" role="tablist" aria-label="Workspace panels">
          <button
            type="button"
            id="workspace-tab-chat"
            role="tab"
            aria-selected={activePanel === 'chat'}
            aria-controls="workspace-chat-panel"
            onClick={() => setActivePanel('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            id="workspace-tab-viewer"
            role="tab"
            aria-selected={activePanel === 'viewer'}
            aria-controls="workspace-viewer-panel"
            onClick={() => setActivePanel('viewer')}
          >
            3D Preview
          </button>
        </div>

        <section
          id="workspace-chat-panel"
          className="workspace-chat"
          role="tabpanel"
          aria-labelledby="workspace-tab-chat"
        >
          <ChatPanel
            state={state}
            sendMessage={sendMessage}
            cancelGeneration={cancelGeneration}
            canSend={canSend}
            retryProject={retryProject}
            onOpenProviderSettings={() => setSettingsOpen(true)}
          />
        </section>

        <section
          id="workspace-viewer-panel"
          className="workspace-viewer"
          role="tabpanel"
          aria-labelledby="workspace-tab-viewer"
        >
          <X3DPreviewFrame previewUrl={state.previewUrl} onStatusChange={setViewerStatus} />
        </section>

        <aside id="workspace-cad-sidebar" className="workspace-cad-sidebar" hidden={!cadOpen}>
          {cadEditor === 'program' ? <CadProgramPanel spec={programSpec} project={programProject} onChange={setProgramSpec} onSaved={setProgramProject} onNew={() => { clearActiveCadProgram(); setProgramProject(null); setProgramSpec(initialCadProgram); clearCadProgress() }} planDesign={planCadDesignWithProgress} onAssemblyGenerated={(result) => { clearActiveCadAssembly(); setAssemblyProject(null); setAssemblySpec(result.spec); setAssemblyAssumptions(result.assumptions); setCadEditor('assembly'); setCadOpen(true) }} agentReady={state.agentPhase === 'ready'} onOpenProviderSettings={() => setSettingsOpen(true)} cadProgress={cadProgress} cadProgressStatus={cadProgressStatus} cadProgressUpdatedAt={cadProgressUpdatedAt} onRequestChanged={clearCadProgress} cancelGeneration={cancelCadGeneration} />
            : cadEditor === 'assembly' ? <CadAssemblyPanel spec={assemblySpec} project={assemblyProject} onChange={setAssemblySpec} onSaved={setAssemblyProject} onNew={() => { clearActiveCadAssembly(); setAssemblyProject(null); setAssemblySpec(null); setAssemblyAssumptions([]); clearCadProgress() }} plan={planCadAssemblyWithProgress} agentReady={state.agentPhase === 'ready'} onOpenProviderSettings={() => setSettingsOpen(true)} initialAssumptions={assemblyAssumptions} cadProgress={cadProgress} cadProgressStatus={cadProgressStatus} cadProgressUpdatedAt={cadProgressUpdatedAt} onRequestChanged={clearCadProgress} cancelGeneration={cancelCadGeneration} />
              : <CadPlatePanel onClose={() => setCadOpen(false)} onDraftChange={setCadDraft} planEdit={planCadEdit} planCreate={planCadCreate} agentReady={state.agentPhase === 'ready'} onOpenProviderSettings={() => setSettingsOpen(true)} />}
        </aside>
        <section className="workspace-cad-preview" aria-label="CAD draft preview">
          <div className="workspace-cad-preview__canvas">
            {cadProgress && cadEditor !== 'templates' && <CadAssemblyProgressView progress={cadProgress} status={cadProgressStatus} updatedAt={cadProgressUpdatedAt} />}
            {cadEditor === 'program' ? <><div className="workspace-cad-preview__heading">CAD · prévia 3D (mm) · arraste para girar</div><CadMeshView mesh={programMesh} />{programError && <p role="alert">{programError}</p>}</>
              : cadEditor === 'assembly' ? <><div className="workspace-cad-preview__heading">Conjunto CAD · corpos independentes (mm) · arraste para girar</div><CadMeshView mesh={assemblyMesh} />{assemblyError && <p role="alert">{assemblyError}</p>}</>
                : <><div className="workspace-cad-preview__heading">CAD draft · orthographic views (mm)</div><CadTopView part={cadDraft} /></>}
          </div>
        </section>
      </div>

      {workspaceMode === 'cad'
        ? <footer className="workspace-statusbar" aria-label="CAD status">
          <span>CAD: {cadEditor === 'program' ? programSpec.partId : cadEditor === 'assembly' ? assemblySpec?.partId ?? 'novo conjunto' : cadDraft.partId}</span>
          <span>{cadProgress && cadProgress.components.length > 0 && cadEditor !== 'templates' ? `${cadProgress.completed}/${cadProgress.components.length} componentes ${cadProgressStatus === 'paused' ? '· pausado' : cadProgressStatus === 'running' ? '· em andamento' : ''}` : cadEditor === 'program' ? `${programSpec.steps.length} etapas` : cadEditor === 'assembly' ? `${assemblySpec?.components.length ?? 0} corpos` : `${1 + (cadDraft.additionalHoles?.length ?? 0) + (cadDraft.upright?.holes.length ?? 0)} through holes`}</span>
          <span>AI: {state.agentProvider} ({state.agentPhase})</span>
        </footer>
        : <StatusBar state={state} mcpHealth={mcpHealth} />}
    </div>
  )
}

export default WorkspaceShell
