import './WorkspaceShell.css'

/**
 * Desktop modeling workspace shell (PRD §3.1, Issue #25): top bar, a
 * side-by-side chat + viewer main area, and a status bar. Every region here
 * is a placeholder -- ChatPanel (#26), the X3D preview iframe (#28), and the
 * diagnostics status bar (#32) fill them in later.
 */
function WorkspaceShell() {
  return (
    <div className="workspace">
      <header className="workspace-topbar">
        <span className="workspace-topbar__title">AI Web3D Modeler</span>
      </header>

      <div className="workspace-main">
        <section className="workspace-chat" aria-label="Chat">
          <div className="workspace-chat__history">
            <p className="workspace-placeholder">Chat history will appear here.</p>
          </div>
          <div className="workspace-chat__composer">
            <p className="workspace-placeholder">Prompt composer will appear here.</p>
          </div>
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
