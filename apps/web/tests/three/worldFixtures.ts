import { createEmptyScene, createNode, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from '../../src/three/sceneDocument.ts'
import { prefabParts, prefabSpec, type PrefabType } from '../../src/three/scenePrefabs.ts'

export function node(kind: SceneNode['kind'], id: string, extra: Partial<SceneNode> = {}): SceneNode {
  return { ...createNode(kind), id, name: id, ...extra }
}
/** Prefab root at `position` with its parts, using the same IDs and assetPart names as recipe expansion. */
export function prefab(type: PrefabType, id: string, position: Vector3Tuple, extra: Record<string, unknown> = {}): SceneNode[] {
  const spec = prefabSpec({ type, size: 1, seed: 2, primary: null, secondary: null, text: '', lit: true, interactive: true, ...extra })!
  const root = node('group', id, { position, asset: spec, role: type === 'tree' || type === 'bush' ? 'vegetation' : 'structure' })
  return [root, ...prefabParts(spec).map((part) => node(part.kind, `${id}.${part.id}`, {
    parentId: part.parentId ? `${id}.${part.parentId}` : id, assetPart: part.id, position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions,
    material: { ...createNode('box').material, ...part.material }, geometry: { ...createNode(part.kind === 'group' ? 'box' : part.kind).geometry, ...part.geometry }, collidable: part.collidable ?? true,
  }))]
}
export function meadow(size = 40, extra: Partial<SceneNode['geometry']> = {}): SceneNode {
  const terrain = node('terrain', 'land', { position: [0, 0, 0], dimensions: [size, 4, size] })
  terrain.geometry = { ...terrain.geometry, biome: 'meadow', segments: 48, seed: 3, ...extra }
  return terrain
}
export function scene(nodes: SceneNode[]): ThreeSceneDocument { return { ...createEmptyScene(), nodes } }
