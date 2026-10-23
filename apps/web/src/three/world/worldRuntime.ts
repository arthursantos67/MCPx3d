import * as THREE from 'three'
import { buildLodField, LEAF_SIZE, levelCount, nodeSize, selectNodes, type LodField, type QuarterDraw } from './cdlod.ts'
import { createTerrainCollider, type CollisionShape } from './terrainCollider.ts'
import { createTerrainRenderer, ORIGIN_STEP, TERRAIN_TEXTURES, type TerrainRenderer } from './terrainRenderer.ts'
import { hasTextureData, primeTextureData } from '../sceneTextures.ts'
import { collisionNodes, createTerrainStream, type StreamStats, type TerrainStream } from './terrainStream.ts'
import { assembleCellErrors, ERROR_CELL, errorBlocks, type TileData } from './terrainTile.ts'
import type { ThreeWorldDocument } from './worldDocument.ts'
import type { WorldPool } from './workerPool.ts'
import { createHeightSource, type HeightSource } from './worldTerrain.ts'

export const STREAM_BUDGET_MS = 2
/** Tolerance for the terrain LOD, in screen pixels. */
export const LOD_TOLERANCE_PX = 1
/** Level-0 tiles kept resident around the player for collision, in metres. */
export const COLLISION_RADIUS = 72
const RECENTER_DISTANCE = 512
/** Share of each range over which vertices morph to the next level. */
export const MORPH_FRACTION = 0.25
const SHADOW_RADIUS = 64

export interface WorldFrameStats { draws: number; shadowDraws: number; deficit: number; selectMs: number; stream: StreamStats; renderOrigin: [number, number] }
export interface WorldRuntime {
  readonly object: THREE.Group
  readonly materials: THREE.Material[]
  readonly collision: CollisionShape
  readonly source: HeightSource
  readonly errors: number[]
  readonly stats: WorldFrameStats
  /** Measures LOD errors in the workers, then loads what the view and collision at `focus` need. */
  prepare(focus: THREE.Vector3, camera: THREE.PerspectiveCamera, pixelHeight: number, onProgress?: (fraction: number) => void): Promise<void>
  /** Selection, streaming (≤ STREAM_BUDGET_MS of main-thread time) and instance upload for this frame. */
  update(camera: THREE.PerspectiveCamera, pixelHeight: number, player: THREE.Vector3 | null): void
  /** Compiles the terrain's shadow-depth program as the sun's shadow pass will use it, without blocking. */
  compileShadows(renderer: THREE.WebGLRenderer, light: THREE.DirectionalLight, scene: THREE.Scene): Promise<unknown>
  /** True once collision tiles under and around `position` are resident. */
  collisionReady(position: THREE.Vector3): boolean
  dispose(): void
}

export function createWorldRuntime(world: ThreeWorldDocument, pool: WorldPool, options: { anisotropy?: number; maxLayers?: number; onTile?: () => void } = {}): WorldRuntime {
  const source = createHeightSource(world), seed = { seed: world.seed, terrain: world.terrain }
  const levels = levelCount(Math.max(...world.terrain.size)), top = levels - 1
  const origin: [number, number] = [-world.terrain.size[0] / 2, -world.terrain.size[1] / 2]
  const roots: [number, number] = [Math.ceil(world.terrain.size[0] / nodeSize(top)), Math.ceil(world.terrain.size[1] / nodeSize(top))]
  const errors: number[] = new Array(levels).fill(0)
  const generate = (level: number, ix: number, iz: number) => (pool.run({ type: 'tile', world: seed, origin, level, ix, iz }, level === 0 ? 0 : 1) as Promise<TileData & { ms: number }>)
    .then((tile) => { options.onTile?.(); return tile })
  const capacity = Math.min(512, options.maxLayers ?? 512)
  const stream: TerrainStream = createTerrainStream({ capacity, levels, errors, range: world.terrain.heightRange, generate, maxInFlight: pool.size * 3 })
  const snowLine = world.terrain.heightRange[0] + (world.terrain.heightRange[1] - world.terrain.heightRange[0]) * 0.88
  // Created in prepare(), once the workers have produced the ground textures.
  let terrain: TerrainRenderer | null = null
  const object = new THREE.Group()
  object.name = world.name
  // Open sea to the horizon around coastal worlds: one quad, recentred with the render origin.
  const sea = world.terrain.seaLevel === null ? null : new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#2f5f73', roughness: 0.18, metalness: 0 }))
  if (sea) {
    sea.name = 'Mar do mundo'
    sea.rotation.x = -Math.PI / 2
    sea.scale.set(Math.max(...world.terrain.size) * 4, Math.max(...world.terrain.size) * 4, 1)
    sea.position.y = world.terrain.seaLevel!
    sea.receiveShadow = true
  }
  const cells: [number, number] = [roots[0] * nodeSize(top) / ERROR_CELL, roots[1] * nodeSize(top) / ERROR_CELL]
  let near: TileData[] = [], cellErrors: Float32Array[] = [], field: LodField | null = null, fieldKey = '', renderOrigin: [number, number] = [0, 0], disposed = false
  const collision = createTerrainCollider(() => near, origin)
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), box = new THREE.Box3(), cameraWorld = new THREE.Vector3(), cameraRender = new THREE.Vector3()
  const stats: WorldFrameStats = { draws: 0, shadowDraws: 0, deficit: 0, selectMs: 0, stream: stream.stats, renderOrigin }
  const refreshField = (camera: THREE.PerspectiveCamera, pixelHeight: number) => {
    const key = `${pixelHeight}:${camera.fov}`
    if (key === fieldKey || !cellErrors.length) return
    fieldKey = key
    field = buildLodField(cellErrors, cells, { pixelHeight, fovY: THREE.MathUtils.degToRad(camera.fov), tolerancePx: LOD_TOLERANCE_PX, morphFraction: MORPH_FRACTION })
    terrain?.setField(field)
  }
  const select = (camera: THREE.Vector3, culled: boolean) => selectNodes({
    camera: [camera.x, camera.y, camera.z], origin, levels, field: field!, roots,
    bounds: stream.bounds, resident: stream.resident,
    visible: culled ? (x0, y0, z0, x1, y1, z1) => { box.min.set(x0, y0, z0); box.max.set(x1, y1, z1); return frustum.intersectsBox(box) } : undefined,
  })
  const nearPlayer = (draws: QuarterDraw[], player: THREE.Vector3) => draws.filter((draw) => {
    const half = nodeSize(draw.level) / 2, x0 = origin[0] + draw.ix * nodeSize(draw.level) + (draw.quarter & 1) * half, z0 = origin[1] + draw.iz * nodeSize(draw.level) + (draw.quarter >> 1) * half
    const dx = Math.max(x0 - player.x, 0, player.x - x0 - half), dz = Math.max(z0 - player.z, 0, player.z - z0 - half)
    return dx * dx + dz * dz <= SHADOW_RADIUS * SHADOW_RADIUS
  })
  const runtime: WorldRuntime = {
    object, collision, source, errors, stats,
    get materials() { return [...terrain?.materials ?? [], ...(sea ? [sea.material as THREE.Material] : [])] },
    async prepare(focus, camera, pixelHeight, onProgress) {
      const textures = Promise.all(TERRAIN_TEXTURES.filter((kind) => !hasTextureData(kind)).map((kind) =>
        pool.run({ type: 'texture', kind }).then(({ color, normal, rough }) => primeTextureData(kind, { color, normal, rough }))))
      const blocks = errorBlocks(world.terrain.size, origin, levels), chunk = Math.ceil(blocks.length / (pool.size * 4))
      let done = 0
      const parts = await Promise.all(Array.from({ length: Math.ceil(blocks.length / chunk) }, (_, index) =>
        pool.run({ type: 'errors', world: seed, levels, blocks: blocks.slice(index * chunk, (index + 1) * chunk) }).then((result) => { done++; onProgress?.(done / Math.ceil(blocks.length / chunk) * 0.6); return result })))
      const assembled = assembleCellErrors(blocks, parts.flatMap((part) => part.blocks), origin, cells, levels)
      cellErrors = assembled.cells
      assembled.max.forEach((value, level) => { errors[level] = value })
      await textures
      if (disposed) return
      terrain = createTerrainRenderer(stream, { seaLevel: world.terrain.seaLevel, snowLine, range: world.terrain.heightRange }, options.anisotropy)
      refreshField(camera, pixelHeight)
      const required = new Map<string, { level: number; ix: number; iz: number }>()
      const add = (node: { level: number; ix: number; iz: number }) => required.set(`${node.level}:${node.ix}:${node.iz}`, node)
      for (let iz = 0; iz < roots[1]; iz++) for (let ix = 0; ix < roots[0]; ix++) add({ level: top, ix, iz })
      for (const node of collisionNodes(focus.x, focus.z, origin, COLLISION_RADIUS)) add(node)
      // Walk down level by level so every node the first frame selects is resident.
      for (let pass = 0; pass < levels && !disposed; pass++) {
        const pending = [...required.values()]
        const loading = stream.whenResident(pending)
        while (!disposed) {
          stream.request(pending)
          stream.apply(1000)
          if (pending.every((node) => stream.resident(node.level, node.ix, node.iz))) break
          // More nodes than layers: play with what fits; the streamer keeps the nearest and reports any shortfall.
          if (stream.stats.resident >= capacity) break
          await Promise.race([loading, new Promise((resolve) => setTimeout(resolve, 16))])
        }
        onProgress?.(0.6 + 0.4 * (pass + 1) / levels)
        const selection = select(focus, false)
        if (!selection.wanted.length) break
        for (const node of selection.wanted) add(node)
      }
      // Attached only now: a mesh in the scene compiles its program on the next frame even with no instances, which
      // would block; the viewport compiles it in parallel right after this resolves.
      if (!disposed) { object.add(terrain.object); if (sea) object.add(sea) }
    },
    update(camera, pixelHeight, player) {
      if (!terrain) return
      const started = performance.now()
      stream.beginFrame()
      refreshField(camera, pixelHeight)
      camera.getWorldPosition(cameraWorld)
      const anchor = player ?? cameraWorld
      if (Math.hypot(anchor.x - renderOrigin[0], anchor.z - renderOrigin[1]) > RECENTER_DISTANCE) {
        renderOrigin = [Math.round(anchor.x / ORIGIN_STEP) * ORIGIN_STEP, Math.round(anchor.z / ORIGIN_STEP) * ORIGIN_STEP]
        stats.renderOrigin = renderOrigin
      }
      object.position.set(renderOrigin[0], 0, renderOrigin[1])
      sea?.position.set(-renderOrigin[0], world.terrain.seaLevel!, -renderOrigin[1])
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const view = select(cameraWorld, true), all = select(cameraWorld, false)
      const collisionWanted = player ? collisionNodes(player.x, player.z, origin, COLLISION_RADIUS) : []
      near = collisionWanted.map((node) => stream.tile(node.level, node.ix, node.iz)).filter((tile): tile is NonNullable<typeof tile> => !!tile)
      for (const tile of near) stream.resident(tile.level, tile.ix, tile.iz)
      stats.selectMs = performance.now() - started
      stream.request([...collisionWanted.filter((node) => !stream.resident(node.level, node.ix, node.iz)), ...all.wanted])
      stream.apply(STREAM_BUDGET_MS)
      cameraRender.set(cameraWorld.x - renderOrigin[0], cameraWorld.y, cameraWorld.z - renderOrigin[1])
      const shadowDraws = player ? nearPlayer(all.draws, player) : []
      terrain!.update(view.draws, shadowDraws, stream, origin, renderOrigin, cameraRender)
      stats.draws = view.draws.length; stats.shadowDraws = shadowDraws.length; stats.deficit = view.deficit
    },
    compileShadows(renderer, light, scene) {
      const map = light.shadow.map
      if (!terrain || !map) return Promise.resolve()
      const proxies = new THREE.Scene()
      proxies.add(terrain.shadowProxy)
      const output = renderer.getRenderTarget()
      renderer.setRenderTarget(map as THREE.WebGLRenderTarget)
      const compiled = renderer.compileAsync(proxies, light.shadow.camera, scene)
      renderer.setRenderTarget(output)
      return compiled.finally(() => terrain?.shadowProxy.removeFromParent())
    },
    collisionReady: (position) => collisionNodes(position.x, position.z, origin, LEAF_SIZE / 2).every((node) => !!stream.tile(node.level, node.ix, node.iz)),
    dispose() { disposed = true; stream.dispose(); terrain?.dispose(); sea?.geometry.dispose(); (sea?.material as THREE.Material | undefined)?.dispose() },
  }
  return runtime
}
