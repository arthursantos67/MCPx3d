import { useState } from 'react'

import './WorkspaceShell.css'

import ChatPanel from '../chat/ChatPanel.tsx'
import { useChatController } from '../chat/useChatController.ts'
import ProviderSettings from '../settings/ProviderSettings.tsx'
import X3DPreviewFrame from '../viewer/X3DPreviewFrame.tsx'

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
  const { state, sendMessage, canSend } = useChatController()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="workspace">
      <header className="workspace-topbar">
        <span className="workspace-topbar__title">AI Web3D Modeler</span>
        <button
          type="button"
          className="workspace-topbar__settings-button"
          onClick={() => setSettingsOpen((value) => !value)}
        >
          AI Provider
        </button>
        <ProviderSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </header>

      <div className="workspace-main">
        <section className="workspace-chat" aria-label="Chat">
          <ChatPanel
            state={state}
            sendMessage={sendMessage}
            canSend={canSend}
            onOpenProviderSettings={() => setSettingsOpen(true)}
          />
        </section>

        <section className="workspace-viewer" aria-label="3D viewer">
          <X3DPreviewFrame previewUrl={state.previewUrl} />
        </section>
      </div>

      <footer className="workspace-statusbar">
        <span className="workspace-placeholder">Status bar will appear here.</span>
      </footer>
    </div>
  )
}

export default WorkspaceShell
