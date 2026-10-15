import { Box3, Vector3 } from 'three'
import { createNode, MAX_SCENE_NODES, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { estimateTriangles, MAX_SCENE_TRIANGLES, terrainHeightAt } from './sceneGeometrySpec.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { buildingPlan } from './sceneArchitecture.ts'
import { conformTerrainPaths } from './sceneGrounding.ts'
import type { ScenePlan } from './scenePlanning.ts'
import { isStructuredTopology, sceneIntent } from './sceneDirection.ts'

type Point = [number, number]
type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number }
/** Visibility-graph routing around building envelopes; never cuts a planned street through a house. */
function routeAroundBuildings(from: Point, to: Point, obstacles: Footprint[], contains: (point: Point) => boolean): Point[] | null {
  const inside = (p: Point, box: Footprint) => p[0] > box.minX + 1e-5 && p[0] < box.maxX - 1e-5 && p[1] > box.minZ + 1e-5 && p[1] < box.maxZ - 1e-5
  const free = (p: Point) => contains(p) && obstacles.every(box => !inside(p, box))
  const endpoint = (p: Point): Point | null => {
    if (free(p)) return p
    const candidates: Point[] = []
    for (const box of obstacles) if (inside(p, box)) candidates.push([box.minX, p[1]], [box.maxX, p[1]], [p[0], box.minZ], [p[0], box.maxZ])
    return candidates.filter(free).sort((a, b) => Math.hypot(a[0] - p[0], a[1] - p[1]) - Math.hypot(b[0] - p[0], b[1] - p[1]))[0] ?? null
  }
  const start = endpoint(from), end = endpoint(to)
  if (!start || !end) return null
  const vertices: Point[] = [start, end]
  for (const box of obstacles) for (const x of [box.minX, box.maxX]) for (const z of [box.minZ, box.maxZ]) if (free([x, z])) vertices.push([x, z])
  const clear = (a: Point, b: Point) => obstacles.every(box => {
    let lo = 0, hi = 1
    for (const [axis, min, max] of [[0, box.minX + 1e-4, box.maxX - 1e-4], [1, box.minZ + 1e-4, box.maxZ - 1e-4]]) {
      const delta = b[axis] - a[axis]
      if (Math.abs(delta) < 1e-8) { if (a[axis] < min || a[axis] > max) return true; continue }
      const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2))
      if (lo > hi) return true
    }
    return false
  })
  const distances = vertices.map(() => Infinity), previous = vertices.map(() => -1), visited = new Set<number>()
  distances[0] = 0
  while (visited.size < vertices.length) {
    let current = -1
    for (let i = 0; i < vertices.length; i++) if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i
    if (current < 0 || !Number.isFinite(distances[current])) return null
    if (current === 1) break
    visited.add(current)
    for (let i = 0; i < vertices.length; i++) if (!visited.has(i) && clear(vertices[current], vertices[i])) {
      const candidate = distances[current] + Math.hypot(vertices[current][0] - vertices[i][0], vertices[current][1] - vertices[i][1])
      if (candidate < distances[i]) { distances[i] = candidate; previous[i] = current }
    }
  }
  const path: Point[] = []
  for (let index = 1; index >= 0; index = previous[index]) path.unshift(vertices[index])
  return path.length > 1 && path.length <= 64 ? path : null
}

/** Deterministic compiler handoff. A missing route is geometry to build, rather than a second prose request. */
export function applyScenePlanIntent(scene: ThreeSceneDocument, plan: ScenePlan,request=''): { document: ThreeSceneDocument; notes: string[] } {
  const byId = new Map(scene.nodes.map(node => [node.id, node])), matrices = sceneMatrices(scene), notes: string[] = []
  const visible = (node: SceneNode): boolean => node.visible && (!node.parentId || visible(byId.get(node.parentId)!))
  const supports = scene.nodes.filter(node => visible(node) && !node.parentId && node.rotation.every(value => value === 0) && (node.kind === 'terrain' || node.kind === 'plane') && node.role !== 'path' && node.material.texture !== 'water')
    .sort((a, b) => b.dimensions[0] * b.dimensions[2] - a.dimensions[0] * a.dimensions[2])
  const support = supports[0]
  const outdoor=!request||!isStructuredTopology(sceneIntent(request).topology)
  let document = scene
  if (outdoor && support?.kind === 'terrain' && plan.terrain.biome !== 'none' && (!support.geometry.biome || support.geometry.biome === 'none') && !support.material.textureImage && ['none', 'grass', 'rock', 'sand'].includes(support.material.texture ?? 'none')) {
    document = { ...document, nodes: document.nodes.map(node => node.id === support.id ? { ...node, geometry: { ...node.geometry, biome: plan.terrain.biome } } : node) }
    notes.push(`O bioma ${plan.terrain.biome} do plano foi aplicado ao terreno sem bioma; cores e materiais personalizados foram preservados.`)
  }
  if (outdoor && support && !scene.nodes.some(node => visible(node) && (node.role === 'path' || node.path))) {
    const ids = new Set(scene.nodes.map(node => node.id)), roads: SceneNode[] = []
    for (const [index, route] of plan.routes.entries()) {
      if (document.nodes.length + roads.length >= MAX_SCENE_NODES) { notes.push('O orçamento de objetos impediu materializar todas as rotas planejadas.'); break }
      const from = plan.zones.find(zone => zone.id === route.from)!, to = plan.zones.find(zone => zone.id === route.to)!
      const margin = route.width / 2 + 0.65
      const obstacles = scene.nodes.filter(node => visible(node) && node.asset?.type === 'house').map(node => {
        const building = buildingPlan(node.asset!), box = new Box3(new Vector3(-building.width / 2, 0, -building.depth / 2), new Vector3(building.width / 2, 1, building.depth / 2)).applyMatrix4(matrices.get(node.id)!).expandByScalar(margin)
        return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z }
      })
      const inverse = matrices.get(support.id)!.clone().scale(new Vector3(...support.dimensions)).invert()
      const points = routeAroundBuildings(from.center, to.center, obstacles, point => { const local = new Vector3(point[0], support.position[1], point[1]).applyMatrix4(inverse); return Math.abs(local.x) <= 0.5 - margin / support.dimensions[0] && Math.abs(local.z) <= 0.5 - margin / support.dimensions[2] })
      if (!points) { notes.push(`A rota ${from.name} → ${to.name} não coube entre as construções; a revisão mantém esse problema explícito.`); continue }
      let id = `planned-route-${index + 1}`
      while (ids.has(id)) id += '-path'
      ids.add(id)
      const road = createNode('mesh')
      roads.push({ ...road, id, name: `Caminho: ${from.name} → ${to.name}`, role: 'path', collidable: true,
        path: { supportId: support.id, points, width: route.width },
        material: { ...road.material, color: '#8e7961', texture: 'rock', textureScale: 1.5, roughness: 0.98, normalStrength: 0.65 } })
    }
    if (roads.length) {
      const compiled = conformTerrainPaths({ ...document, nodes: [...document.nodes, ...roads] })
      if (compiled.nodes.reduce((sum, node) => sum + estimateTriangles(node.kind, node.geometry), 0) <= MAX_SCENE_TRIANGLES) {
        document = compiled
        notes.push(`O compilador materializou ${roads.length} rotas do plano espacial; o construtor não forneceu caminhos.`)
      } else notes.push('As rotas planejadas excederiam o orçamento de triângulos; a revisão mantém a falta de caminhos explícita.')
    }
  }
  const arrival = plan.zones.find(zone => zone.id === plan.spawnZoneId)!, authored = scene.environment.player?.spawn
  if (!authored && support) {
    const supportMatrix = matrices.get(support.id)!.clone().scale(new Vector3(...support.dimensions)), inverse = supportMatrix.clone().invert()
    const bounds = new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5))
    const obstacles = scene.nodes.filter(node => visible(node) && node.collidable !== false && !['terrain', 'plane', 'group', 'light', 'text'].includes(node.kind) && node.role !== 'path' && node.interaction?.action !== 'collect' && !node.material.transparent)
      .map(node => bounds.clone().applyMatrix4(matrices.get(node.id)!.clone().scale(new Vector3(...node.dimensions))).expandByScalar(0.5))
    const dangers = scene.nodes.filter(node => visible(node) && ['hazard', 'enemy'].includes(node.behavior?.type ?? ''))
      .map(node => ({ point: new Vector3().setFromMatrixPosition(matrices.get(node.id)!), radius: Math.max(5, node.behavior?.type === 'enemy' ? node.behavior.range + 1 : 5) }))
    let spawn: Vector3Tuple | null = null
    // Search the arrival zone, respecting actual ground and building bounds. No spawn at the house's origin.
    for (let ring = 0; ring <= 8 && !spawn; ring++) for (let step = 0; step < Math.max(1, ring * 12); step++) {
      const radius = arrival.radius * 0.85 * ring / 8, angle = step * Math.PI * 2 / Math.max(1, ring * 12)
      const x = arrival.center[0] + Math.cos(angle) * radius, z = arrival.center[1] + Math.sin(angle) * radius
      const local = new Vector3(x, support.position[1], z).applyMatrix4(inverse)
      if (Math.abs(local.x) > 0.49 || Math.abs(local.z) > 0.49) continue
      const point = new Vector3(local.x, support.kind === 'terrain' ? terrainHeightAt(support.geometry, local.x, local.z) : 0, local.z).applyMatrix4(supportMatrix)
      const blocked = obstacles.some(box => point.x >= box.min.x && point.x <= box.max.x && point.z >= box.min.z && point.z <= box.max.z && box.max.y > point.y + 0.2 && box.min.y < point.y + 1.85)
      const danger = dangers.some(danger => danger.point.distanceTo(point) < danger.radius)
      if (!blocked && !danger) { spawn = [point.x, point.y + 0.06, point.z]; break }
    }
    if (spawn) {
      const destination = plan.zones.find(zone => zone.id !== arrival.id)!
      document = { ...document, environment: { ...document.environment, player: { yaw: Math.atan2(spawn[0] - destination.center[0], spawn[2] - destination.center[1]) * 180 / Math.PI, speed: 4.5, jumpHeight: 1.1, mode: 'walk', ...document.environment.player, spawn } } }
      notes.push(`O início ausente foi definido em terra firme na zona ${arrival.name}.`)
    }
  }
  return { document, notes }
}
