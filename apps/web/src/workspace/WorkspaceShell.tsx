import { useEffect, useState } from 'react'

import './WorkspaceShell.css'

import ChatPanel from '../chat/ChatPanel.tsx'
import { useChatController } from '../chat/useChatController.ts'
import ProviderSettings from '../settings/ProviderSettings.tsx'
import X3DPreviewFrame from '../viewer/X3DPreviewFrame.tsx'
import { getMcpHealth, type McpHealth } from '../api/client.ts'
import DownloadMenu from './DownloadMenu.tsx'
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
  const { state, sendMessage, cancelGeneration, canSend, retryProject, resetProject, renameProject, persistProjectName, setViewerStatus } = useChatController()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mcpHealth, setMcpHealth] = useState<McpHealth | null>(null)
  const [activePanel, setActivePanel] = useState<'chat' | 'viewer'>('chat')

  useEffect(() => {
    let active = true
    void getMcpHealth()
      .then((health) => active && setMcpHealth(health))
      .catch(() => active && setMcpHealth({ reachable: false, detail: 'health check failed' }))
    return () => { active = false }
  }, [])

  const hasProjectContent = state.messages.length > 0 || (state.modelSpec?.revision ?? 0) > 0
  const requestReset = () => {
    if (!hasProjectContent || window.confirm('Reset this project? The model and conversation will be cleared.')) {
      resetProject()
    }
  }

  return (
    <div className="workspace">
      <header className="workspace-topbar">
        <span className="workspace-topbar__title">AI Web3D Modeler</span>
        <label className="workspace-topbar__project-name">
          <span>Project</span>
          <input
            value={state.projectName}
            maxLength={80}
            onChange={(event) => renameProject(event.target.value)}
            onBlur={persistProjectName}
            aria-label="Project name"
          />
        </label>
        <DownloadMenu
          projectId={state.projectId}
          projectName={state.projectName}
          revision={state.modelSpec?.revision ?? null}
          artifacts={state.artifacts}
        />
        <button type="button" className="workspace-topbar__reset-button" onClick={requestReset} disabled={state.isBusy}>
          Reset
        </button>
        <button
          type="button"
          className="workspace-topbar__settings-button"
          onClick={() => setSettingsOpen((value) => !value)}
        >
          AI Provider
        </button>
        <ProviderSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </header>

      <div className={`workspace-main workspace-main--${activePanel}`}>
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
      </div>

      <StatusBar state={state} mcpHealth={mcpHealth} />
    </div>
  )
}

export default WorkspaceShell
