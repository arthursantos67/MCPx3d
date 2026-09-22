import './WorkspaceShell.css'

import ChatPanel from '../chat/ChatPanel.tsx'
import { useChatController } from '../chat/useChatController.ts'
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
 */
function WorkspaceShell() {
  const { state, sendMessage, canSend } = useChatController()

  return (
    <div className="workspace">
      <header className="workspace-topbar">
        <span className="workspace-topbar__title">AI Web3D Modeler</span>
      </header>

      <div className="workspace-main">
        <section className="workspace-chat" aria-label="Chat">
          <ChatPanel state={state} sendMessage={sendMessage} canSend={canSend} />
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
