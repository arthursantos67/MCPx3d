import * as THREE from 'three'
import type { NavMesh, NavMeshQuery } from 'recast-navigation'

export interface NavigationAgent { radius: number; height: number; climb: number }
export interface NavigationMesh {
  /** Straight (string-pulled) corridor from `from` to `to`, both snapped to the mesh; null when no polygon is near either end. */
  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null
  closest(point: THREE.Vector3): THREE.Vector3 | null
  /** Whether the straight segment stays on walkable polygons (short-range shortcut test). */
  clear(from: THREE.Vector3, to: THREE.Vector3): boolean
  dispose(): void
  triangles: number
  bounds: THREE.Box3
  /** Wall-clock generation time, measured around the Recast build only. */
  milliseconds: number
}
export interface NavigationInput { positions: Float32Array; indices: Uint32Array; bounds: [[number, number, number], [number, number, number]]; config: Record<string, number> }

export const NAVIGATION_LIMITS = { maxCells: 1_200_000, maxTriangles: 600_000, minCell: 0.12, maxCell: 0.6, queryReach: [2.5, 3, 2.5] as const }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Recast voxel settings sized to the focus area, so a huge level costs at most `maxCells` columns. */
export function navigationConfig(focus: THREE.Box3, agent: NavigationAgent): Record<string, number> {
  const size = focus.getSize(new THREE.Vector3()), area = Math.max(1, size.x * size.z)
  const cs = clamp(Math.max(agent.radius / 2, Math.sqrt(area / NAVIGATION_LIMITS.maxCells)), NAVIGATION_LIMITS.minCell, NAVIGATION_LIMITS.maxCell)
  const ch = clamp(agent.climb / 3, 0.05, cs)
  return { cs, ch, walkableSlopeAngle: 56, walkableHeight: Math.max(3, Math.ceil(agent.height / ch)), walkableClimb: Math.max(1, Math.floor(agent.climb / ch)),
    walkableRadius: Math.max(1, Math.ceil(agent.radius / cs)), maxEdgeLen: Math.round(12 / cs), maxSimplificationError: 1.3, minRegionArea: 8, mergeRegionArea: 20,
    maxVertsPerPoly: 6, detailSampleDist: cs * 6, detailSampleMaxError: ch, borderSize: 0 }
}

/** World-space triangles touching the focus box (plus an optional safety floor), ready for Recast. Pure and worker-transferable. */
export function navigationInput(entries: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[], focus: THREE.Box3, agent: NavigationAgent, options: { floor?: number } = {}): NavigationInput | null {
  if (focus.isEmpty()) return null
  const config = navigationConfig(focus, agent), margin = config.cs * 2
  const clip = focus.clone().expandByVector(new THREE.Vector3(margin, agent.height, margin))
  const positions: number[] = [], indices: number[] = [], point = new THREE.Vector3(), triangle = new THREE.Box3()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (const { geometry, matrix } of entries) {
    const position = geometry.getAttribute('position'), index = geometry.index
    if (!position) continue
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (!triangle.copy(geometry.boundingBox!).applyMatrix4(matrix).intersectsBox(clip)) continue
    const world = new Float32Array(position.count * 3), remap = new Int32Array(position.count).fill(-1)
    for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i).applyMatrix4(matrix); world[i * 3] = point.x; world[i * 3 + 1] = point.y; world[i * 3 + 2] = point.z }
    const count = index ? index.count : position.count
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2]
      a.fromArray(world, ids[0] * 3); b.fromArray(world, ids[1] * 3); c.fromArray(world, ids[2] * 3)
      if (!triangle.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c).intersectsBox(clip)) continue
      if (indices.length / 3 >= NAVIGATION_LIMITS.maxTriangles) break
      for (const id of ids) {
        if (remap[id] < 0) { remap[id] = positions.length / 3; positions.push(world[id * 3], world[id * 3 + 1], world[id * 3 + 2]) }
        indices.push(remap[id])
      }
    }
  }
  if (options.floor !== undefined && Number.isFinite(options.floor)) {
    // Mirrors the collider's universal safety floor, which enemies may walk on where no mesh supports them.
    const y = options.floor, base = positions.length / 3
    positions.push(clip.min.x, y, clip.min.z, clip.max.x, y, clip.min.z, clip.max.x, y, clip.max.z, clip.min.x, y, clip.max.z)
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  if (!indices.length) return null
  // Recast treats counter-clockwise triangles seen from above as walkable floors; three.js front faces already are.
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), config,
    bounds: [[clip.min.x, clip.min.y, clip.min.z], [clip.max.x, clip.max.y, clip.max.z]] }
}

type Recast = typeof import('recast-navigation') & typeof import('recast-navigation/generators')
let recast: Promise<Recast> | null = null
/** The WASM module ships inside the bundle (wasm-compat build), loaded lazily in its own chunk and initialised once. */
export function loadRecast(): Promise<Recast> {
  recast ??= Promise.all([import('recast-navigation'), import('recast-navigation/generators')]).then(async ([core, generators]) => { await core.init(); return { ...core, ...generators } })
  return recast
}

function wrap(module: Recast, navMesh: NavMesh, bounds: THREE.Box3, milliseconds: number): NavigationMesh {
  const query: NavMeshQuery = new module.NavMeshQuery(navMesh), reach = { x: NAVIGATION_LIMITS.queryReach[0], y: NAVIGATION_LIMITS.queryReach[1], z: NAVIGATION_LIMITS.queryReach[2] }
  let disposed = false
  const [, indices] = module.getNavMeshPositionsAndIndices(navMesh)
  const closest = (point: THREE.Vector3) => {
    if (disposed) return null
    const result = query.findClosestPoint(point, { halfExtents: reach })
    return result.success && result.polyRef ? new THREE.Vector3(result.point.x, result.point.y, result.point.z) : null
  }
  return {
    triangles: indices.length / 3, bounds, milliseconds,
    closest,
    path(from, to) {
      if (disposed) return null
      const result = query.computePath(from, to, { halfExtents: reach, maxPathPolys: 512, maxStraightPathPoints: 128 })
      if (!result.success || !result.path.length) return null
      return result.path.map((p) => new THREE.Vector3(p.x, p.y, p.z))
    },
    clear(from, to) {
      if (disposed) return false
      const start = query.findClosestPoint(from, { halfExtents: reach })
      if (!start.success || !start.polyRef) return false
      return query.raycast(start.polyRef, start.point, to).t >= 1
    },
    dispose() { if (disposed) return; disposed = true; query.destroy(); navMesh.destroy() },
  }
}

export async function navigationFromInput(input: NavigationInput): Promise<NavigationMesh | null> {
  try {
    const module = await loadRecast(), started = performance.now()
    const result = module.generateSoloNavMesh(input.positions, input.indices, { ...input.config, bounds: input.bounds })
    if (!result.success) return null
    const bounds = new THREE.Box3(new THREE.Vector3(...input.bounds[0]), new THREE.Vector3(...input.bounds[1]))
    return wrap(module, result.navMesh, bounds, performance.now() - started)
  } catch { return null }
}

/**
 * Bakes a navmesh from the static collider entries near the agents. Any failure (no WASM, no walkable triangles) yields null,
 * and callers keep the direct steering of sceneEnemies.
 */
export async function buildNavigation(entries: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[], focus: THREE.Box3, agent: NavigationAgent, options: { floor?: number } = {}): Promise<NavigationMesh | null> {
  try {
    const input = navigationInput(entries, focus, agent, options)
    return input ? await navigationFromInput(input) : null
  } catch { return null }
}

/** Focus box around every agent's base, widened by its roaming range (bases ± range). */
export function navigationFocus(agents: { base: THREE.Vector3; range: number }[], limit = 160): THREE.Box3 {
  const box = new THREE.Box3()
  for (const { base, range } of agents) {
    const reach = clamp(range * 1.8 + 2, 6, limit / 2)
    box.union(new THREE.Box3(base.clone().addScalar(-reach), base.clone().addScalar(reach)))
  }
  return box
}

export interface Router {
  /** Next waypoint between `from` and `to`; `time` is game seconds (repaths every `repath` seconds). */
  next(agentId: string, from: THREE.Vector3, to: THREE.Vector3, time?: number): THREE.Vector3
  forget(agentId: string): void
  readonly stats: { paths: number; hits: number }
}
export interface RouterOptions { repath?: number; retarget?: number; reach?: number; lost?: number }
interface Route { goal: THREE.Vector3; target: THREE.Vector3; points: THREE.Vector3[]; index: number; time: number; calls: number }

const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
/** Distance from p to segment ab on the ground plane. */
function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz
  const t = length < 1e-9 ? 0 : clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / length, 0, 1)
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

/** Per-agent cached corridors. Without a navmesh every call returns the target itself (direct steering). */
export function createRouter(nav: NavigationMesh | null, options: RouterOptions = {}): Router {
  const repath = options.repath ?? 2, retarget = options.retarget ?? 0.6, reach = options.reach ?? 0.4, lost = options.lost ?? 2.5
  const routes = new Map<string, Route>(), stats = { paths: 0, hits: 0 }
  const plan = (from: THREE.Vector3, to: THREE.Vector3, time: number, calls: number): Route => {
    stats.paths++
    const goal = nav!.closest(to) ?? to.clone(), points = nav!.path(from, goal) ?? []
    return { goal, target: to.clone(), points, index: Math.min(1, points.length - 1), time, calls }
  }
  return {
    stats,
    forget(agentId) { routes.delete(agentId) },
    next(agentId, from, to, time) {
      if (!nav) return to.clone()
      const previous = routes.get(agentId), calls = (previous?.calls ?? 0) + 1, now = time ?? calls / 60
      let route = previous
      const moved = route ? flat(route.target, to) : Infinity
      const stray = route && route.points.length > 1 ? segmentDistance(from, route.points[Math.max(0, route.index - 1)], route.points[route.index]) : 0
      if (!route || moved > Math.max(retarget, 0.15 * flat(from, to)) || now - route.time >= repath || now < route.time || stray > lost) route = plan(from, to, now, calls)
      else { route.calls = calls; stats.hits++ }
      routes.set(agentId, route)
      if (!route.points.length) return to.clone()
      const points = route.points
      while (route.index < points.length - 1 && flat(from, points[route.index]) < reach) route.index++
      // Skip a corner once the next one is directly reachable (after avoidance pushed the agent off the corridor).
      if (route.index < points.length - 1 && nav.clear(from, points[route.index + 1])) route.index++
      const last = route.index === points.length - 1
      return last && flat(route.goal, to) < 0.05 ? to.clone() : points[route.index].clone()
    },
  }
}
