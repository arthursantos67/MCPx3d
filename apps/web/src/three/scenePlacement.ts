import * as THREE from 'three'
import type { SceneNode, ThreeSceneDocument, Vector3Tuple } from './sceneDocument.ts'
import { hasSurface } from './sceneDocument.ts'
import { buildNodeGeometry } from './sceneGeometry.ts'
import { MeshBVH } from 'three-mesh-bvh'

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
    if (item.kind === 'group' || item.kind === 'light' || !item.visible) continue
    let parent = item.parentId, belongs = node.parentId === null
    while (parent) { if (parent === node.parentId) belongs = true; parent = byId.get(parent)!.parentId }
    if (!belongs) continue
    const matrix = parentInverse.clone().multiply(matrices.get(item.id)!).scale(new THREE.Vector3(...item.dimensions))
    oldBounds.union(unit.clone().applyMatrix4(matrix))
  }
  if (oldBounds.isEmpty()) return [...node.position]
  const subtreeDoc = { ...doc, nodes: ownNodes.map((item) => item.id === node.id ? { ...item, parentId: null, position: [0, 0, 0] as Vector3Tuple } : item) }
  const ownMatrices = sceneMatrices(subtreeDoc), bounds = new THREE.Box3()
  for (const item of subtreeDoc.nodes) if (item.kind !== 'group' && item.kind !== 'light') bounds.union(unit.clone().applyMatrix4(ownMatrices.get(item.id)!.clone().scale(new THREE.Vector3(...item.dimensions))))
  const localMin = bounds.isEmpty() ? -0.5 : bounds.min.x
  return [oldBounds.max.x + 0.25 - localMin, node.position[1], node.position[2]]
}

/** Library objects enter the usable scene: rest on a real surface, with their footprint clear of other objects. */
export function supportedInsertionPosition(doc: ThreeSceneDocument, node: SceneNode, ownNodes: SceneNode[]): Vector3Tuple {
  if (node.parentId) return insertionPosition(doc, node, ownNodes)
  const unit = new THREE.Box3(new THREE.Vector3(-0.5,-0.5,-0.5), new THREE.Vector3(0.5,0.5,0.5))
  const own = ownNodes.map(item => item.id === node.id ? { ...item, position: [0,0,0] as Vector3Tuple } : item)
  const ownMatrices = sceneMatrices({ ...doc, nodes: own }), bounds = new THREE.Box3()
  for (const item of own) if (hasSurface(item.kind)) bounds.union(unit.clone().applyMatrix4(ownMatrices.get(item.id)!.clone().scale(new THREE.Vector3(...item.dimensions))))
  if (bounds.isEmpty()) return insertionPosition(doc, node, ownNodes)
  const size = bounds.getSize(new THREE.Vector3()), matrices = sceneMatrices(doc), byId = new Map(doc.nodes.map(item => [item.id,item]))
  const visible = (item: SceneNode): boolean => item.visible && (!item.parentId || visible(byId.get(item.parentId)!))
  const solids = doc.nodes.filter(item => hasSurface(item.kind) && item.collidable !== false && visible(item) && item.material.texture !== 'water').map(item => {
    const matrix = matrices.get(item.id)!.clone().scale(new THREE.Vector3(...item.dimensions))
    return { item, matrix, box: unit.clone().applyMatrix4(matrix) }
  })
  const supports = solids.filter(({ item, box }) => ['plane','terrain','box','roundedBox','mesh','extrude'].includes(item.kind) && box.max.x-box.min.x >= size.x+0.1 && box.max.z-box.min.z >= size.z+0.1)
  const meshes = supports.map(support => { const geometry = buildNodeGeometry(support.item); return { ...support, geometry, bvh: new MeshBVH(geometry), inverse: support.matrix.clone().invert(), normal: new THREE.Matrix3().getNormalMatrix(support.matrix) } })
  const spawn = doc.environment.player?.spawn ?? [0,0,0]
  let preferredHeight: number | null = null
  try {
    const stride = Math.max(0.8, Math.min(3, Math.max(size.x,size.z)+0.3))
    for (let ring=0; ring<8; ring++) for (let i=0; i<(ring?16:1); i++) {
      const x=spawn[0]+Math.cos(i*Math.PI/8)*ring*stride, z=spawn[2]+Math.sin(i*Math.PI/8)*ring*stride
      const hits = meshes.flatMap(support => {
        if (x+bounds.min.x < support.box.min.x || x+bounds.max.x > support.box.max.x || z+bounds.min.z < support.box.min.z || z+bounds.max.z > support.box.max.z) return []
        const ray = new THREE.Ray(new THREE.Vector3(x,support.box.max.y+1,z),new THREE.Vector3(0,-1,0)).applyMatrix4(support.inverse)
        const hit = support.bvh.raycastFirst(ray,THREE.DoubleSide)
        if (!hit?.face || hit.face.normal.clone().applyMatrix3(support.normal).normalize().y < 0.64) return []
        return [{ support, height: hit.point.applyMatrix4(support.matrix).y }]
      }).sort((a,b)=>Math.abs(a.height-spawn[1])-Math.abs(b.height-spawn[1]))
      if (preferredHeight === null && hits.length) preferredHeight = hits[0].height
      for (const { support,height } of hits) {
        if (preferredHeight !== null && Math.abs(height-preferredHeight)>0.5) continue
        const position = new THREE.Vector3(x,height-bounds.min.y,z), placed = bounds.clone().translate(position)
        const blocked = solids.some(solid => {
          if (solid === support || solid.item.id === support.item.id || solid.box.max.y <= height+0.015) return false
          const overlap = placed.clone().intersect(solid.box)
          if (overlap.isEmpty()) return false
          const penetration = overlap.getSize(new THREE.Vector3())
          return Math.min(penetration.x,penetration.y,penetration.z) > 0.015
        })
        if (!blocked) return position.toArray() as Vector3Tuple
      }
    }
  } finally { for (const support of meshes) support.geometry.dispose() }
  return insertionPosition(doc,node,ownNodes)
}
