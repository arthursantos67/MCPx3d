import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { hasSurface, type SceneNode, type ThreeSceneDocument } from './sceneDocument.ts'
import { buildNodeGeometry, geometryKey } from './sceneGeometry.ts'
import { sampleNodeTransform } from './sceneAnimation.ts'
import { terrainHeightAt } from './sceneGeometrySpec.ts'
import { inspectSurfaceConflicts, type SurfaceConflict } from './sceneSurfaceQuality.ts'

export interface SceneIntersection { a: string; b: string; nameA: string; nameB: string; kind: 'surface' | 'containment'; times: number[] }
/** `assemblyContacts` counts static parts of the same top-level group touching each other: composition, not error. */
export interface SceneInspection { intersections: SceneIntersection[]; sampledTimes: number[]; checkedPairs: number; skippedContacts: number; assemblyContacts: number; complete: boolean; elapsedMs: number; surfaceConflicts?: SurfaceConflict[]; surfaceCheckComplete?: boolean }
function closed(node: SceneNode) {
  if (!hasSurface(node.kind) || ['mesh', 'tube', 'plane', 'text', 'terrain'].includes(node.kind)) return false
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
/** An object whose center stays above a terrain or floor plane is resting on it; slopes make it sink slightly. */
function restsOn(ground: { node: SceneNode; matrix: THREE.Matrix4 }, other: { bounds: THREE.Box3 }): boolean {
  if (ground.node.kind !== 'terrain' && ground.node.kind !== 'plane') return false
  const local = other.bounds.getCenter(new THREE.Vector3()).applyMatrix4(ground.matrix.clone().invert())
  if (Math.abs(local.x) > 0.5 || Math.abs(local.z) > 0.5) return false
  return local.y > (ground.node.kind === 'terrain' ? terrainHeightAt(ground.node.geometry, local.x, local.z) : 0)
}
/**
 * Conservative boxes only reject pairs (sweep and prune on X). Triangle intersections and bounded
 * containment refine candidates. Objects resting on terrain/floor planes, static parts of one assembly and non-collidable decoration count as contacts. Interaction-driven animations are sampled from rest to their end pose.
 */
export function inspectSceneGeometry(doc: ThreeSceneDocument, options: { maxPairs?: number; maxMilliseconds?: number } = {}): SceneInspection {
  const started = performance.now(), maxPairs = options.maxPairs ?? 20000, maxMilliseconds = options.maxMilliseconds ?? 20000
  const fractions = doc.nodes.some((node) => node.animation.kind !== 'none') ? [0, 0.25, 0.5, 0.75] : [0]
  const sampledTimes = fractions.map((t) => t * doc.timeline.duration)
  const geometryCache = new Map<string, THREE.BufferGeometry>(), trees = new Map<string, MeshBVH>(), issues = new Map<string, SceneIntersection>()
  let checkedPairs = 0, skippedContacts = 0, assemblyContacts = 0, complete = true, iterations = 0
  const nodesById = new Map(doc.nodes.map((node) => [node.id, node]))
  const ancestors = (node: SceneNode) => { const chain: SceneNode[] = []; for (let current = node.parentId ? nodesById.get(node.parentId) : undefined; current; current = current.parentId ? nodesById.get(current.parentId) : undefined) chain.push(current); return chain }
  /** Parts under a shared group that do not move relative to each other belong to one assembly. */
  const sameAssembly = (a: SceneNode, b: SceneNode) => {
    const chainA = ancestors(a), chainB = new Set(ancestors(b).map((node) => node.id))
    const common = chainA.find((node) => chainB.has(node.id))
    if (!common) return false
    const moves = (node: SceneNode) => { for (let current: SceneNode | undefined = node; current && current.id !== common.id; current = current.parentId ? nodesById.get(current.parentId) : undefined) if (current.animation.kind !== 'none') return true; return false }
    return !moves(a) && !moves(b)
  }
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
    timeLoop: for (const [sample, time] of sampledTimes.entries()) {
      const transforms = new Map<string, THREE.Matrix4>(), shown = new Map<string, boolean>(), byId = new Map(doc.nodes.map((node) => [node.id, node]))
      const triggered = sampledTimes.length > 1 ? sample / (sampledTimes.length - 1) : 0
      const matrix = (node: SceneNode): THREE.Matrix4 => {
        if (transforms.has(node.id)) return transforms.get(node.id)!
        const pose = sampleNodeTransform(node, time, triggered)
        const local = new THREE.Matrix4().compose(new THREE.Vector3(...pose.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])), new THREE.Vector3(...pose.scale))
        const parent = node.parentId ? byId.get(node.parentId)! : null
        const world = parent ? matrix(parent).clone().multiply(local) : local
        transforms.set(node.id, world)
        shown.set(node.id, node.visible && (!parent || shown.get(parent.id)!))
        return world
      }
      const meshes = doc.nodes.filter((node) => hasSurface(node.kind)).map((node) => {
        const world = matrix(node).clone().scale(new THREE.Vector3(...node.dimensions))
        return { node, matrix: world, bounds: geometry(node).boundingBox!.clone().applyMatrix4(world) }
      }).filter((mesh) => shown.get(mesh.node.id)).sort((a, b) => a.bounds.min.x - b.bounds.min.x)
      for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length && meshes[j].bounds.min.x <= meshes[i].bounds.max.x; j++) {
        if ((++iterations & 255) === 0 && performance.now() - started > maxMilliseconds) { complete = false; break timeLoop }
        const a = meshes[i], b = meshes[j]
        if (!a.bounds.intersectsBox(b.bounds)) continue
        const overlap = a.bounds.clone().intersect(b.bounds).getSize(new THREE.Vector3())
        if (Math.min(overlap.x, overlap.y, overlap.z) < 1e-5) continue // contact without volumetric overlap
        if (a.node.overlapWith.includes(b.node.id) || b.node.overlapWith.includes(a.node.id) || restsOn(a, b) || restsOn(b, a)) { skippedContacts++; continue }
        if (sameAssembly(a.node, b.node)) { assemblyContacts++; continue }
        if (a.node.collidable === false || b.node.collidable === false) { skippedContacts++; continue } // decorative clipping (foliage, particles, flames) is accepted
        if (checkedPairs >= maxPairs || performance.now() - started > maxMilliseconds) { complete = false; break timeLoop }
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
    const surfaces=complete?inspectSurfaceConflicts(doc,{maxMilliseconds:Math.max(1,Math.min(4000,maxMilliseconds-(performance.now()-started)))}):{conflicts:[],complete:false}
    return { intersections: [...issues.values()], sampledTimes, checkedPairs, skippedContacts, assemblyContacts, complete, elapsedMs: performance.now() - started,surfaceConflicts:surfaces.conflicts,surfaceCheckComplete:surfaces.complete }
  } finally { for (const value of geometryCache.values()) value.dispose() }
}
export function intersectionKey(issue: Pick<SceneIntersection,'a'|'b'>): string { return [issue.a, issue.b].sort().join('\u0000') }
export function repairImproved(before: SceneInspection, after: SceneInspection): boolean {
  const original = new Set(before.intersections.map(intersectionKey))
  const surfaces=new Set((before.surfaceConflicts??[]).map(intersectionKey)),beforeCount=before.intersections.length+(before.surfaceConflicts?.length??0),afterCount=after.intersections.length+(after.surfaceConflicts?.length??0)
  return after.complete && after.surfaceCheckComplete!==false && afterCount<beforeCount && after.intersections.every(issue=>original.has(intersectionKey(issue))) && (after.surfaceConflicts??[]).every(issue=>surfaces.has(intersectionKey(issue)))
}
