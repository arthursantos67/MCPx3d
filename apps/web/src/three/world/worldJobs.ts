import { textureData } from '../sceneTextures.ts'
import { generateTile, measureBlockErrors } from './terrainTile.ts'
import { createHeightSource, type HeightSource } from './worldTerrain.ts'
import type { WorldJob, WorldJobResults, WorldSeed } from './worldProtocol.ts'

const sources = new Map<string, HeightSource>()
function source(world: WorldSeed): HeightSource {
  const key = JSON.stringify([world.seed, world.terrain])
  let found = sources.get(key)
  if (!found) {
    if (sources.size > 4) sources.clear()
    found = createHeightSource(world)
    sources.set(key, found)
  }
  return found
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
  const heights = source(job.world), blocks = job.blocks.map((block) => measureBlockErrors(heights, block.x, block.z, job.levels, block.last))
  return { result: { blocks, ms: performance.now() - started }, transfer: blocks.map((block) => block.buffer as ArrayBuffer) }
}
