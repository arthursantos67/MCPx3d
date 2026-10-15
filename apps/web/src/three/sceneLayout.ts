import * as THREE from 'three'
import { hasSurface, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { terrainHeightAt } from './sceneGeometrySpec.ts'
import type { SceneInspection } from './sceneInspection.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { conformTerrainPaths } from './sceneGrounding.ts'
import { MeshBVH } from 'three-mesh-bvh'
import { buildNodeGeometry } from './sceneGeometry.ts'
import { buildingPlan } from './sceneArchitecture.ts'
import { inspectGroundQuality } from './sceneGroundQuality.ts'

export interface LayoutResult { document: ThreeSceneDocument; moved: number; grounded: number; removed: string[]; relocated: number }
/** Quality problems a player would notice, besides intersections. Names are capped for display. */
export interface SceneAudit { overlaps: number; inWater: string[]; floating: string[]; buried: string[]; uneven: string[]; unreachable: string[]; spawnInWater: boolean; total: number; surfaceConflicts?: string[]; groundProblems?:string[] }
export interface PrepareResult { document: ThreeSceneDocument; flattened: number; rescued: number; removed: number; grounded: number; spawnMoved: boolean }
const unitBox = () => new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
const isGround = (node: SceneNode) => node.kind === 'terrain' || node.kind === 'plane'
const REACH = 2, JUMPABLE = 1.2

/**
 * Shared analysis. A unit is a top-level object: a root group with its subtree, or root meshes linked by declared
 * contacts (trunk + crown). Ground (terrain/planes) and very large units are fixed; `movable` restricts edits.
 */
function layoutContext(doc: ThreeSceneDocument, movable?: Set<string>) {
  const nodes = doc.nodes.map((node) => ({ ...node, position: [...node.position] as Vector3Tuple }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const rootOf = (node: SceneNode): SceneNode => { let current = node; for (let depth = 0; current.parentId && depth < 16; depth++) current = byId.get(current.parentId) ?? current; return current }
  const parent = new Map<string, string>()
  const find = (id: string): string => { let current = id; while (parent.get(current) && parent.get(current) !== current) current = parent.get(current)!; return current }
  for (const node of nodes) parent.set(rootOf(node).id, rootOf(node).id)
  for (const node of nodes) if (!node.parentId && !isGround(node)) for (const other of node.overlapWith) {
    const target = byId.get(other)
    if (target && !target.parentId && !isGround(target)) parent.set(find(target.id), find(node.id))
  }
  const unitOf = (node: SceneNode) => find(rootOf(node).id)
  const matrices = sceneMatrices({ ...doc, nodes })
  const boxes = new Map<string, THREE.Box3>()
  for (const node of nodes) if (hasSurface(node.kind) && node.visible) boxes.set(node.id, unitBox().applyMatrix4(matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))))
  const members = new Map<string, SceneNode[]>()
  for (const node of nodes) members.set(unitOf(node), [...members.get(unitOf(node)) ?? [], node])
  const architecture = (node: SceneNode) => {
    for(let current: SceneNode | undefined=node; current; current=current.parentId?byId.get(current.parentId):undefined) if(current.asset?.type==='house') return current
    return null
  }
  const containsArchitecture = (unit: string) => (members.get(unit) ?? []).some(node=>node.asset?.type==='house')
  let individualMoves = false
  const moveNode = (node: SceneNode, delta: THREE.Vector3) => {
    const local = delta.clone()
    if(node.parentId) local.applyMatrix3(new THREE.Matrix3().setFromMatrix4(matrices.get(node.parentId)!.clone().invert()))
    node.position=node.position.map((v,i)=>Math.round((v+local.getComponent(i))*1e4)/1e4) as Vector3Tuple
    boxes.get(node.id)?.translate(delta)
    individualMoves=true
  }
  const unitBounds = (unit: string) => { const box = new THREE.Box3(); for (const node of members.get(unit) ?? []) { const own = boxes.get(node.id); if (own) box.union(own) } return box }
  /** Footprint of the solid parts only: light beams, foliage and particles do not define where a building stands. */
  const solidBounds = (unit: string) => { const box = new THREE.Box3(); for (const node of members.get(unit) ?? []) { const own = boxes.get(node.id); if (own && node.collidable !== false) box.union(own) } return box.isEmpty() ? unitBounds(unit) : box }
  const fixed = new Set<string>()
  for (const [unit, list] of members) {
    const bounds = unitBounds(unit), size = bounds.getSize(new THREE.Vector3())
    if (list.some((node) => isGround(node) || node.role === 'path') || bounds.isEmpty() || size.x * size.z > 900 || (movable && !list.some((node) => movable.has(node.id)))) fixed.add(unit)
  }
  let waterLevel: number | null = null
  for (const node of nodes) if (node.kind === 'plane' && !node.parentId && node.material.texture === 'water') waterLevel = Math.max(waterLevel ?? -Infinity, node.position[1])
  const grounds = nodes.filter((node) => isGround(node) && node.visible && node.material.texture !== 'water').map((node) => {
    const matrix = matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))
    return { node, matrix, inverse: matrix.clone().invert() }
  })
  const surfaceBelow = (x: number, z: number, from = 1e6): number | null => {
    let best: number | null = null
    for (const ground of grounds) {
      const local = new THREE.Vector3(x, from, z).applyMatrix4(ground.inverse)
      if (Math.abs(local.x) > 0.5 || Math.abs(local.z) > 0.5) continue
      const height = new THREE.Vector3(local.x, ground.node.kind === 'terrain' ? terrainHeightAt(ground.node.geometry, local.x, local.z) : 0, local.z).applyMatrix4(ground.matrix).y
      if (best === null || Math.abs(height - from) < Math.abs(best - from)) best = height
    }
    return best
  }
  const onLand = (x: number, z: number) => { const height = surfaceBelow(x, z); return height !== null && (waterLevel === null || height > waterLevel + 0.2) }
  const shift = new Map<string, THREE.Vector3>(), removed = new Set<string>()
  const translate = (unit: string, delta: THREE.Vector3) => {
    shift.set(unit, (shift.get(unit) ?? new THREE.Vector3()).add(delta))
    for (const node of members.get(unit) ?? []) boxes.get(node.id)?.translate(delta)
  }
  const declaresGround = (unit: string) => (members.get(unit) ?? []).some((node) => node.overlapWith.some((id) => { const other = byId.get(id); return !!other && isGround(other) }))
  /** Non-collidable decoration (fireflies, particles, hovering effects) may float by design. */
  const decorative = (unit: string) => (members.get(unit) ?? []).filter((node) => hasSurface(node.kind)).every((node) => node.collidable === false)
  const rest = (unit: string, force = false) => {
    if (fixed.has(unit) || removed.has(unit)) return false
    if (!force && (declaresGround(unit) || decorative(unit))) return false
    const bounds = unitBounds(unit)
    if (bounds.isEmpty()) return false
    const center = bounds.getCenter(new THREE.Vector3()), height = bounds.max.y - bounds.min.y
    const surface = surfaceBelow(center.x, center.z, bounds.min.y)
    if (surface === null) return false
    const gap = bounds.min.y - surface
    if ((!force && (gap > 1.5 || gap < -height * 0.9)) || Math.abs(gap) < 0.02) return false
    translate(unit, new THREE.Vector3(0, -gap, 0))
    return true
  }
  const removable = (unit: string) => {
    const list = members.get(unit) ?? [], size = unitBounds(unit).getSize(new THREE.Vector3())
    return /~\d+$/.test(unit) && size.x * size.z < 30 && list.every((node) => !node.interaction && !node.behavior && node.kind !== 'light')
  }
  const rescue = (unit: string, maxRadius = 40) => {
    const center = unitBounds(unit).getCenter(new THREE.Vector3())
    for (let radius = 1.5; radius <= maxRadius; radius += 1.5) for (let k = 0; k < 16; k++) {
      const x = center.x + Math.cos(k * Math.PI / 8) * radius, z = center.z + Math.sin(k * Math.PI / 8) * radius
      if (onLand(x, z)) { translate(unit, new THREE.Vector3(x - center.x, 0, z - center.z)); return true }
    }
    return false
  }
  /** Highest walkable floor under a point: terrain, or a static top reachable by a jump or a nearby ladder. */
  const climbables = nodes.filter((node) => node.behavior?.type === 'climbable').map((node) => boxes.get(node.id)).filter((box): box is THREE.Box3 => !!box)
  const floorTrees = new Map<string,MeshBVH>()
  const floorUnder = (unit: string, center: THREE.Vector3, below: number, includeOwn = false) => {
    const terrain = surfaceBelow(center.x, center.z)
    let floor = terrain ?? -Infinity
    for (const [otherUnit, otherList] of members) {
      if ((!includeOwn && otherUnit === unit) || removed.has(otherUnit)) continue
      for (const node of otherList) {
        const box = boxes.get(node.id)
        if (!box || node.collidable === false || isGround(node) || center.x < box.min.x || center.x > box.max.x || center.z < box.min.z || center.z > box.max.z) continue
        let top = box.max.y
        const owner=architecture(node), delta=shift.get(otherUnit) ?? new THREE.Vector3()
        if(node.kind==='mesh' && owner) {
          // A batch can contain both floors and a ceiling: its bounding-box top is not a floor query.
          if(!floorTrees.has(node.id)) floorTrees.set(node.id,new MeshBVH(buildNodeGeometry(node)))
          const matrix=matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))
          matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(matrix).add(delta))
          const ray=new THREE.Ray(new THREE.Vector3(center.x,below+0.05,center.z),new THREE.Vector3(0,-1,0)).applyMatrix4(matrix.clone().invert())
          const normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix)
          top=-Infinity
          for(const hit of floorTrees.get(node.id)!.raycast(ray,THREE.DoubleSide)) {
            if(!hit.face || hit.face.normal.clone().applyNormalMatrix(normalMatrix).y<0.55) continue
            top=Math.max(top,hit.point.clone().applyMatrix4(matrix).y)
          }
        }
        if(!Number.isFinite(top) || top>below+0.05) continue
        const highestFloor=owner ? new THREE.Vector3(0,(0.22+3.35*(buildingPlan(owner.asset!).floors-1))*owner.asset!.size,0).applyMatrix4(matrices.get(owner.id)!).add(delta).y : -Infinity
        const reachable = terrain === null || top - terrain <= JUMPABLE || (owner && top<=highestFloor+JUMPABLE) || climbables.some((ladder) => ladder.max.y >= top - 0.5 && Math.hypot(ladder.getCenter(new THREE.Vector3()).x - center.x, ladder.getCenter(new THREE.Vector3()).z - center.z) < 8)
        if (reachable) floor = Math.max(floor, top)
      }
    }
    return floor
  }
  const isStructure = (unit: string) => {
    const list = members.get(unit) ?? [], root = byId.get(unit), size = solidBounds(unit).getSize(new THREE.Vector3())
    if (root?.role && root.role !== 'structure') return false
    return root?.kind === 'group' && size.x * size.z >= 4 && size.y >= 1 && list.filter((node) => hasSurface(node.kind) && node.collidable !== false).length >= 2 && !list.some((node) => node.behavior?.type === 'enemy')
  }
  const unevenness = (unit: string) => {
    const bounds = solidBounds(unit), heights = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => surfaceBelow(
      (bounds.min.x + bounds.max.x) / 2 + dx * (bounds.max.x - bounds.min.x) / 2, (bounds.min.z + bounds.max.z) / 2 + dz * (bounds.max.z - bounds.min.z) / 2)).filter((value): value is number => value !== null)
    return heights.length ? Math.max(...heights) - Math.min(...heights) : 0
  }
  /** A structure dug into the ground (plinth, foundation reaching below the lowest terrain under it) already handles the slope. */
  const hasFooting = (unit: string) => {
    const bounds = solidBounds(unit), heights = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([dx, dz]) => surfaceBelow((bounds.min.x + bounds.max.x) / 2 + dx * (bounds.max.x - bounds.min.x) / 2, (bounds.min.z + bounds.max.z) / 2 + dz * (bounds.max.z - bounds.min.z) / 2)).filter((value): value is number => value !== null)
    return heights.length > 0 && bounds.min.y < Math.min(...heights) - 0.1
  }
  const finish = (): ThreeSceneDocument => {
    if (!shift.size && !removed.size && !individualMoves) return doc
    for (const [unit, delta] of shift) for (const node of members.get(unit) ?? []) if (!node.parentId) for (let i = 0; i < 3; i++) node.position[i] = Math.round((node.position[i] + delta.getComponent(i)) * 1e4) / 1e4
    const dropped = new Set([...removed].flatMap((unit) => (members.get(unit) ?? []).map((node) => node.id)))
    const kept = nodes.filter((node) => !dropped.has(node.id)).map((node) => node.overlapWith.some((id) => dropped.has(id)) ? { ...node, overlapWith: node.overlapWith.filter((id) => !dropped.has(id)) } : node)
    return { ...doc, nodes: kept }
  }
  return { nodes, byId, unitOf, members, boxes, unitBounds, fixed, waterLevel, grounds, surfaceBelow, onLand, translate, rest, removed, removable, rescue, floorUnder, isStructure, unevenness, hasFooting, declaresGround, decorative, solidBounds, shift, finish, containsArchitecture, moveNode }
}

/** Lists what a player would notice: objects in water, floating or buried, structures on uneven ground, unreachable collectibles. */
export function auditScene(doc: ThreeSceneDocument, inspection: SceneInspection | null): SceneAudit {
  const context = layoutContext(doc)
  const audit: SceneAudit = { overlaps: inspection?.intersections.length ?? 0, inWater: [], floating: [], buried: [], uneven: [], unreachable: [], spawnInWater: false, total: 0 }
  for (const [unit, list] of context.members) {
    if (context.fixed.has(unit) || !list.some((node) => hasSurface(node.kind))) continue
    const bounds = context.unitBounds(unit), center = bounds.getCenter(new THREE.Vector3()), height = bounds.max.y - bounds.min.y, name = context.byId.get(unit)?.name ?? unit
    const surface = context.surfaceBelow(center.x, center.z, bounds.min.y)
    if (surface === null) continue
    const wet = context.waterLevel !== null && surface < context.waterLevel && bounds.min.y < context.waterLevel - 0.3
    const gap = bounds.min.y - surface
    if (wet) audit.inWater.push(name)
    else if (gap > 0.15 && gap <= 1.5 && !list.some((node) => node.interaction?.action === 'collect') && !context.decorative(unit) && context.floorUnder(unit, center, bounds.min.y) < bounds.min.y - 0.15) audit.floating.push(name)
    else if (gap < -0.3 && gap < -height * 0.3 && center.y < surface + 0.1 && !context.declaresGround(unit)) audit.buried.push(name)
    if (context.isStructure(unit) && context.unevenness(unit) > 0.35 && !context.hasFooting(unit)) audit.uneven.push(name)
    if (list.some((node) => node.interaction?.action === 'collect') && !context.containsArchitecture(unit) && (wet || center.y - context.floorUnder(unit, center, bounds.min.y) > REACH)) audit.unreachable.push(name)
  }
  for(const node of context.nodes) if(node.interaction?.action==='collect' && context.containsArchitecture(context.unitOf(node))) {
    const bounds=context.boxes.get(node.id)
    if(!bounds) continue
    const center=bounds.getCenter(new THREE.Vector3()), surface=context.surfaceBelow(center.x,center.z)
    const wet=context.waterLevel!==null && surface!==null && surface<context.waterLevel && bounds.min.y<context.waterLevel-0.3
    if(wet || center.y-context.floorUnder(context.unitOf(node),center,bounds.min.y,true)>REACH) audit.unreachable.push(node.name)
  }
  const spawn = doc.environment.player?.spawn
  if (spawn && context.grounds.length) { const surface = context.surfaceBelow(spawn[0], spawn[2]); audit.spawnInWater = surface !== null && ((context.waterLevel !== null && surface < context.waterLevel + 0.2) || spawn[1] < surface - 0.3) }
  audit.surfaceConflicts=(inspection?.surfaceConflicts??[]).map(issue=>`${issue.nameA} / ${issue.nameB}`)
  audit.groundProblems=inspectGroundQuality(doc)
  audit.total = audit.overlaps + audit.inWater.length + audit.floating.length + audit.buried.length + audit.uneven.length + audit.unreachable.length + (audit.spawnInWater ? 1 : 0) + audit.surfaceConflicts.length+audit.groundProblems.length
  return audit
}

export function describeAudit(audit: SceneAudit): string[] {
  const list = (names: string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? ` e mais ${names.length - 5}` : '')
  return [
    ...(audit.groundProblems??[]),
    audit.overlaps && `${audit.overlaps} pares de objetos sobrepostos`,
    audit.surfaceConflicts?.length && `${audit.surfaceConflicts.length} superfícies disputando a mesma profundidade (${list(audit.surfaceConflicts)})`,
    audit.inWater.length && `${audit.inWater.length} objetos dentro da água (${list(audit.inWater)})`,
    audit.floating.length && `${audit.floating.length} objetos flutuando (${list(audit.floating)})`,
    audit.buried.length && `${audit.buried.length} objetos enterrados (${list(audit.buried)})`,
    audit.uneven.length && `${audit.uneven.length} construções em terreno irregular (${list(audit.uneven)})`,
    audit.unreachable.length && `${audit.unreachable.length} coletáveis fora de alcance (${list(audit.unreachable)})`,
    audit.spawnInWater && 'início do jogador na água ou enterrado',
  ].filter((item): item is string => !!item)
}

/**
 * Fixes that do not need intersections: flatten terrain under structures standing on uneven ground, rescue objects
 * from the water (removing decorative copies without room), rest floating or buried objects and move the spawn to land.
 */
export function prepareScene(doc: ThreeSceneDocument, movable?: Set<string>): PrepareResult {
  const context = layoutContext(conformTerrainPaths(doc), movable)
  let flattened = 0, rescued = 0, grounded = 0, spawnMoved = false
  const terrains = context.nodes.filter((node) => node.kind === 'terrain' && !node.parentId && node.rotation.every((value) => Math.abs(value) < 1e-6))
  for (const [unit] of context.members) {
    if (context.fixed.has(unit) || !context.isStructure(unit) || context.unevenness(unit) <= 0.35 || context.hasFooting(unit)) continue
    const bounds = context.solidBounds(unit), center = bounds.getCenter(new THREE.Vector3())
    const terrain = terrains.find((node) => Math.abs((center.x - node.position[0]) / (node.dimensions[0] * node.scale[0])) < 0.5 && Math.abs((center.z - node.position[2]) / (node.dimensions[2] * node.scale[2])) < 0.5)
    if (!terrain || terrain.geometry.pads.length >= 256) continue
    const radius = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2 + 0.8, width = terrain.dimensions[0] * terrain.scale[0], depth = terrain.dimensions[2] * terrain.scale[2], tall = terrain.dimensions[1] * terrain.scale[1]
    const samples = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4) * radius * 0.7, Math.sin(k * Math.PI / 4) * radius * 0.7])].map(([dx, dz]) => context.surfaceBelow(center.x + dx, center.z + dz)).filter((value): value is number => value !== null)
    if (!samples.length) continue
    const level = samples.reduce((sum, value) => sum + value, 0) / samples.length
    terrain.geometry = { ...terrain.geometry, pads: [...terrain.geometry.pads, [(center.x - terrain.position[0]) / width, (center.z - terrain.position[2]) / depth, Math.min(0.5, radius / width), Math.min(0.5, radius / depth), Math.max(-0.5, Math.min(0.5, (level - terrain.position[1]) / tall))]] }
    context.grounds.find((ground) => ground.node.id === terrain.id)!.node.geometry = terrain.geometry
    flattened++
    context.rest(unit, true)
  }
  for (const [unit, list] of context.members) {
    if (context.fixed.has(unit) || !list.some((node) => hasSurface(node.kind)) || context.waterLevel === null) continue
    const bounds = context.unitBounds(unit), center = bounds.getCenter(new THREE.Vector3()), surface = context.surfaceBelow(center.x, center.z, bounds.min.y)
    if (surface === null || surface >= context.waterLevel || bounds.min.y >= context.waterLevel - 0.3) continue
    if (context.removable(unit)) context.removed.add(unit)
    else if (context.rescue(unit)) { context.rest(unit, true); rescued++ }
  }
  for (const [unit, list] of context.members) if (list.some((node) => hasSurface(node.kind)) && context.rest(unit)) grounded++
  const spawn = doc.environment.player?.spawn
  let environment = doc.environment
  if (spawn && context.grounds.length) {
    const surface = context.surfaceBelow(spawn[0], spawn[2])
    const bad = surface === null ? false : (context.waterLevel !== null && surface < context.waterLevel + 0.2) || spawn[1] < surface - 0.3
    if (bad) {
      let point: Vector3Tuple | null = null
      search: for (let radius = 0; radius <= 120; radius += 2) for (let k = 0; k < (radius ? 24 : 1); k++) {
        const x = spawn[0] + Math.cos(k * Math.PI / 12) * radius, z = spawn[2] + Math.sin(k * Math.PI / 12) * radius
        if (context.onLand(x, z)) { point = [x, context.surfaceBelow(x, z)! + 0.05, z]; break search }
      }
      if (point) { environment = { ...environment, player: { ...environment.player!, spawn: point.map((value) => Math.round(value * 100) / 100) as Vector3Tuple } }; spawnMoved = true }
    }
  }
  const document = context.finish()
  if (document === doc && !flattened && !spawnMoved) return { document: doc, flattened, rescued, removed: 0, grounded, spawnMoved }
  return { document: conformTerrainPaths({ ...(document === doc ? { ...doc, nodes: context.nodes } : document), environment }), flattened, rescued, removed: [...context.removed].length, grounded, spawnMoved }
}

/**
 * Resolves verified intersections by the smallest translation that keeps units on land, moving the smaller unit;
 * decorative copies without room are removed. Collectibles are brought within reach.
 */
export function settleLayout(doc: ThreeSceneDocument, inspection: SceneInspection | null, movable?: Set<string>): LayoutResult {
  const context = layoutContext(doc, movable)
  const { byId, unitOf, boxes, unitBounds, fixed, onLand, translate, rest, removed, removable, members } = context
  const volume = (box: THREE.Box3) => { const size = box.getSize(new THREE.Vector3()); return size.x * size.y * size.z }
  const startedOnLand = new Map([...members.keys()].map((unit) => { const center = unitBounds(unit).getCenter(new THREE.Vector3()); return [unit, onLand(center.x, center.z)] }))
  let grounded = 0
  for (const unit of members.keys()) if (rest(unit)) grounded++
  const moved = new Set<string>()
  for (const issue of inspection?.intersections ?? []) {
    const a = byId.get(issue.a), b = byId.get(issue.b)
    if (!a || !b) continue
    const unitA = unitOf(a), unitB = unitOf(b)
    if (unitA === unitB || removed.has(unitA) || removed.has(unitB) || (fixed.has(unitA) && fixed.has(unitB))) continue
    if (isGround(a) || isGround(b)) { const unit = isGround(a) ? unitB : unitA; if (!moved.has(unit) && rest(unit, true)) grounded++; continue }
    const boxA = boxes.get(a.id), boxB = boxes.get(b.id)
    if (!boxA || !boxB || !boxA.intersectsBox(boxB)) continue
    const moveA = fixed.has(unitB) || (!fixed.has(unitA) && volume(unitBounds(unitA)) <= volume(unitBounds(unitB)))
    const [unit, mover, other] = moveA ? [unitA, boxA, boxB] : [unitB, boxB, boxA]
    const centerMover = mover.getCenter(new THREE.Vector3())
    // Candidate escapes along each axis in both directions, shortest first; vertical only upwards for stacked props.
    const candidates: THREE.Vector3[] = []
    for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
      // A vertical escape on terrain would be immediately undone by rest(), producing an endless no-op repair.
      if (axis === 'y' && (startedOnLand.get(unit) || centerMover.y <= other.getCenter(new THREE.Vector3()).y)) continue
      candidates.push(new THREE.Vector3().setComponent(index, other.max[axis] - mover.min[axis] + 0.05))
      if (axis !== 'y') candidates.push(new THREE.Vector3().setComponent(index, -(mover.max[axis] - other.min[axis] + 0.05)))
    }
    candidates.sort((p, q) => p.length() - q.length())
    const center = unitBounds(unit).getCenter(new THREE.Vector3())
    const valid = candidates.find((delta) => delta.length() < 25 && (!startedOnLand.get(unit) || onLand(center.x + delta.x, center.z + delta.z)))
    if (valid) { translate(unit, valid); moved.add(unit) }
    else if (removable(unit)) removed.add(unit)
  }
  for (const unit of moved) rest(unit, true)
  // Collectibles must be reachable on foot: on land, and at most a jump above the floor or a climbable platform.
  let relocated = 0
  for (const [unit, list] of members) {
    if (removed.has(unit) || fixed.has(unit) || !list.some((node) => node.interaction?.action === 'collect')) continue
    if(context.containsArchitecture(unit)) {
      // Repair a reward inside a building without translating the building and all its occupants.
      for(const node of list) if(node.interaction?.action==='collect') {
        const bounds=boxes.get(node.id)
        if(!bounds) continue
        const center=bounds.getCenter(new THREE.Vector3()), floor=context.floorUnder(unit,center,bounds.min.y,true)
        if(Number.isFinite(floor) && center.y-floor>REACH) { context.moveNode(node,new THREE.Vector3(0,floor+1.1-center.y,0)); relocated++ }
      }
      continue
    }
    let bounds = unitBounds(unit), center = bounds.getCenter(new THREE.Vector3())
    if (context.grounds.length && !onLand(center.x, center.z) && context.rescue(unit)) { relocated++; bounds = unitBounds(unit); center = bounds.getCenter(new THREE.Vector3()) }
    const floor = context.floorUnder(unit, center, bounds.min.y)
    if (Number.isFinite(floor) && center.y - floor > REACH) { translate(unit, new THREE.Vector3(0, floor + 1.1 - center.y, 0)); relocated++ }
  }
  const document = context.finish()
  if (document === doc) return { document: doc, moved: 0, grounded: 0, removed: [], relocated: 0 }
  return { document, moved: moved.size, grounded, removed: [...removed], relocated }
}
