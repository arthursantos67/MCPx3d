import './WorkspaceShell.css'

import ChatPanel from '../chat/ChatPanel.tsx'
import { useChatController } from '../chat/useChatController.ts'

/**
 * Desktop modeling workspace shell (PRD §3.1, Issue #25): top bar, a
 * side-by-side chat + viewer main area, and a status bar. The chat panel
 * (#26/#27) is wired here; the X3D preview iframe (#28) and status bar
 * (#32) remain placeholders.
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
          <p className="workspace-placeholder">The 3D viewer will appear here.</p>
        </section>
      </div>

      <footer className="workspace-statusbar">
        <span className="workspace-placeholder">Status bar will appear here.</span>
      </footer>
    </div>
  )
}

export default WorkspaceShell
