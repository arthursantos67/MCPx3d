import { useEffect, useRef, useState, type ReactNode } from 'react'

export default function ThreeStage({ children, playing, time, duration, onPlay, onSeek, showPlayback = true }: {
  children: ReactNode; playing: boolean; time: number; duration: number; onPlay: () => void; onSeek: (seconds: number) => void; showPlayback?: boolean
}) {
  const host = useRef<HTMLDivElement>(null), toggle = useRef<HTMLButtonElement>(null)
  const [mode, setMode] = useState<'native' | 'expanded' | null>(null)
  useEffect(() => {
    const changed = () => {
      if (document.fullscreenElement === host.current) setMode('native')
      else { setMode((current) => current === 'native' ? null : current); toggle.current?.focus() }
    }
    document.addEventListener('fullscreenchange', changed)
    return () => { document.removeEventListener('fullscreenchange', changed) }
  }, [])
  const exit = async () => {
    if (document.fullscreenElement === host.current) await document.exitFullscreen().catch(() => {})
    setMode(null)
    toggle.current?.focus()
  }
  const enter = async () => {
    if (mode) { await exit(); return }
    if (host.current?.requestFullscreen) {
      try { await host.current.requestFullscreen(); return } catch { /* Embedded/mobile browsers may deny fullscreen; use the viewport expansion. */ }
    }
    setMode('expanded')
    toggle.current?.focus()
  }
  return <div ref={host} className={`three-stage${mode ? ' three-stage--fullscreen' : ''}${showPlayback ? '' : ' three-stage--presentation'}`} onKeyDown={(event) => {
    if (event.key === 'Escape' && mode === 'expanded') { event.preventDefault(); event.stopPropagation(); void exit() }
    if (event.key === 'Tab' && mode) {
      const items = [...host.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    {children}
    <button ref={toggle} className="three-fullscreen-toggle" type="button" aria-pressed={!!mode} onClick={() => void enter()}>{mode ? 'Sair da tela cheia' : 'Tela cheia'}</button>
    {mode && showPlayback && <div className="three-fullscreen-playback" role="group" aria-label="Reprodução em tela cheia">
      <button type="button" aria-pressed={playing} onClick={onPlay}>{playing ? 'Pausar animação' : 'Reproduzir animação'}</button>
      <button type="button" onClick={() => onSeek(0)}>Voltar ao início</button>
      <input type="range" aria-label="Tempo em tela cheia" min={0} max={duration} step={0.01} value={Math.min(time, duration)} onChange={(event) => onSeek(Number(event.target.value))} />
      <span>{time.toFixed(1)} / {duration} s · Escape para sair</span>
    </div>}
  </div>
}
