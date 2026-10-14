import { useState } from 'react'
import type { SceneNode } from './sceneDocument.ts'
import type { GeometrySpec } from './sceneGeometrySpec.ts'

export default function GeometryEditor({ node, onApply }: { node: SceneNode; onApply: (geometry: GeometrySpec) => boolean }) {
  const keys = node.kind === 'tube' ? ['points', 'radius', 'segments', 'closed'] : node.kind === 'extrude' ? ['profile', 'holes', 'bevel']
    : node.kind === 'lathe' ? ['profile', 'segments', 'closed'] : node.kind === 'mesh' ? ['vertices', 'indices', 'normals', 'uvs']
      : node.kind === 'roundedBox' ? ['bevel'] : ['segments', 'radius']
  const editable = Object.fromEntries(keys.map((key) => [key, node.geometry[key as keyof GeometrySpec]]))
  const [draft, setDraft] = useState(() => node.kind === 'mesh' && node.geometry.vertices.length > 3000 ? '' : JSON.stringify(editable, null, 2))
  const [error, setError] = useState('')
  if (node.kind === 'group' || node.kind === 'box') return null
  return <details className="three-geometry-editor"><summary>Geometria e detalhamento</summary>
    <p>{node.kind === 'lathe' ? 'Perfil: pares [raio, altura], revolução em Y.' : node.kind === 'tube' ? 'Trajetória: pontos [x, y, z]. Raio relativo ao volume normalizado.'
      : node.kind === 'extrude' ? 'Perfil e recortes: pares [x, y], extrusão em Z. Não repita o primeiro ponto no final.' : 'Os parâmetros moldam a superfície. Dimensões e escala controlam seu tamanho.'}</p>
    {node.kind === 'mesh' && node.geometry.vertices.length > 3000 ? <p>Malha detalhada: {node.geometry.vertices.length / 3} vértices · {node.geometry.indices.length / 3} triângulos. Transformações e materiais permanecem editáveis.</p>
      : <><textarea aria-label="Parâmetros da geometria" rows={8} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="button" onClick={() => {
          try {
            const value = JSON.parse(draft)
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use um objeto de parâmetros.')
            if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Parâmetro desconhecido para esta geometria.')
            if (onApply({ ...node.geometry, ...value })) setError('')
          } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        }}>Aplicar geometria</button></>}
    {error && <p role="alert">{error}</p>}
  </details>
}
