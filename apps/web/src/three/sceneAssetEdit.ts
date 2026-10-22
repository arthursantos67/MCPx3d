import { replaceAssetNodes } from './sceneAssets.ts'
import { validateScene, type SceneNode, type ThreeSceneDocument } from './sceneDocument.ts'
import { expandSceneRecipe } from './sceneGeneration.ts'
import { prefabSpec, type PrefabSpec } from './scenePrefabs.ts'

const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
/** Recompiles one prefab root with new parameters, keeping its transform, behavior overrides and authored children. */
export function rebuildPrefab(doc: ThreeSceneDocument, rootId: string, patch: Partial<PrefabSpec>): ThreeSceneDocument {
  const root = doc.nodes.find((node) => node.id === rootId)
  if (!root?.asset) throw new Error('Selecione a raiz de um pré-fabricado.')
  const spec = prefabSpec({ ...root.asset, ...patch })
  if (!spec) throw new Error('Pré-fabricado desconhecido.')
  const rebuilt: SceneNode[] = expandSceneRecipe({ name: doc.name, background: doc.environment.background, exposure: 1, lightIntensity: 1, duration: doc.timeline.duration,
    nodes: [{ ...root, parentId: null, prefab: spec, color: root.material.color, metalness: root.material.metalness, roughness: root.material.roughness, repeat: single }] }).nodes
  return validateScene({ ...doc, nodes: replaceAssetNodes(doc, root, rebuilt.map((node) => node.id === root.id ? { ...node, behavior: root.behavior ?? node.behavior, name: root.name } : node)) })
}
