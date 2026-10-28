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
import { needsMacro } from './worldJobs.ts'
import type { WaterMesh, WorldMacro } from './worldMacro.ts'
import { regionAt, type RegionInfo } from './worldRegions.ts'
import { createVegetationRenderer, TIER_RANGES, vegetationTextures, type VegetationRenderer } from './vegetationRenderer.ts'
import { BIOME_VEGETATION, SPECIES, VEGETATION_CELL, type Species } from './worldVegetation.ts'
import { BIOMES, waterHeightAt } from './worldMacro.ts'
import type { WindSystem } from '../sceneWind.ts'
import type { QualityLevel } from '../sceneRuntimeTypes.ts'
import { createGrass, type GrassSystem } from '../sceneGrass.ts'
import { createWorldGroundField, GROUND_WINDOW, type GroundWindow } from './worldGround.ts'
import { proceduralTexture } from '../sceneTextures.ts'
import type { PlantObstacle, PlantTarget } from './worldPlantInteraction.ts'
import { findWorldSpawn } from './worldSpawn.ts'

export const STREAM_BUDGET_MS = 2
/** Tolerance for the terrain LOD, in screen pixels. */
export const LOD_TOLERANCE_PX = 1
/** Level-0 tiles kept resident around the player for collision, in metres. */
export const COLLISION_RADIUS = 72
const RECENTER_DISTANCE = 512
/** Share of each range over which vertices morph to the next level. */
export const MORPH_FRACTION = 0.25
const SHADOW_RADIUS = 64

export interface WorldFrameStats { draws: number; shadowDraws: number; deficit: number; selectMs: number; stream: StreamStats; renderOrigin: [number, number]; plants: { near: number; mid: number; far: number; cells: number } }
export interface WorldRuntime {
  readonly object: THREE.Group
  readonly materials: THREE.Material[]
  readonly collision: CollisionShape
  /** Final terrain height (base relief plus erosion and river beds once the macro pass has run). */
  heightAt(x: number, z: number): number
  waterAt(x: number, z: number): number | null
  resourceAt(ray: THREE.Ray, range?: number): PlantTarget | null
  obstacles(x: number, z: number): PlantObstacle[]
  removePlant(id: string): void
  resetHarvest(): void
  /** Where the player starts: the document's spawn, or a dry low point found after the macro pass. */
  readonly spawn: THREE.Vector3 | null
  readonly macro: WorldMacro | null
  /**
   * Ground level of a location's flattened footprint once the macro pass ran (authoritative: placement only estimates
   * it before roads and pads are carved); null for unknown locations or worlds without a layout.
   */
  siteLevel(locationId: string): number | null
  /** Region, biome and resolved ambience/music at a point. */
  regionAt(x: number, z: number): RegionInfo
  readonly errors: number[]
  readonly stats: WorldFrameStats
  /**
   * Runs the macro pass, measures LOD errors in the workers, then loads what the view and collision at `focus` (or
   * the computed spawn when null) need.
   */
  prepare(focus: THREE.Vector3 | null, camera: THREE.PerspectiveCamera, pixelHeight: number, onProgress?: (fraction: number) => void): Promise<void>
  /** Selection, streaming (≤ STREAM_BUDGET_MS of main-thread time) and instance upload for this frame. */
  update(camera: THREE.PerspectiveCamera, pixelHeight: number, player: THREE.Vector3 | null): void
  /**
   * Fast travel: loads terrain, collision, vegetation and the ground window at `target` before the player arrives,
   * resolving when everything the first frame there needs is resident.
   */
  preload(target: THREE.Vector3): Promise<void>
  /** The world map image, `size` pixels square, north up (computed in a worker). */
  map(size: number): Promise<ImageData>
  /** True once collision tiles under and around `position` are resident. */
  collisionReady(position: THREE.Vector3): boolean
  dispose(): void
}

export interface WorldRuntimeOptions {
  anisotropy?: number; maxLayers?: number; onTile?: () => void
  /** Vegetation needs the renderer (impostor baking) and the shared wind; without them the world has bare terrain. */
  vegetation?: { renderer: THREE.WebGLRenderer; wind: WindSystem; shadows: boolean; quality: QualityLevel }
}
export function createWorldRuntime(world: ThreeWorldDocument, pool: WorldPool, options: WorldRuntimeOptions = {}): WorldRuntime {
  const seed = { seed: world.seed, terrain: world.terrain }
  let source: HeightSource = createHeightSource(world), macro: WorldMacro | null = null, spawn: THREE.Vector3 | null = null
  const levels = levelCount(Math.max(...world.terrain.size)), top = levels - 1
  const origin: [number, number] = [-world.terrain.size[0] / 2, -world.terrain.size[1] / 2]
  const roots: [number, number] = [Math.ceil(world.terrain.size[0] / nodeSize(top)), Math.ceil(world.terrain.size[1] / nodeSize(top))]
  const errors: number[] = new Array(levels).fill(0)
  const generate = (level: number, ix: number, iz: number) => (pool.run({ type: 'tile', world: seed, origin, level, ix, iz }, level === 0 ? 0 : 1) as Promise<TileData & { ms: number }>)
    .then((tile) => { options.onTile?.(); return tile })
  const gl = options.vegetation?.renderer.getContext() as WebGL2RenderingContext | undefined
  const capacity = Math.min(1024, options.maxLayers ?? 1024, gl ? gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number : 1024)
  const stream: TerrainStream = createTerrainStream({ capacity, levels, errors, range: world.terrain.heightRange, generate, maxInFlight: pool.size * 3 })
  // Created in prepare(), once the workers have produced the ground textures.
  let terrain: TerrainRenderer | null = null
  const object = new THREE.Group()
  object.name = world.name
  // Open sea to the horizon around coastal worlds: one quad, recentred with the render origin.
  const sea = world.terrain.seaLevel === null ? null : new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#2f5f73', roughness: 0.18, metalness: 0, side: THREE.DoubleSide }))
  if (sea) {
    sea.name = 'Mar do mundo'
    sea.rotation.x = -Math.PI / 2
    sea.scale.set(Math.max(...world.terrain.size) * 4, Math.max(...world.terrain.size) * 4, 1)
    sea.position.y = world.terrain.seaLevel!
    sea.receiveShadow = true
  }
  let water: THREE.Mesh | null = null, waterLevels: Float32Array | null = null
  const waterSurface = (mesh: WaterMesh) => {
    if (!mesh.indices.length) return null
    const geometry = new THREE.BufferGeometry(), uv = new Float32Array(mesh.positions.length / 3 * 2)
    for (let i = 0; i < uv.length / 2; i++) { uv[i * 2] = mesh.positions[i * 3] * 0.05; uv[i * 2 + 1] = mesh.positions[i * 3 + 2] * 0.05 }
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    geometry.computeVertexNormals()
    const normal = proceduralTexture('water', 'normal')
    const material = new THREE.MeshStandardMaterial({ color: '#2c5d6e', roughness: 0.1, metalness: 0, normalMap: normal, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide })
    material.userData.water = true
    const surface = new THREE.Mesh(geometry, material)
    surface.name = 'Lagos e rios'
    surface.receiveShadow = true
    return surface
  }
  const cells: [number, number] = [roots[0] * nodeSize(top) / ERROR_CELL, roots[1] * nodeSize(top) / ERROR_CELL]
  let near: TileData[] = [], cellErrors: Float32Array[] = [], field: LodField | null = null, fieldKey = '', renderOrigin: [number, number] = [0, 0], disposed = false
  const collision = createTerrainCollider(() => near, origin)
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), box = new THREE.Box3(), cameraWorld = new THREE.Vector3(), cameraRender = new THREE.Vector3()
  const stats: WorldFrameStats = { draws: 0, shadowDraws: 0, deficit: 0, selectMs: 0, stream: stream.stats, renderOrigin, plants: { near: 0, mid: 0, far: 0, cells: 0 } }
  let vegetation: VegetationRenderer | null = null
  const removedPlants = new Set<string>()
  let ground: ReturnType<typeof createWorldGroundField> | null = null, grass: GrassSystem | null = null, groundPending = false
  const worldSpace = new THREE.Group()
  worldSpace.name = 'Grama do mundo'
  /** Installs a ground window: the first one creates the field and the grass (with blades forced on so the program exists). */
  const installGround = (window: GroundWindow) => {
    const setup = options.vegetation
    if (!setup) return
    if (ground) { ground.load(window); setup.wind.setGround(ground); return }
    const seeded = { ...window, data: window.data.slice() }
    for (let k = 2; k < seeded.data.length; k += 4) seeded.data[k] = 255
    ground = createWorldGroundField(seeded)
    setup.wind.setGround(ground)
    grass = createGrass(ground, setup.wind, { density: 'auto', quality: setup.quality })
    ground.load(window)
    if (grass) worldSpace.add(grass.object)
  }
  const streamGround = (anchor: THREE.Vector3) => {
    if (!options.vegetation || groundPending || (ground && Math.hypot(anchor.x - ground.center[0], anchor.z - ground.center[1]) < GROUND_WINDOW / 4)) return
    groundPending = true
    void pool.run({ type: 'ground', world: seed, center: [Math.round(anchor.x), Math.round(anchor.z)] }, 0).then((window) => { groundPending = false; if (!disposed) { installGround(window); options.onTile?.() } }, () => { groundPending = false })
  }
  const plantCells = new Set<string>(), plantPending = new Set<string>()
  /** Vegetation cells within the impostor range, requested a few at a time behind terrain tiles; far ones are dropped. */
  const streamPlants = (camera: THREE.Vector3) => {
    if (!vegetation) return
    const reach = TIER_RANGES.far * 1.1, drop = TIER_RANGES.far * 1.4, wanted: [number, number, number][] = []
    const cx0 = Math.floor((camera.x - reach - origin[0]) / VEGETATION_CELL), cx1 = Math.floor((camera.x + reach - origin[0]) / VEGETATION_CELL)
    const cz0 = Math.floor((camera.z - reach - origin[1]) / VEGETATION_CELL), cz1 = Math.floor((camera.z + reach - origin[1]) / VEGETATION_CELL)
    const limit = world.terrain.size[0] / VEGETATION_CELL
    for (let cz = Math.max(0, cz0); cz <= Math.min(limit - 1, cz1); cz++) for (let cx = Math.max(0, cx0); cx <= Math.min(limit - 1, cx1); cx++) {
      const key = `${cx}:${cz}`, distance = Math.hypot(origin[0] + (cx + 0.5) * VEGETATION_CELL - camera.x, origin[1] + (cz + 0.5) * VEGETATION_CELL - camera.z)
      if (distance <= reach && !plantCells.has(key) && !plantPending.has(key)) wanted.push([cx, cz, distance])
    }
    for (const key of [...plantCells]) {
      const [cx, cz] = key.split(':').map(Number)
      if (Math.hypot(origin[0] + (cx + 0.5) * VEGETATION_CELL - camera.x, origin[1] + (cz + 0.5) * VEGETATION_CELL - camera.z) > drop) { plantCells.delete(key); vegetation.setCell(cx, cz, null) }
    }
    wanted.sort((a, b) => a[2] - b[2])
    for (let start = 0; start < wanted.length && plantPending.size < 32; start += 8) {
      const batch = wanted.slice(start, start + 8)
      for (const [cx, cz] of batch) plantPending.add(`${cx}:${cz}`)
      void pool.run({ type: 'vegetation', world: seed, origin, density: world.budgets.vegetationDensity, cells: batch.map(([cx, cz]) => [cx, cz] as [number, number]) }, 2).then((result) => {
        for (const cell of result.cells) {
          const key = `${cell.cx}:${cell.cz}`
          plantPending.delete(key)
          if (disposed || !vegetation) continue
          plantCells.add(key); vegetation.setCell(cell.cx, cell.cz, cell.plants)
        }
        options.onTile?.()
      }, () => { for (const [cx, cz] of batch) plantPending.delete(`${cx}:${cz}`) })
    }
    stats.plants = { ...vegetation.stats, cells: plantCells.size }
  }
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
  /** Loads, level by level, every tile the view and the collision at `focus` need (first frame, fast travel). */
  const loadAround = async (focus: THREE.Vector3, onProgress?: (fraction: number) => void) => {
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
      onProgress?.((pass + 1) / levels)
      const selection = select(focus, false)
      if (!selection.wanted.length) break
      for (const node of selection.wanted) add(node)
    }
  }
  const runtime: WorldRuntime = {
    object, collision, errors, stats,
    heightAt: (x, z) => source.heightAt(x, z),
    waterAt: (x, z) => { const level = macro && waterLevels ? waterHeightAt(waterLevels, macro, x, z) : null; return level === null ? world.terrain.seaLevel : Math.max(level, world.terrain.seaLevel ?? -Infinity) },
    resourceAt: (ray, range) => vegetation?.raycast(ray, range) ?? null,
    obstacles: (x, z) => vegetation?.obstacles(x, z) ?? [],
    removePlant(id) { removedPlants.add(id); vegetation?.removePlant(id) },
    resetHarvest() { removedPlants.clear(); vegetation?.resetHarvest() },
    get spawn() { return spawn },
    get macro() { return macro },
    regionAt: (x, z) => regionAt(world, macro, x, z),
    siteLevel(locationId) {
      const index = world.locations.findIndex((location) => location.id === locationId), level = index >= 0 ? macro?.siteLevels[index] : undefined
      return level === undefined || Number.isNaN(level) ? null : level
    },
    get materials() { return [...terrain?.materials ?? [], ...(sea ? [sea.material as THREE.Material] : []), ...(water ? [water.material as THREE.Material] : []), ...vegetation?.materials ?? []] },
    async prepare(focus, camera, pixelHeight, onProgress) {
      const textures = Promise.all([...TERRAIN_TEXTURES, 'water' as const, ...options.vegetation ? vegetationTextures(SPECIES) : []].filter((kind) => !hasTextureData(kind)).map((kind) =>
        pool.run({ type: 'texture', kind }).then(({ color, normal, rough }) => primeTextureData(kind, { color, normal, rough }))))
      // Erosion, drainage and climate first: every height after this includes them, in all workers.
      const ids = new Map(world.locations.map((location, index) => [location.id, index]))
      const layout = { sites: world.locations.map((location) => ({ x: location.position[0], z: location.position[1], radius: location.footprint })),
        roads: world.routes.flatMap((route) => ids.has(route.from) && ids.has(route.to) ? [{ from: ids.get(route.from)!, to: ids.get(route.to)!, width: route.width }] : []) }
      const macroResult = await pool.run({ type: 'macro', world: seed, layout })
      if (disposed) return
      macro = macroResult.macro
      await pool.broadcast({ type: 'install', world: seed, fields: { delta: macro.delta, cell: macro.cell, points: macro.points, origin: macro.origin, biome: macro.biome, water: macro.water, river: macro.river, ground: macro.ground, clear: macro.clear, pads: macro.pads } })
      if (needsMacro(world)) source = createHeightSource(world, macro)
      spawn = focus?.clone() ?? await findWorldSpawn(world, source, (x, z) => {
        const level = waterHeightAt(macroResult.mesh.levels, macro!, x, z)
        return regionAt(world, macro, x, z).dry && (level === null || source.heightAt(x, z) > level + 0.5)
      })
      if (focus && world.environment.player?.mode !== 'fly') spawn.y = source.heightAt(spawn.x, spawn.z) + 0.05
      if (disposed) return
      focus = spawn
      const blocks = errorBlocks(world.terrain.size, origin, levels), chunk = Math.ceil(blocks.length / (pool.size * 4))
      let done = 0
      const parts = await Promise.all(Array.from({ length: Math.ceil(blocks.length / chunk) }, (_, index) =>
        pool.run({ type: 'errors', world: seed, levels, blocks: blocks.slice(index * chunk, (index + 1) * chunk) }).then((result) => { done++; onProgress?.(done / Math.ceil(blocks.length / chunk) * 0.6); return result })))
      const assembled = assembleCellErrors(blocks, parts.flatMap((part) => part.blocks), origin, cells, levels)
      cellErrors = assembled.cells
      assembled.max.forEach((value, level) => { errors[level] = value })
      await textures
      if (disposed) return
      terrain = createTerrainRenderer(stream, macro, options.anisotropy)
      water = waterSurface(macroResult.mesh)
      waterLevels = macroResult.mesh.levels
      if (options.vegetation) {
        // Only the species some biome of this world grows; each is built and baked in its own task.
        const present = new Set<Species>()
        for (const index of new Set(macro.biome)) for (const [name, share] of Object.entries(BIOME_VEGETATION[BIOMES[index]].mix)) if (share) present.add(name as Species)
        vegetation = await createVegetationRenderer({ ...options.vegetation, anisotropy: options.anisotropy ?? 4, species: SPECIES.filter((name) => present.has(name)), origin })
        for (const id of removedPlants) vegetation.removePlant(id)
        if (disposed) { vegetation.dispose(); return }
        streamPlants(focus)
        installGround(await pool.run({ type: 'ground', world: seed, center: [Math.round(focus.x), Math.round(focus.z)] }, 0))
      }
      refreshField(camera, pixelHeight)
      await loadAround(focus, (fraction) => onProgress?.(0.6 + 0.4 * fraction))
      // Attached only now: a mesh in the scene compiles its program on the next frame even with no instances, which
      // would block; the viewport compiles it in parallel right after this resolves.
      if (!disposed) { object.add(terrain.object); if (sea) object.add(sea); if (water) object.add(water); if (vegetation) object.add(vegetation.object); object.add(worldSpace) }
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
      water?.position.set(-renderOrigin[0], 0, -renderOrigin[1])
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
      streamPlants(cameraWorld)
      vegetation?.update(cameraWorld, renderOrigin, frustum)
      streamGround(anchor)
      if (ground && options.vegetation && options.vegetation.wind.uniforms.groundMap.value !== ground.texture) options.vegetation.wind.setGround(ground)
      worldSpace.position.set(-renderOrigin[0], 0, -renderOrigin[1])
      grass?.update(camera, performance.now() / 1000, player)
    },
    async preload(target) {
      await loadAround(target)
      streamPlants(target)
      if (options.vegetation) installGround(await pool.run({ type: 'ground', world: seed, center: [Math.round(target.x), Math.round(target.z)] }, 0))
    },
    async map(size) {
      const { pixels } = await pool.run({ type: 'map', world: seed, size }, 3)
      return new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, size, size)
    },
    collisionReady: (position) => collisionNodes(position.x, position.z, origin, LEAF_SIZE / 2).every((node) => !!stream.tile(node.level, node.ix, node.iz)),
    dispose() {
      disposed = true; stream.dispose(); terrain?.dispose(); vegetation?.dispose(); grass?.dispose(); ground?.dispose()
      for (const mesh of [sea, water]) { mesh?.geometry.dispose(); (mesh?.material as THREE.MeshStandardMaterial | undefined)?.normalMap?.dispose(); (mesh?.material as THREE.Material | undefined)?.dispose() }
    },
  }
  return runtime
}
