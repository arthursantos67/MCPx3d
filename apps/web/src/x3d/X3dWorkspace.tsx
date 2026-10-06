import { useRef, useState } from 'react'
import type { UseChatController } from '../chat/useChatController.ts'
import type { EngineHealth } from '../api/client.ts'
import ChatPanel from '../chat/ChatPanel.tsx'
import X3DPreviewFrame from '../viewer/X3DPreviewFrame.tsx'
import DownloadMenu from '../workspace/DownloadMenu.tsx'
import RecipeMenu from '../workspace/RecipeMenu.tsx'
import StatusBar from '../workspace/StatusBar.tsx'

interface Props {
  readonly controller: UseChatController
  readonly active: boolean
  readonly engine: EngineHealth | null
  readonly onOpenProviderSettings: () => void
}

export default function X3dWorkspace({ controller, active, engine, onOpenProviderSettings }: Props) {
  const { state, sendMessage, applyRecipe, importManifest, cancelGeneration, canSend, retryProject, resetProject, renameProject, persistProjectName, setViewerStatus } = controller
  const [panel, setPanel] = useState<'chat' | 'viewer'>('chat')
  const [importError, setImportError] = useState<string | null>(null)
  const [strictLayout, setStrictLayout] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasContent = state.messages.length > 0 || (state.modelSpec?.revision ?? 0) > 0

  const handleImport = async (file?: File) => {
    if (!file) return
    if (hasContent && !window.confirm('Importar este modelo e substituir a cena e a conversa atuais?')) return
    if (file.size > 10_000_000) { setImportError('O manifesto ultrapassa o limite de 10 MB.'); return }
    try { importManifest(await file.text()); setImportError(null) }
    catch (error) { setImportError(error instanceof Error ? error.message : String(error)) }
  }

  return <div className="x3d-workspace" hidden={!active}>
    <div className="workspace-toolbar">
      <label className="workspace-topbar__project-name"><span>Projeto</span>
        <input value={state.projectName} disabled={state.isBusy} maxLength={80} onChange={(event) => renameProject(event.target.value)} onBlur={persistProjectName} aria-label="Nome do projeto X3D" />
      </label>
      <RecipeMenu modelSpec={state.modelSpec} isBusy={state.isBusy} applyRecipe={applyRecipe} />
      <button type="button" disabled={!state.projectId || state.isBusy} onClick={() => inputRef.current?.click()}>Importar JSON</button>
      <input ref={inputRef} type="file" accept=".json,application/json" hidden aria-label="Manifesto X3D" onChange={(event) => {
        void handleImport(event.target.files?.[0]); event.target.value = ''
      }} />
      <button type="button" disabled={state.isBusy} onClick={() => {
        if (!hasContent || window.confirm('Criar um novo projeto e limpar a cena e a conversa atuais?')) resetProject()
      }}>Novo projeto</button>
      <DownloadMenu projectId={state.projectId} projectName={state.projectName} revision={state.modelSpec?.revision ?? null} artifacts={state.artifacts} />
      {importError && <span role="alert">{importError}</span>}
    </div>
    <div className={`workspace-main workspace-main--${panel}`}>
      <div className="workspace-panel-tabs" role="group" aria-label="Painéis X3D">
        <button type="button" aria-pressed={panel === 'chat'} onClick={() => setPanel('chat')}>Conversa</button>
        <button type="button" aria-pressed={panel === 'viewer'} onClick={() => setPanel('viewer')}>Visualização 3D</button>
      </div>
      <section className="workspace-chat" aria-label="Conversa com o agente X3D">
        <div className="workspace-section-heading"><span className="workspace-eyebrow">AGENTE X3D</span><h2>O que vamos criar?</h2><p>Descreva o objeto, suas partes e as mudanças que deseja.</p></div>
        <label className="workspace-layout-option"><input type="checkbox" checked={strictLayout} disabled={state.isBusy}
          onChange={(event) => setStrictLayout(event.target.checked)} /> Exigir separação entre todos os objetos</label>
        <ChatPanel state={state} sendMessage={(text) => sendMessage(text, { overlapPolicy: strictLayout ? 'strict' : 'visual' })} cancelGeneration={cancelGeneration} canSend={canSend} retryProject={retryProject} onOpenProviderSettings={onOpenProviderSettings} />
      </section>
      <section className="workspace-viewer" aria-label="Visualização X3D"><X3DPreviewFrame previewUrl={state.previewUrl} onStatusChange={setViewerStatus} /></section>
    </div>
    <StatusBar state={state} engine={engine} />
  </div>
}
