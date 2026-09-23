import { useState } from 'react'

import { ApiError, artifactUrl, type ArtifactDescriptor } from '../api/client.ts'
import { artifactFilename } from './projectName.ts'

interface DownloadMenuProps {
  readonly projectId: string | null
  readonly projectName: string
  readonly revision: number | null
  readonly artifacts: readonly ArtifactDescriptor[]
}

const extensions: Record<ArtifactDescriptor['format'] | 'manifest', string> = {
  html: 'html',
  x3d: 'x3d',
  x3dj: 'x3dj',
  x3dv: 'x3dv',
  manifest: 'json',
}

function DownloadMenu({ projectId, projectName, revision, artifacts }: DownloadMenuProps) {
  const [error, setError] = useState<string | null>(null)
  const descriptors: readonly (ArtifactDescriptor | { format: 'manifest'; available: boolean; reason: null })[] = [
    ...artifacts,
    { format: 'manifest', available: revision !== null, reason: null },
  ]

  async function download(format: ArtifactDescriptor['format'] | 'manifest') {
    if (!projectId || revision === null) return
    setError(null)
    try {
      const response = await fetch(artifactUrl(projectId, format, revision))
      if (!response.ok) {
        const body = (await response.json()) as { code?: string; message?: string }
        throw new ApiError(response.status, {
          code: body.code ?? 'ARTIFACT_UNAVAILABLE',
          message: body.message ?? 'Download failed.',
        })
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = artifactFilename(projectName, revision, extensions[format])
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div className="download-menu">
      <span className="download-menu__label">Download</span>
      {descriptors.map((descriptor) => (
        <button
          key={descriptor.format}
          type="button"
          disabled={!descriptor.available || !projectId || revision === null}
          title={descriptor.reason ?? `Download ${descriptor.format.toUpperCase()}`}
          onClick={() => void download(descriptor.format)}
        >
          {descriptor.format.toUpperCase()}
        </button>
      ))}
      {error && <span className="download-menu__error" role="alert">{error}</span>}
    </div>
  )
}

export default DownloadMenu
