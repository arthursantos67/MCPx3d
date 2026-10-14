import * as THREE from 'three'
import type { SceneNode, ThreeSceneDocument, Vector3Tuple } from './sceneDocument.ts'

export function sceneMatrices(doc: ThreeSceneDocument): Map<string, THREE.Matrix4> {
  const byId = new Map(doc.nodes.map((node) => [node.id, node])), result = new Map<string, THREE.Matrix4>()
  const get = (node: SceneNode): THREE.Matrix4 => {
    if (result.has(node.id)) return result.get(node.id)!
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...node.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.rotation.map(THREE.MathUtils.degToRad) as Vector3Tuple)), new THREE.Vector3(...node.scale))
    const matrix = node.parentId ? get(byId.get(node.parentId)!).clone().multiply(local) : local
    result.set(node.id, matrix)
    return matrix
  }
  for (const node of doc.nodes) get(node)
  return result
}
export function insertionPosition(doc: ThreeSceneDocument, node: SceneNode, ownNodes: SceneNode[] = [node]): Vector3Tuple {
  const matrices = sceneMatrices(doc), parentInverse = node.parentId ? matrices.get(node.parentId)!.clone().invert() : new THREE.Matrix4()
  const oldBounds = new THREE.Box3(), unit = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
  const byId = new Map(doc.nodes.map((item) => [item.id, item]))
  for (const item of doc.nodes) {
    if (item.kind === 'group' || !item.visible) continue
    let parent = item.parentId, belongs = node.parentId === null
    while (parent) { if (parent === node.parentId) belongs = true; parent = byId.get(parent)!.parentId }
    if (!belongs) continue
    const matrix = parentInverse.clone().multiply(matrices.get(item.id)!).scale(new THREE.Vector3(...item.dimensions))
    oldBounds.union(unit.clone().applyMatrix4(matrix))
  }
  if (oldBounds.isEmpty()) return [...node.position]
  const subtreeDoc = { ...doc, nodes: ownNodes.map((item) => item.id === node.id ? { ...item, parentId: null, position: [0, 0, 0] as Vector3Tuple } : item) }
  const ownMatrices = sceneMatrices(subtreeDoc), bounds = new THREE.Box3()
  for (const item of subtreeDoc.nodes) if (item.kind !== 'group') bounds.union(unit.clone().applyMatrix4(ownMatrices.get(item.id)!.clone().scale(new THREE.Vector3(...item.dimensions))))
  const localMin = bounds.isEmpty() ? -0.5 : bounds.min.x
  return [oldBounds.max.x + 0.25 - localMin, node.position[1], node.position[2]]
}
