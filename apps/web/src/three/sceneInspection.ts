import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { SceneNode, ThreeSceneDocument } from './sceneDocument.ts'
import { buildNodeGeometry, geometryKey } from './sceneGeometry.ts'
import { sampleNodeTransform } from './sceneAnimation.ts'

export interface SceneIntersection { a: string; b: string; nameA: string; nameB: string; kind: 'surface' | 'containment'; times: number[] }
export interface SceneInspection { intersections: SceneIntersection[]; sampledTimes: number[]; checkedPairs: number; skippedContacts: number; complete: boolean; elapsedMs: number }
function closed(node: SceneNode) {
  if (node.kind === 'group' || node.kind === 'mesh' || node.kind === 'tube') return false
  if (node.kind === 'lathe') return node.geometry.closed || (node.geometry.profile[0][0] === 0 && node.geometry.profile.at(-1)![0] === 0)
  return true
}
function inside(point: THREE.Vector3, bvh: MeshBVH): boolean {
  const votes = [[0.918, 0.257, 0.302], [-0.331, 0.891, 0.311], [0.219, -0.417, 0.882]].filter((direction) => {
    const hits = bvh.raycast(new THREE.Ray(point, new THREE.Vector3(...direction).normalize()), THREE.DoubleSide).map((hit) => hit.distance).sort((a, b) => a - b)
    if (hits[0] !== undefined && hits[0] < 1e-6) return false
    const distinct = hits.filter((distance, index) => !index || Math.abs(distance - hits[index - 1]) > 1e-6)
    return distinct.length % 2 === 1
  })
  return votes.length >= 2
}
/** Conservative boxes only reject pairs. Triangle intersections and bounded containment refine candidates. */
export function inspectSceneGeometry(doc: ThreeSceneDocument, options: { maxPairs?: number; maxMilliseconds?: number } = {}): SceneInspection {
  const started = performance.now(), maxPairs = options.maxPairs ?? 3000, maxMilliseconds = options.maxMilliseconds ?? 8000
  const sampledTimes = doc.nodes.some((node) => node.animation.kind !== 'none') ? [0, 0.25, 0.5, 0.75].map((t) => t * doc.timeline.duration) : [0]
  const geometryCache = new Map<string, THREE.BufferGeometry>(), trees = new Map<string, MeshBVH>(), issues = new Map<string, SceneIntersection>()
  let checkedPairs = 0, skippedContacts = 0, complete = true
  const geometry = (node: SceneNode) => {
    const key = geometryKey(node)
    if (!geometryCache.has(key)) geometryCache.set(key, buildNodeGeometry(node))
    return geometryCache.get(key)!
  }
  const tree = (node: SceneNode) => {
    const key = geometryKey(node)
    if (!trees.has(key)) { const boundsTree = new MeshBVH(geometry(node), { indirect: true }); trees.set(key, boundsTree); geometry(node).boundsTree = boundsTree }
    return trees.get(key)!
  }
  try {
    timeLoop: for (const time of sampledTimes) {
      const transforms = new Map<string, THREE.Matrix4>(), shown = new Map<string, boolean>(), byId = new Map(doc.nodes.map((node) => [node.id, node]))
      const matrix = (node: SceneNode): THREE.Matrix4 => {
        if (transforms.has(node.id)) return transforms.get(node.id)!
        const pose = sampleNodeTransform(node, time)
        const local = new THREE.Matrix4().compose(new THREE.Vector3(...pose.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])), new THREE.Vector3(...node.scale))
        const parent = node.parentId ? byId.get(node.parentId)! : null
        const world = parent ? matrix(parent).clone().multiply(local) : local
        transforms.set(node.id, world)
        shown.set(node.id, node.visible && (!parent || shown.get(parent.id)!))
        return world
      }
      const meshes = doc.nodes.filter((node) => node.kind !== 'group').map((node) => {
        const world = matrix(node).clone().scale(new THREE.Vector3(...node.dimensions))
        return { node, matrix: world, bounds: geometry(node).boundingBox!.clone().applyMatrix4(world) }
      }).filter((mesh) => shown.get(mesh.node.id))
      for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) {
        if (performance.now() - started > maxMilliseconds || checkedPairs >= maxPairs) { complete = false; break timeLoop }
        const a = meshes[i], b = meshes[j]
        if (!a.bounds.intersectsBox(b.bounds)) continue
        const overlap = a.bounds.clone().intersect(b.bounds).getSize(new THREE.Vector3())
        if (Math.min(overlap.x, overlap.y, overlap.z) < 1e-5) continue // contact without volumetric overlap
        if (a.node.overlapWith.includes(b.node.id) || b.node.overlapWith.includes(a.node.id)) { skippedContacts++; continue }
        checkedPairs++
        const relative = a.matrix.clone().invert().multiply(b.matrix)
        tree(b.node) // Both sides need a BVH; otherwise refinement falls back to a linear triangle scan.
        let kind: SceneIntersection['kind'] | null = tree(a.node).intersectsGeometry(geometry(b.node), relative) ? 'surface' : null
        if (!kind) {
          for (const [outer, inner] of [[a, b], [b, a]]) {
            if (!closed(outer.node) || !outer.bounds.containsBox(inner.bounds)) continue
            const point = geometry(inner.node).getAttribute('position')
            const toOuter = outer.matrix.clone().invert().multiply(inner.matrix)
            const samples = [0, Math.floor(point.count / 2), point.count - 1].map((index) => new THREE.Vector3().fromBufferAttribute(point, index).applyMatrix4(toOuter))
            if (samples.every((sample) => inside(sample, tree(outer.node)))) { kind = 'containment'; break }
          }
        }
        if (kind) {
          const key = [a.node.id, b.node.id].sort().join('\u0000')
          const previous = issues.get(key)
          if (previous) previous.times.push(time)
          else issues.set(key, { a: a.node.id, b: b.node.id, nameA: a.node.name, nameB: b.node.name, kind, times: [time] })
        }
      }
    }
    return { intersections: [...issues.values()], sampledTimes, checkedPairs, skippedContacts, complete, elapsedMs: performance.now() - started }
  } finally { for (const value of geometryCache.values()) value.dispose() }
}
export function intersectionKey(issue: SceneIntersection): string { return [issue.a, issue.b].sort().join('\u0000') }
export function repairImproved(before: SceneInspection, after: SceneInspection): boolean {
  const original = new Set(before.intersections.map(intersectionKey))
  return after.complete && after.intersections.length < before.intersections.length && after.intersections.every((issue) => original.has(intersectionKey(issue)))
}
