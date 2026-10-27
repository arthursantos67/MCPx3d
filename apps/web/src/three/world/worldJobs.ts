import { textureData } from '../sceneTextures.ts'
import { generateTile, measureBlockErrors } from './terrainTile.ts'
import { buildMacro, waterMesh, type MacroLayout, type WorldMacro } from './worldMacro.ts'
import { createHeightSource, type HeightSource } from './worldTerrain.ts'
import { placeVegetation } from './worldVegetation.ts'
import { groundWindow } from './worldGround.ts'
import { placeLocations } from './worldGeneration.ts'
import { mapImage } from './worldMap.ts'
import type { MacroFields, WorldJob, WorldJobResults, WorldSeed } from './worldProtocol.ts'

const sources = new Map<string, HeightSource>(), installed = new Map<string, MacroFields>()
const worldKey = (world: WorldSeed) => JSON.stringify([world.seed, world.terrain])
/** Climate worlds add erosion and river beds to the base relief; the macro relief must be installed first. */
export const needsMacro = (world: WorldSeed) => world.terrain.kind === 'climate'
function source(world: WorldSeed): HeightSource {
  const key = worldKey(world)
  let found = sources.get(key)
  if (!found) {
    const fields = installed.get(key)
    if (needsMacro(world) && !fields) throw new Error('Relevo macro do mundo ainda não instalado neste worker.')
    if (sources.size > 4) sources.clear()
    found = createHeightSource(world, needsMacro(world) ? fields : null)
    sources.set(key, found)
  }
  return found
}

/** Erosion, drainage and climate of a world, from its base relief. */
export function buildWorldMacro(world: WorldSeed, layout?: MacroLayout): WorldMacro {
  const base = createHeightSource(world), climate = needsMacro(world)
  return buildMacro({ seed: world.seed, size: world.terrain.size, range: world.terrain.heightRange, seaLevel: world.terrain.seaLevel,
    erosion: climate ? world.terrain.erosion : 0, rivers: climate, climate: world.terrain.climate, base: base.heightAt, layout: climate ? layout : undefined })
}

/** Executes one job; shared by the worker and by tests, so both produce identical data. */
export function runWorldJob(job: WorldJob): { result: WorldJobResults[WorldJob['type']]; transfer: ArrayBuffer[] } {
  const started = performance.now()
  if (job.type === 'tile') {
    const tile = generateTile(source(job.world), job.origin, job.level, job.ix, job.iz)
    return { result: { ...tile, ms: performance.now() - started }, transfer: [tile.heights.buffer as ArrayBuffer] }
  }
  if (job.type === 'texture') {
    const data = textureData(job.kind)
    return { result: { ...data, ms: performance.now() - started }, transfer: [data.color.buffer as ArrayBuffer, data.normal.buffer as ArrayBuffer, data.rough.buffer as ArrayBuffer] }
  }
  if (job.type === 'macro') {
    const macro = buildWorldMacro(job.world, job.layout), mesh = waterMesh(macro)
    const arrays = [macro.delta, macro.water, macro.river, macro.temperature, macro.humidity, macro.ground, macro.biome, macro.drain, macro.filled, macro.clear, macro.siteLevels, mesh.positions, mesh.indices]
    return { result: { macro, mesh, ms: performance.now() - started }, transfer: arrays.map((array) => array.buffer as ArrayBuffer) }
  }
  if (job.type === 'install') {
    const key = worldKey(job.world)
    installed.set(key, job.fields); sources.delete(key)
    return { result: { ms: performance.now() - started }, transfer: [] }
  }
  if (job.type === 'place') {
    const seed = { seed: job.world.seed, terrain: job.world.terrain }, macro = buildWorldMacro(seed), heights = createHeightSource(seed, needsMacro(seed) ? macro : null), notes: string[] = []
    const world = placeLocations(job.world, job.intents, { heightAt: heights.heightAt, macro }, notes, job.only ? new Set(job.only) : undefined)
    return { result: { world, notes, ms: performance.now() - started }, transfer: [] }
  }
  if (job.type === 'map') {
    const fields = installed.get(worldKey(job.world))
    if (!fields) throw new Error('Campos macro do mundo ainda não instalados neste worker.')
    const pixels = mapImage(source(job.world).heightAt, fields, job.world.terrain, job.size)
    return { result: { pixels, size: job.size, ms: performance.now() - started }, transfer: [pixels.buffer as ArrayBuffer] }
  }
  if (job.type === 'ground') {
    const fields = installed.get(worldKey(job.world))
    if (!fields) throw new Error('Campos macro do mundo ainda não instalados neste worker.')
    const window = groundWindow(source(job.world).heightAt, fields, job.center, job.world.terrain.seaLevel)
    return { result: { ...window, ms: performance.now() - started }, transfer: [window.data.buffer as ArrayBuffer, window.tint.buffer as ArrayBuffer] }
  }
  if (job.type === 'vegetation') {
    const fields = installed.get(worldKey(job.world))
    if (!fields) throw new Error('Campos macro do mundo ainda não instalados neste worker.')
    const heights = source(job.world), input = { seed: job.world.seed, density: job.density, heightAt: heights.heightAt, macro: fields, seaLevel: job.world.terrain.seaLevel }
    const cells = job.cells.map(([cx, cz]) => ({ cx, cz, plants: placeVegetation(input, job.origin, cx, cz) }))
    return { result: { cells, ms: performance.now() - started }, transfer: cells.flatMap((cell) => Object.values(cell.plants).map((array) => array!.buffer as ArrayBuffer)) }
  }
  const heights = source(job.world), blocks = job.blocks.map((block) => measureBlockErrors(heights, block.x, block.z, job.levels, block.last))
  return { result: { blocks, ms: performance.now() - started }, transfer: blocks.map((block) => block.buffer as ArrayBuffer) }
}
