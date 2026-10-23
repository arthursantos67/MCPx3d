import { cellPlaneDistance, GRID, interpolateCell, LEAF_SIZE, nodeSize } from './cdlod.ts'
import type { HeightSource } from './worldTerrain.ts'

/** One-sample apron on every side lets the GPU take central-difference normals at tile borders. */
export const APRON = 1
export const TILE_SAMPLES = GRID + 1 + 2 * APRON

export interface TileData { level: number; ix: number; iz: number; heights: Float32Array; minY: number; maxY: number }

/** Heights of node (level, ix, iz) on its own lattice, rounded to float32 exactly as the GPU and collision read them. */
export function generateTile(source: HeightSource, origin: [number, number], level: number, ix: number, iz: number): TileData {
  const size = nodeSize(level), spacing = size / GRID, x0 = origin[0] + ix * size - APRON * spacing, z0 = origin[1] + iz * size - APRON * spacing
  const heights = new Float32Array(TILE_SAMPLES * TILE_SAMPLES)
  let minY = Infinity, maxY = -Infinity
  for (let j = 0; j < TILE_SAMPLES; j++) for (let i = 0; i < TILE_SAMPLES; i++) {
    const height = Math.fround(source.heightAt(x0 + i * spacing, z0 + j * spacing))
    heights[j * TILE_SAMPLES + i] = height
    if (i >= APRON && j >= APRON && i <= GRID + APRON && j <= GRID + APRON) { if (height < minY) minY = height; if (height > maxY) maxY = height }
  }
  return { level, ix, iz, heights, minY, maxY }
}

/** Interior height of a tile at lattice point (i, j), 0 ≤ i, j ≤ GRID. */
export const tileHeight = (tile: TileData, i: number, j: number) => tile.heights[(j + APRON) * TILE_SAMPLES + i + APRON]

/** Height on the tile's own triangulation at world point (x, z) inside the node. */
export function tileSurface(tile: TileData, origin: [number, number], x: number, z: number): number {
  const size = nodeSize(tile.level), spacing = size / GRID
  const u = Math.min(GRID - 1e-9, Math.max(0, (x - origin[0] - tile.ix * size) / spacing)), v = Math.min(GRID - 1e-9, Math.max(0, (z - origin[1] - tile.iz * size) / spacing))
  const i = Math.floor(u), j = Math.floor(v)
  return interpolateCell(tileHeight(tile, i, j), tileHeight(tile, i + 1, j), tileHeight(tile, i, j + 1), tileHeight(tile, i + 1, j + 1), u - i, v - j)
}

export const ERROR_BLOCK = 256
export const ERROR_CELL = LEAF_SIZE

/** Side, in metres, of the blocks the error pass works on: large enough to contain one cell of the coarsest level. */
export const errorBlockSize = (levels: number) => Math.max(ERROR_BLOCK, nodeSize(levels - 1) / GRID) * (LEAF_SIZE / GRID)

/**
 * Geometric error of every level's mesh against the level-0 surface, per 64 m cell of one block of the 1 m lattice:
 * the largest distance from a level-0 vertex to the plane of the level-L triangle above or below it. The two
 * surfaces are nested and piecewise planar, so the farthest points are level-0 vertices and every one is checked. `last` includes the far border rows of the world.
 * Result layout: [level][cell row][cell column], (block / 64)² cells per level.
 */
export function measureBlockErrors(source: HeightSource, x0: number, z0: number, levels: number, last: [boolean, boolean]): Float32Array {
  const spacing = LEAF_SIZE / GRID, block = errorBlockSize(levels) / spacing, samples = block + 1, cellSide = ERROR_CELL / spacing, cellsPerSide = block / cellSide
  const heights = new Float64Array(samples * samples), errors = new Float32Array(levels * cellsPerSide * cellsPerSide)
  for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) heights[j * samples + i] = Math.fround(source.heightAt(x0 + i * spacing, z0 + j * spacing))
  const endI = last[0] ? block : block - 1, endJ = last[1] ? block : block - 1
  for (let level = 1; level < levels; level++) {
    const step = 2 ** level, offset = level * cellsPerSide * cellsPerSide
    for (let j = 0; j <= endJ; j++) {
      const cj = Math.floor(j / step) * step, fz = (j - cj) / step, nj = Math.min(cj + step, block), row = Math.min(cellsPerSide - 1, Math.floor(j / cellSide))
      for (let i = 0; i <= endI; i++) {
        const ci = Math.floor(i / step) * step, fx = (i - ci) / step, ni = Math.min(ci + step, block)
        const error = cellPlaneDistance(heights[cj * samples + ci], heights[cj * samples + ni], heights[nj * samples + ci], heights[nj * samples + ni], fx, fz, step * spacing, heights[j * samples + i]), cell = offset + row * cellsPerSide + Math.min(cellsPerSide - 1, Math.floor(i / cellSide))
        if (error > errors[cell]) errors[cell] = error
      }
    }
  }
  return errors
}

/** Blocks covering a world of `size` metres whose lattice starts at `origin`. */
export function errorBlocks(size: [number, number], origin: [number, number], levels: number): { x: number; z: number; last: [boolean, boolean] }[] {
  const block = errorBlockSize(levels), nx = Math.ceil(size[0] / block), nz = Math.ceil(size[1] / block), blocks = []
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) blocks.push({ x: origin[0] + i * block, z: origin[1] + j * block, last: [i === nx - 1, j === nz - 1] as [boolean, boolean] })
  return blocks
}

/** Gathers per-block results into one 64 m grid per level, plus each level's worldwide maximum. */
export function assembleCellErrors(blocks: { x: number; z: number }[], results: Float32Array[], origin: [number, number], cells: [number, number], levels: number): { cells: Float32Array[]; max: number[] } {
  const grids = Array.from({ length: levels }, () => new Float32Array(cells[0] * cells[1])), max = new Array(levels).fill(0)
  const perSide = errorBlockSize(levels) / ERROR_CELL
  blocks.forEach((block, index) => {
    const bx = Math.round((block.x - origin[0]) / ERROR_CELL), bz = Math.round((block.z - origin[1]) / ERROR_CELL), result = results[index]
    for (let level = 0; level < levels; level++) for (let j = 0; j < perSide; j++) for (let i = 0; i < perSide; i++) {
      const x = bx + i, z = bz + j
      if (x >= cells[0] || z >= cells[1]) continue
      const value = result[level * perSide * perSide + j * perSide + i]
      grids[level][z * cells[0] + x] = value
      if (value > max[level]) max[level] = value
    }
  })
  for (let level = 1; level < levels; level++) max[level] = Math.max(max[level], max[level - 1])
  return { cells: grids, max }
}
