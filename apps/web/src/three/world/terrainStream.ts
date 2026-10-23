import { nodeSize, tileKey, type Bounds } from './cdlod.ts'
import { TILE_SAMPLES, type TileData } from './terrainTile.ts'

export interface ResidentTile extends TileData { layer: number; used: number }
export interface StreamStats { resident: number; inFlight: number; ready: number; applied: number; applyMs: number; evicted: number; dropped: number; generated: number; generateMs: number }

export interface TerrainStream {
  readonly capacity: number
  /** Heights of all resident tiles, one TILE_SAMPLES² layer each, in GPU upload order. */
  readonly data: Float32Array
  /** Layers rewritten since the last `takeDirty`. */
  takeDirty(): number[]
  beginFrame(): void
  resident(level: number, ix: number, iz: number): boolean
  tile(level: number, ix: number, iz: number): ResidentTile | undefined
  /** Resident tiles of one level (level 0 serves collision). */
  level(level: number): ResidentTile[]
  bounds(level: number, ix: number, iz: number): Bounds
  /** Starts generation for the wanted nodes, nearest first, keeping at most `maxInFlight` jobs running. */
  request(wanted: { level: number; ix: number; iz: number }[]): void
  /** Moves finished tiles into layers until `budgetMs` of main-thread time is used. */
  apply(budgetMs: number, now?: () => number): number
  readonly stats: StreamStats
  /** Resolves once every listed node is resident (preloading before play or fast travel). */
  whenResident(nodes: { level: number; ix: number; iz: number }[]): Promise<void>
  dispose(): void
}

export interface StreamOptions {
  capacity: number
  levels: number
  /** Conservative vertical error per level, used to bound nodes whose tiles are not loaded. */
  errors: number[]
  range: [number, number]
  generate: (level: number, ix: number, iz: number) => Promise<TileData & { ms?: number }>
  maxInFlight: number
  /** Tiles applied per frame at most, which also bounds GPU uploads (TILE_SAMPLES² floats each). */
  maxPerFrame?: number
}

export function createTerrainStream(options: StreamOptions): TerrainStream {
  const layerSize = TILE_SAMPLES * TILE_SAMPLES, data = new Float32Array(options.capacity * layerSize)
  const tiles = new Map<string, ResidentTile>(), byLayer: (ResidentTile | null)[] = new Array(options.capacity).fill(null)
  const inFlight = new Set<string>(), ready: (TileData & { ms?: number })[] = [], dirty = new Set<number>()
  const waiters: { keys: string[]; resolve: () => void }[] = []
  let frame = 0, disposed = false
  const stats: StreamStats = { resident: 0, inFlight: 0, ready: 0, applied: 0, applyMs: 0, evicted: 0, dropped: 0, generated: 0, generateMs: 0 }
  const top = options.levels - 1
  const allocate = (): number => {
    const free = byLayer.indexOf(null)
    if (free >= 0) return free
    let victim = -1, oldest = Infinity
    for (let layer = 0; layer < byLayer.length; layer++) {
      const tile = byLayer[layer]!
      if (tile.level === top || tile.used >= frame - 1) continue
      // Prefer evicting fine tiles: their parents can stand in, while a missing coarse tile hides everything below it.
      const age = tile.used - tile.level * 2
      if (age < oldest) { oldest = age; victim = layer }
    }
    if (victim < 0) return -1
    tiles.delete(tileKey(byLayer[victim]!.level, byLayer[victim]!.ix, byLayer[victim]!.iz))
    byLayer[victim] = null
    stats.evicted++
    return victim
  }
  const settle = () => {
    for (let index = waiters.length - 1; index >= 0; index--) if (waiters[index].keys.every((key) => tiles.has(key))) waiters.splice(index, 1)[0].resolve()
  }
  const stream: TerrainStream = {
    capacity: options.capacity, data, stats,
    takeDirty() { const layers = [...dirty]; dirty.clear(); return layers },
    beginFrame() { frame++ },
    resident(level, ix, iz) { const tile = tiles.get(tileKey(level, ix, iz)); if (tile) tile.used = frame; return !!tile },
    tile: (level, ix, iz) => tiles.get(tileKey(level, ix, iz)),
    level: (level) => [...tiles.values()].filter((tile) => tile.level === level),
    bounds(level, ix, iz) {
      const own = tiles.get(tileKey(level, ix, iz))
      if (own) return own
      for (let parent = level + 1, px = ix >> 1, pz = iz >> 1; parent < options.levels; parent++, px >>= 1, pz >>= 1) {
        const tile = tiles.get(tileKey(parent, px, pz))
        if (tile) return { minY: tile.minY - options.errors[parent], maxY: tile.maxY + options.errors[parent] }
      }
      return { minY: options.range[0], maxY: options.range[1] }
    },
    request(wanted) {
      for (const node of wanted) {
        if (inFlight.size >= options.maxInFlight) break
        const key = tileKey(node.level, node.ix, node.iz)
        if (tiles.has(key) || inFlight.has(key) || ready.some((tile) => tile.level === node.level && tile.ix === node.ix && tile.iz === node.iz)) continue
        inFlight.add(key)
        options.generate(node.level, node.ix, node.iz).then((tile) => {
          inFlight.delete(key)
          if (disposed) return
          stats.generated++; stats.generateMs += tile.ms ?? 0
          ready.push(tile)
        }, () => { inFlight.delete(key); stats.dropped++ })
      }
      stats.inFlight = inFlight.size
    },
    apply(budgetMs, now = () => performance.now()) {
      const started = now(), limit = options.maxPerFrame ?? 16
      let applied = 0
      // Coarse tiles first: they unlock their children and cover more of the screen.
      ready.sort((a, b) => b.level - a.level)
      while (ready.length && applied < limit && now() - started < budgetMs) {
        const tile = ready.shift()!, key = tileKey(tile.level, tile.ix, tile.iz)
        if (tiles.has(key)) continue
        const layer = allocate()
        if (layer < 0) { ready.unshift(tile); break }
        data.set(tile.heights, layer * layerSize)
        const resident: ResidentTile = { level: tile.level, ix: tile.ix, iz: tile.iz, heights: data.subarray(layer * layerSize, (layer + 1) * layerSize), minY: tile.minY, maxY: tile.maxY, layer, used: frame }
        tiles.set(key, resident)
        byLayer[layer] = resident
        dirty.add(layer)
        applied++
      }
      stats.resident = tiles.size; stats.ready = ready.length; stats.applied += applied; stats.applyMs = now() - started
      if (applied) settle()
      return applied
    },
    whenResident(nodes) {
      const keys = nodes.map((node) => tileKey(node.level, node.ix, node.iz))
      if (keys.every((key) => tiles.has(key))) return Promise.resolve()
      return new Promise((resolve) => { waiters.push({ keys, resolve }); stream.request(nodes) })
    },
    dispose() { disposed = true; tiles.clear(); ready.length = 0; for (const waiter of waiters.splice(0)) waiter.resolve() },
  }
  return stream
}

/** Level-0 nodes whose tiles must be resident for collision around a point. */
export function collisionNodes(x: number, z: number, origin: [number, number], radius: number): { level: number; ix: number; iz: number }[] {
  const size = nodeSize(0), nodes = []
  for (let iz = Math.floor((z - radius - origin[1]) / size); iz <= Math.floor((z + radius - origin[1]) / size); iz++)
    for (let ix = Math.floor((x - radius - origin[0]) / size); ix <= Math.floor((x + radius - origin[0]) / size); ix++) nodes.push({ level: 0, ix, iz })
  return nodes
}
