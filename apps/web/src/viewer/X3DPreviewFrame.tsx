import { useEffect, useRef, useState } from 'react'

import './X3DPreviewFrame.css'
import { BlobUrlTracker, browserObjectUrlFactory } from './objectUrl.ts'

function withCameraBridge(html: string): string {
  const bridge = `<script>window.addEventListener('message',function(e){var r=document.querySelector('x3d')&&document.querySelector('x3d').runtime;if(!r||!e.data||e.data.type!=='ai-web3d-camera')return;if(e.data.action==='fit'&&r.showAll)r.showAll();else if(e.data.action==='reset'&&r.resetView)r.resetView();else if(e.data.action==='zoom'){var c=document.querySelector('canvas');if(c)c.dispatchEvent(new WheelEvent('wheel',{deltaY:e.data.amount,bubbles:true,cancelable:true}));}});</script>`
  return html.includes('</body>') ? html.replace('</body>', `${bridge}</body>`) : `${html}${bridge}`
}

function previewProject(url: string): string | null {
  return /\/api\/projects\/([^/]+)\/artifacts\//.exec(url)?.[1] ?? null
}

interface X3DPreviewFrameProps {
  /** Absolute URL of the current revision's standalone HTML artifact, or
   * `null` before any revision has committed. */
  readonly previewUrl: string | null
  readonly onStatusChange?: (status: 'artifact-generation' | 'loading' | 'ready' | 'failed') => void
}

/**
 * Sandboxed XPrévia 3D (PRD §10.3/§11.4, Issue #28): fetches the backend's
 * standalone X3DOM HTML, embeds it via a Blob URL in a sandboxed iframe
 * (never `srcDoc`/`dangerouslySetInnerHTML` with raw HTML -- the generated
 * page never touches the parent DOM), and revokes the previous Blob URL only
 * after the new one replaces it. A failed fetch shows an error overlay
 * without clearing whatever was already rendered, so a bad request doesn't
 * blank out the last valid scene (PRD FE-08's last-valid-scene rule; full
 * revision-badge/status polish is Issue #29).
 */
function X3DPreviewFrame({ previewUrl, onStatusChange }: X3DPreviewFrameProps) {
  const trackerRef = useRef<BlobUrlTracker | null>(null)
  if (trackerRef.current === null) {
    trackerRef.current = new BlobUrlTracker(browserObjectUrlFactory)
  }

  const [loaded, setLoaded] = useState<{ source: string; blob: string } | null>(null)
  const [error, setError] = useState<{ source: string; message: string } | null>(null)
  const blobUrl = previewUrl && loaded && previewProject(loaded.source) !== null && previewProject(loaded.source) === previewProject(previewUrl)
    ? loaded.blob
    : null
  const currentError = previewUrl && error?.source === previewUrl ? error.message : null

  useEffect(() => {
    if (!previewUrl) {
      trackerRef.current?.clear()
      return
    }
    const tracker = trackerRef.current
    if (!tracker) return
    let cancelled = false
    const abort = new AbortController()
    onStatusChange?.('artifact-generation')

    fetch(previewUrl, { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Preview request failed with status ${response.status}`)
        return response.text()
      })
      .then((html) => {
        if (cancelled) return
        onStatusChange?.('loading')
        setLoaded({ source: previewUrl, blob: tracker.set(withCameraBridge(html)) })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError({ source: previewUrl, message: err instanceof Error ? err.message : String(err) })
        onStatusChange?.('failed')
      })

    return () => {
      cancelled = true
      abort.abort()
    }
  }, [previewUrl, onStatusChange])

  useEffect(() => {
    const tracker = trackerRef.current
    return () => tracker?.clear()
  }, [])

  if (!blobUrl) {
    return (
      <div className="viewer-frame">
        <p className="workspace-placeholder">
          {currentError ? `Falha ao carregar a prévia: ${currentError}` : 'Sua cena aparecerá aqui. Descreva um modelo na conversa ao lado.'}
        </p>
      </div>
    )
  }

  return (
    <div className="viewer-frame">
      <div className="viewer-frame__controls" aria-label="Controles da câmera">
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'zoom', amount: -120 }, '*')}>Aproximar</button>
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'zoom', amount: 120 }, '*')}>Afastar</button>
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'fit' }, '*')}>Enquadrar</button>
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'reset' }, '*')}>Redefinir câmera</button>
      </div>
      <iframe
        className="viewer-frame__iframe"
        title="Prévia 3D"
        src={blobUrl}
        sandbox="allow-scripts"
        onLoad={() => {
          trackerRef.current?.markLoaded(blobUrl)
          onStatusChange?.('ready')
        }}
      />
      {currentError && (
        <div className="viewer-frame__error" role="alert">
          Falha ao carregar a prévia: {currentError}
        </div>
      )}
    </div>
  )
}

export default X3DPreviewFrame
