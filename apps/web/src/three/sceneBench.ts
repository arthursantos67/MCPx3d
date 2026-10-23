import * as THREE from 'three'
import type { ThreeSceneDocument } from './sceneDocument.ts'
import type { PlayerInput, PlayerState } from './scenePlayer.ts'

/**
 * Opt-in measurement probe for scripts/benchmark-three-fps.mjs, active only with `?bench=1` in the URL.
 * Records per-frame timing and renderer counters, drives a fixed route in play mode and estimates GPU memory.
 * Without the parameter `sceneBench()` returns null and the viewport behaves exactly as before.
 */
export interface BenchFrame { at: number; interval: number; cpu: number; calls: number; triangles: number; game: boolean; streamMs?: number; selectMs?: number; deficit?: number }
export interface BenchWorldFrame { selectMs: number; deficit: number; stream: { applyMs: number } }
export interface BenchGpuSample { at: number; ms: number; game: boolean }
export interface BenchRoute { points: [number, number][]; sweep: number; sprint?: boolean; /** Fly this many metres above `ground`. */ altitude?: number }
export interface SceneBench {
  ratio: number | null
  invulnerable: boolean
  frames: BenchFrame[]
  gpu: BenchGpuSample[]
  marks: Record<string, number>
  recording: boolean
  route: BenchRoute | null
  attach(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void
  mark(name: string): void
  frame(timestamp: number, cpu: number, info: { calls: number; triangles: number }, game: boolean, world?: BenchWorldFrame | null): void
  /** Route forced by the URL (`route=x,z;x,z`, `sprint=1`, `fly=<metres above ground>`), used for world traversals. */
  fixedRoute: BenchRoute | null
  /** Whether play mode follows a route (`drive=1` or an explicit `route=`); otherwise the probe only measures. */
  driving: boolean
  /** Player speed override (`speed=`), m/s before sprint. */
  speed: number | null
  /** Terrain height for terrain-following flight, set by the viewport when a world is open. */
  ground: ((x: number, z: number) => number) | null
  /** Brackets one composed frame with a GPU timer query (EXT_disjoint_timer_query_webgl2), read back a few frames later. */
  gpuBegin(): void
  gpuEnd(game: boolean): void
  drive(player: PlayerState, input: PlayerInput, elapsed: number): void
  position(): [number, number, number] | null
  memory(): { geometryBytes: number; textureBytes: number; geometries: number; textures: number; programs: number }
}

declare global { interface Window { __formaBench?: SceneBench } }

const MAX_FRAMES = 20_000

const textureBytes = (texture: THREE.Texture): number => {
  const image = texture.image as { width?: number; height?: number; depth?: number; data?: ArrayBufferView } | undefined
  if (!image) return 0
  if (image.data && 'byteLength' in image.data) return image.data.byteLength * (texture.generateMipmaps ? 4 / 3 : 1)
  const width = image.width ?? 0, height = image.height ?? 0, depth = image.depth ?? 1
  const channel = texture.type === THREE.FloatType ? 4 : texture.type === THREE.HalfFloatType ? 2 : 1
  return width * height * depth * 4 * channel * (texture.generateMipmaps ? 4 / 3 : 1)
}

/** Unique geometry/texture bytes reachable from the scene, render targets excluded; an estimate, not a driver measurement. */
export function estimateSceneMemory(scene: THREE.Object3D): { geometryBytes: number; textureBytes: number; geometries: number; textures: number } {
  const geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>(), instances = new Set<THREE.BufferAttribute>()
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) geometries.add(mesh.geometry)
    const materials = mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []
    for (const material of materials) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    const instanced = object as THREE.InstancedMesh
    if (instanced.isInstancedMesh) { instances.add(instanced.instanceMatrix); if (instanced.instanceColor) instances.add(instanced.instanceColor) }
  })
  let geometryBytes = 0
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) geometryBytes += (attribute as THREE.BufferAttribute).array?.byteLength ?? 0
    geometryBytes += geometry.index?.array.byteLength ?? 0
  }
  for (const attribute of instances) geometryBytes += attribute.array.byteLength
  let bytes = 0
  for (const texture of textures) bytes += textureBytes(texture)
  return { geometryBytes, textureBytes: Math.round(bytes), geometries: geometries.size, textures: textures.size }
}

/**
 * Steering for the fixed route: a full turn in place, then each waypoint in order (looping), skipping one that
 * cannot be reached within 6 s. Space is fixed per scene; the per-frame inputs follow the measured frame time.
 */
export function routeInput(route: BenchRoute, player: PlayerState, state: { index: number; since: number; best: number; turned: number }, elapsed: number, input: PlayerInput, ground?: ((x: number, z: number) => number) | null): void {
  Object.assign(input, { forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false, up: false, down: false, sprint: false, jump: false })
  if (state.turned < Math.PI * 2 - 1e-9) {
    const step = Math.min(Math.PI * 2 - state.turned, (Math.PI * 2 / route.sweep) * elapsed)
    player.yaw += step; state.turned += step; player.pitch = -0.05
    return
  }
  if (!route.points.length) return
  const [x, z] = route.points[state.index % route.points.length], dx = x - player.position.x, dz = z - player.position.z, distance = Math.hypot(dx, dz)
  state.since += elapsed
  if (distance < 1.5 || state.since > 6) { state.index++; state.since = 0; state.best = Infinity; return }
  if (distance < state.best - 0.2) { state.best = distance; state.since = Math.min(state.since, 3) }
  const desired = Math.atan2(-dx, -dz), turn = Math.atan2(Math.sin(desired - player.yaw), Math.cos(desired - player.yaw))
  player.yaw += THREE.MathUtils.clamp(turn, -4 * elapsed, 4 * elapsed)
  player.pitch = -0.05
  input.forward = Math.abs(turn) < 1.2
  input.sprint = !!route.sprint && input.forward
  if (route.altitude !== undefined && ground) {
    const above = player.position.y - ground(player.position.x, player.position.z)
    input.up = above < route.altitude; input.down = above > route.altitude * 1.5; input.jump = false
  }
  input.jump = state.since > 2.5 && player.onGround
}

/**
 * Waypoints through the scene's points of interest (interactions, characters, goal), nearest first from the
 * spawn, so every run of a scene walks the same places. Scenes without them get a 12 m square around the spawn.
 */
export function planBenchRoute(doc: ThreeSceneDocument, spawn: THREE.Vector3, worldPosition: (id: string) => THREE.Vector3 | null, limit = 8): BenchRoute {
  const candidates: [number, number][] = []
  for (const node of doc.nodes) {
    if (!node.interaction && !node.behavior) continue
    const at = worldPosition(node.id)
    if (at && Math.hypot(at.x - spawn.x, at.z - spawn.z) < 120 && !candidates.some(([x, z]) => Math.hypot(x - at.x, z - at.z) < 3)) candidates.push([at.x, at.z])
  }
  const points: [number, number][] = []
  let from: [number, number] = [spawn.x, spawn.z]
  while (candidates.length && points.length < limit) {
    let best = 0
    for (let i = 1; i < candidates.length; i++) if (Math.hypot(candidates[i][0] - from[0], candidates[i][1] - from[1]) < Math.hypot(candidates[best][0] - from[0], candidates[best][1] - from[1])) best = i
    from = candidates.splice(best, 1)[0]
    points.push(from)
  }
  if (points.length < 3) points.push([spawn.x + 12, spawn.z], [spawn.x + 12, spawn.z - 12], [spawn.x, spawn.z - 12], [spawn.x, spawn.z])
  return { points, sweep: 6 }
}

export function createSceneBench(search: string): SceneBench | null {
  const params = new URLSearchParams(search)
  if (params.get('bench') !== '1') return null
  const ratio = Number(params.get('ratio'))
  const points = (params.get('route') ?? '').split(';').map((pair) => pair.split(',').map(Number)).filter((pair) => pair.length === 2 && pair.every(Number.isFinite)) as [number, number][]
  let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene | null = null, last = 0, player: PlayerState | null = null
  let gl: WebGL2RenderingContext | null = null, timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null, active: WebGLQuery | null = null
  const pending: { query: WebGLQuery; at: number; game: boolean }[] = [], spare: WebGLQuery[] = []
  const steer = { index: 0, since: 0, best: Infinity, turned: 0 }
  const bench: SceneBench = {
    ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : null,
    invulnerable: params.get('invulnerable') !== '0',
    frames: [], gpu: [], marks: {}, recording: false, route: null,
    fixedRoute: points.length ? { points, sweep: 6, sprint: params.get('sprint') === '1', ...(params.get('fly') ? { altitude: Number(params.get('fly')) } : {}) } : null,
    driving: params.get('drive') === '1' || points.length > 0,
    speed: Number(params.get('speed')) > 0 ? Number(params.get('speed')) : null,
    ground: null,
    attach(nextRenderer, nextScene) {
      renderer = nextRenderer; scene = nextScene
      gl = nextRenderer.getContext() as WebGL2RenderingContext
      timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as typeof timer
    },
    gpuBegin() {
      if (!gl || !timer || active || pending.length > 8) return
      active = spare.pop() ?? gl.createQuery()
      gl.beginQuery(timer.TIME_ELAPSED_EXT, active)
    },
    gpuEnd(game) {
      if (!gl || !timer) return
      if (active) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push({ query: active, at: performance.now(), game }); active = null }
      const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) as boolean
      while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
        const item = pending.shift()!, nanoseconds = gl.getQueryParameter(item.query, gl.QUERY_RESULT) as number
        spare.push(item.query)
        if (!disjoint && bench.recording && bench.gpu.length < MAX_FRAMES) bench.gpu.push({ at: item.at, ms: nanoseconds / 1e6, game: item.game })
      }
    },
    mark(name) { bench.marks[name] = performance.now() },
    frame(timestamp, cpu, info, game, world) {
      const interval = last ? timestamp - last : 0
      last = timestamp
      if (game && bench.marks.gameReady > (bench.marks.gameStart ?? 0) && !(bench.marks.firstGameFrame > bench.marks.gameReady)) bench.mark('firstGameFrame')
      if (!bench.recording || bench.frames.length >= MAX_FRAMES) return
      bench.frames.push({ at: timestamp, interval, cpu, calls: info.calls, triangles: info.triangles, game, ...(world ? { streamMs: world.stream.applyMs, selectMs: world.selectMs, deficit: world.deficit } : {}) })
    },
    drive(nextPlayer, input, elapsed) {
      if (player !== nextPlayer) { player = nextPlayer; Object.assign(steer, { index: 0, since: 0, best: Infinity, turned: 0 }) }
      if (bench.route) routeInput(bench.route, nextPlayer, steer, elapsed, input, bench.ground)
    },
    position: () => player ? [player.position.x, player.position.y, player.position.z] : null,
    memory() {
      const estimate = scene ? estimateSceneMemory(scene) : { geometryBytes: 0, textureBytes: 0, geometries: 0, textures: 0 }
      return { ...estimate, programs: renderer?.info.programs?.length ?? 0 }
    },
  }
  return bench
}

let shared: SceneBench | null | undefined
export function sceneBench(): SceneBench | null {
  if (shared === undefined) {
    shared = typeof window === 'undefined' ? null : createSceneBench(window.location.search)
    if (shared) window.__formaBench = shared
  }
  return shared
}
