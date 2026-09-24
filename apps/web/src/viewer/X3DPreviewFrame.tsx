import { useEffect, useRef, useState } from 'react'

import './X3DPreviewFrame.css'
import { BlobUrlTracker, browserObjectUrlFactory } from './objectUrl.ts'

function withCameraBridge(html: string): string {
  const bridge = `<script>window.addEventListener('message',function(e){var r=document.querySelector('x3d')&&document.querySelector('x3d').runtime;if(!r||!e.data||e.data.type!=='ai-web3d-camera')return;if(e.data.action==='fit'&&r.showAll)r.showAll();else if(e.data.action==='reset'&&r.resetView)r.resetView();else if(e.data.action==='zoom'){var c=document.querySelector('canvas');if(c)c.dispatchEvent(new WheelEvent('wheel',{deltaY:e.data.amount,bubbles:true,cancelable:true}));}});</script>`
  return html.includes('</body>') ? html.replace('</body>', `${bridge}</body>`) : `${html}${bridge}`
}

interface X3DPreviewFrameProps {
  /** Absolute URL of the current revision's standalone HTML artifact, or
   * `null` before any revision has committed. */
  readonly previewUrl: string | null
  readonly onStatusChange?: (status: 'artifact-generation' | 'loading' | 'ready' | 'failed') => void
}

/**
 * Sandboxed X3D preview (PRD §10.3/§11.4, Issue #28): fetches the backend's
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

  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!previewUrl) return
    const tracker = trackerRef.current
    if (!tracker) return
    let cancelled = false
    setError(null)
    onStatusChange?.('artifact-generation')

    fetch(previewUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Preview request failed with status ${response.status}`)
        return response.text()
      })
      .then((html) => {
        if (cancelled) return
        onStatusChange?.('loading')
        setBlobUrl(tracker.set(withCameraBridge(html)))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        onStatusChange?.('failed')
      })

    return () => {
      cancelled = true
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
          {error ? `Preview failed to load: ${error}` : 'The 3D viewer will appear here.'}
        </p>
      </div>
    )
  }

  return (
    <div className="viewer-frame">
      <div className="viewer-frame__controls" aria-label="Camera controls">
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'zoom', amount: -120 }, '*')}>Zoom in</button>
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'zoom', amount: 120 }, '*')}>Zoom out</button>
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'fit' }, '*')}>Fit scene</button>
        <button type="button" onClick={() => document.querySelector<HTMLIFrameElement>('.viewer-frame__iframe')?.contentWindow?.postMessage({ type: 'ai-web3d-camera', action: 'reset' }, '*')}>Reset camera</button>
      </div>
      <iframe
        className="viewer-frame__iframe"
        title="3D preview"
        src={blobUrl}
        sandbox="allow-scripts"
        onLoad={() => {
          trackerRef.current?.markLoaded(blobUrl)
          onStatusChange?.('ready')
        }}
      />
      {error && (
        <div className="viewer-frame__error" role="alert">
          Preview failed to load: {error}
        </div>
      )}
    </div>
  )
}

export default X3DPreviewFrame
