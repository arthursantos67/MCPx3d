import { lazy, Suspense, useEffect, useState } from 'react'
import { createConfiguredProvider } from '../ai/configured-provider.ts'
import { useAgentProvider } from '../ai/useAgentProvider.ts'
import { useChatController } from '../chat/useChatController.ts'
import { getEnginesHealth, type EnginesHealth } from '../api/health.ts'
import ProviderSettings from '../settings/ProviderSettings.tsx'
import './WorkspaceShell.css'

const CadWorkspace = lazy(() => import('../cad/CadWorkspace.tsx'))
const X3dWorkspace = lazy(() => import('../x3d/X3dWorkspace.tsx'))
const ThreeWorkspace = lazy(() => import('../three/ThreeWorkspace.tsx'))

function WorkspaceShell() {
  const [mode, setMode] = useState<'cad' | 'x3d' | 'three'>(() => {
    try { const saved = localStorage.getItem('modeler:workspace'); return saved === 'x3d' || saved === 'three' ? saved : 'cad' }
    catch { return 'cad' }
  })
  const [provider, setProvider] = useState(createConfiguredProvider)
  const agent = useAgentProvider(provider)
  const chat = useChatController(provider, mode === 'x3d')
  const [cadVisited, setCadVisited] = useState(mode === 'cad')
  const [x3dVisited, setX3dVisited] = useState(mode === 'x3d')
  const [threeVisited, setThreeVisited] = useState(mode === 'three')
  const [threeBusy, setThreeBusy] = useState(false)
  const [cadBusy, setCadBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [engines, setEngines] = useState<EnginesHealth | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const busy = cadBusy || threeBusy || chat.state.isBusy

  useEffect(() => { try { localStorage.setItem('modeler:workspace', mode) } catch { /* Workspace navigation remains usable without storage. */ } }, [mode])
  useEffect(() => {
    let active = true
    void getEnginesHealth().then((value) => { if (active) setEngines(value) }).catch((error: unknown) => {
      if (active) setEngineError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  }, [])
  const engine = mode === 'cad' ? engines?.cad : engines?.x3d

  return <div className="workspace">
    <header className="workspace-topbar">
      <div className="workspace-brand"><span className="workspace-brand__mark" aria-hidden="true">3</span>
        <div><strong>Forma</strong><span>Estúdio de modelagem com IA</span></div></div>
      <nav className="workspace-topbar__modes" aria-label="Áreas de modelagem">
        <button type="button" aria-pressed={mode === 'cad'} disabled={busy} onClick={() => { setMode('cad'); setCadVisited(true) }}>CAD <small>STEP · STL</small></button>
        <button type="button" aria-pressed={mode === 'x3d'} disabled={busy} onClick={() => { setMode('x3d'); setX3dVisited(true) }}>X3D <small>Cenas 3D</small></button>
        <button type="button" aria-pressed={mode === 'three'} disabled={busy} onClick={() => { setMode('three'); setThreeVisited(true) }}>Three.js <small>Estúdio de cenas</small></button>
      </nav>
      <div className="workspace-runtime" role="status"><span className={`workspace-runtime__dot${agent.phase === 'ready' ? ' workspace-runtime__dot--ready' : ''}`} />
        {agent.phase === 'ready' ? 'IA pronta' : agent.phase === 'loading' ? 'Carregando IA' : 'Configure sua IA'}</div>
      <button type="button" className="workspace-topbar__settings-button" onClick={() => setSettingsOpen(true)}>Configurar IA</button>
      <ProviderSettings open={settingsOpen} disabled={busy} onApply={() => { const previous = provider; setProvider(createConfiguredProvider()); void previous.dispose?.() }} onClose={() => setSettingsOpen(false)} />
    </header>
    <div className="workspace-context"><span>{mode === 'cad' ? 'Agente CAD' : mode === 'x3d' ? 'Agente X3D' : 'Motor Three.js'}</span>
      <p>{mode === 'cad' ? 'Peças e conjuntos compostos, com geometria validada e arquivos para baixar.' : mode === 'x3d' ? 'Crie e edite cenas 3D por conversa. Visualize e baixe o X3D validado.' : 'Componha cenas com hierarquia, materiais e iluminação. Edição visual no navegador.'}</p>
      <span className="workspace-context__engine">{mode === 'three' ? 'Motor local · WebGL2' : engineError ? 'API indisponível' : engine ? engine.available ? 'Motor disponível' : 'Motor indisponível' : 'Verificando motor…'}</span>
    </div>
    <main className="workspace-content">
      <Suspense fallback={<p className="workspace-placeholder">Preparando a área de modelagem…</p>}>
      {cadVisited && <CadWorkspace provider={provider} active={mode === 'cad'} ready={agent.phase === 'ready'}
        agentDetail={agent.progressText ?? agent.reason} onOpenProviderSettings={() => setSettingsOpen(true)} onBusyChange={setCadBusy} />}
      {x3dVisited && <X3dWorkspace controller={chat} active={mode === 'x3d'} engine={engines?.x3d ?? null} onOpenProviderSettings={() => setSettingsOpen(true)} />}
      {threeVisited && <ThreeWorkspace active={mode === 'three'} provider={provider} ready={agent.phase === 'ready'} onBusyChange={setThreeBusy} onOpenProviderSettings={() => setSettingsOpen(true)} />}
      </Suspense>
    </main>
  </div>
}

export default WorkspaceShell
