/**
 * CDLOD quadtree over the world's terrain. Every node is a GRID×GRID cell patch; level 0 has 1 m spacing and each
 * level doubles it. How far each level reaches comes from the vertical error measured where the node lies, so the
 * geometry drawn at any distance deviates from the level-0 surface by at most `tolerancePx` on screen while flat
 * ground coarsens early and only cliffs and ridges keep fine detail. Pure and allocation-light: selection runs on
 * the main thread every frame.
 */
export const GRID = 64
export const LEAF_SIZE = 64
/** Each drawn instance is one quarter of a node, so a partially subdivided node draws only its remaining quarters. */
export const QUARTER = GRID / 2
/** Stand-in for "no limit" in GPU attributes, where Infinity would turn the morph into NaN. */
export const FAR = 1e9

export interface LodSettings { pixelHeight: number; fovY: number; tolerancePx: number; morphFraction: number }
export interface Bounds { minY: number; maxY: number }
export interface QuarterDraw { level: number; ix: number; iz: number; quarter: number }

export const levelCount = (size: number) => Math.max(1, Math.ceil(Math.log2(Math.max(size, LEAF_SIZE) / LEAF_SIZE)) + 1)
export const nodeSize = (level: number) => LEAF_SIZE * 2 ** level
export const tileKey = (level: number, ix: number, iz: number) => `${level}:${ix}:${iz}`

/** Pixels per metre of vertical error at unit distance. */
export const projectionScale = (settings: Pick<LodSettings, 'pixelHeight' | 'fovY'>) => settings.pixelHeight / (2 * Math.tan(settings.fovY / 2))

/**
 * Per-level range field on each level's lattice of node corners. A vertex of a level-L patch morphs towards level
 * L+1 over the last `morphFraction` of r_L, bilinear between its node's corners; every patch sharing a vertex sees
 * the same value, and a node's reach is the largest of its corners.
 */
export interface LodField {
  readonly levels: number
  readonly morphFraction: number
  /** Corner values of level L, (nodes + 1)² row-major. */
  readonly corners: Float32Array[]
  readonly nodes: [number, number][]
  reach(level: number, ix: number, iz: number): number
  /** Largest reach among the node's children: closer than this, the node must subdivide. */
  finer(level: number, ix: number, iz: number): number
  corner(level: number, i: number, j: number): number
  /** Depth of the node's border skirt, in metres: at least the largest gap two neighbouring patches can leave. */
  skirt(level: number, ix: number, iz: number): number
}

/**
 * Builds the field from `cellErrors[L]`: for each 64 m cell, the largest vertical distance between the level-L mesh
 * and the level-0 surface. Rules, each one checked by tests:
 * - while a level-L vertex morphs, its error is at most the level-(L+1) error around it, so morphing starts only
 *   where that error projects under the tolerance;
 * - a node drawn unmorphed lies beyond its children's reach, which already covers its own error;
 * - a node reaches at least as far as its children, so their detail is never skipped;
 * - patches of different levels meet within 2 px of each other (each is within 1 px of the surface), and the
 *   skirt hanging from every border covers that gap.
 */
export function buildLodField(cellErrors: Float32Array[], cells: [number, number], settings: LodSettings): LodField {
  const levels = cellErrors.length, keep = 1 - settings.morphFraction, scale = projectionScale(settings) / settings.tolerancePx
  const corners: Float32Array[] = [], nodes: [number, number][] = [], skirts: Float32Array[] = []
  for (let level = 0; level < levels; level++) {
    const span = 2 ** level, nx = Math.ceil(cells[0] / span), nz = Math.ceil(cells[1] / span), size = nodeSize(level)
    nodes.push([nx, nz])
    const values = new Float32Array((nx + 1) * (nz + 1))
    const own = cellErrors[level], depth = new Float32Array(nx * nz)
    skirts.push(depth)
    if (level === levels - 1) { values.fill(FAR); corners.push(values); continue }
    // A morphing vertex moves onto the level-(L+1) triangle that contains it, which lies inside the parent node.
    const next = cellErrors[level + 1], parent = span * 2, required = new Float32Array(nx * nz)
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      let worst = 0
      const pz = (iz >> 1) * parent, px = (ix >> 1) * parent
      for (let cz = pz; cz < Math.min(cells[1], pz + parent); cz++)
        for (let cx = px; cx < Math.min(cells[0], px + parent); cx++) worst = Math.max(worst, next[cz * cells[0] + cx])
      required[iz * nx + ix] = Math.max(worst * scale / keep, size * 1.5)
      // Either side of a border may be off by its own error or, while morphing, the next level's: the gap is at most their sum.
      let self = 0
      for (let cz = iz * span; cz < Math.min(cells[1], (iz + 1) * span); cz++) for (let cx = ix * span; cx < Math.min(cells[0], (ix + 1) * span); cx++) self = Math.max(self, own[cz * cells[0] + cx])
      depth[iz * nx + ix] = 2 * Math.max(worst, self) + 0.25
    }
    const finer = level ? corners[level - 1] : null, [fx, fz] = level ? nodes[level - 1] : [0, 0]
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      let value = 0
      for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
        const ix = i + dx, iz = j + dz
        if (ix >= 0 && iz >= 0 && ix < nx && iz < nz) value = Math.max(value, required[iz * nx + ix])
      }
      // A node must reach at least as far as its children, or the region between would never get their detail.
      if (finer) for (let fj = Math.max(0, j * 2 - 2); fj <= Math.min(fz, j * 2 + 2); fj++) for (let fi = Math.max(0, i * 2 - 2); fi <= Math.min(fx, i * 2 + 2); fi++) value = Math.max(value, finer[fj * (fx + 1) + fi])
      values[j * (nx + 1) + i] = value
    }
    corners.push(values)
  }
  const corner = (level: number, i: number, j: number) => corners[level][j * (nodes[level][0] + 1) + i]
  return {
    levels, morphFraction: settings.morphFraction, corners, nodes, corner,
    skirt: (level, ix, iz) => level === levels - 1 ? 2 * cellErrors[level].reduce((a, b) => Math.max(a, b), 0) + 0.25 : skirts[level][iz * nodes[level][0] + ix],
    reach: (level, ix, iz) => Math.max(corner(level, ix, iz), corner(level, ix + 1, iz), corner(level, ix, iz + 1), corner(level, ix + 1, iz + 1)),
    finer(level, ix, iz) {
      if (!level) return 0
      let value = 0
      for (let j = iz * 2; j <= iz * 2 + 2; j++) for (let i = ix * 2; i <= ix * 2 + 2; i++) value = Math.max(value, corner(level - 1, i, j))
      return value
    },
  }
}

/** Range at world point (x, z) for a vertex of a level-L patch: bilinear between the node's corners. */
export function fieldRange(field: LodField, level: number, origin: [number, number], x: number, z: number, ix: number, iz: number): number {
  const size = nodeSize(level), u = Math.min(1, Math.max(0, (x - origin[0]) / size - ix)), v = Math.min(1, Math.max(0, (z - origin[1]) / size - iz))
  const a = field.corner(level, ix, iz), b = field.corner(level, ix + 1, iz), c = field.corner(level, ix, iz + 1), d = field.corner(level, ix + 1, iz + 1)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Squared distance from a point to an axis-aligned box. */
export function boxDistanceSq(px: number, py: number, pz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0, dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0, dz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0
  return dx * dx + dy * dy + dz * dz
}

export interface SelectionInput {
  camera: [number, number, number]
  /** World origin of node (level, 0, 0): the minimum corner of the world. */
  origin: [number, number]
  levels: number
  field: LodField
  /** Height bounds of a node; resident nodes report measured bounds, others conservative ones. */
  bounds: (level: number, ix: number, iz: number) => Bounds
  /** True when the node's tile is uploaded and drawable. */
  resident: (level: number, ix: number, iz: number) => boolean
  /** Frustum test on a world box; omitted for selections that must not be culled (collision rings). */
  visible?: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => boolean
  /** Nodes inside the world on each axis at the root level (1 for square worlds smaller than the root). */
  roots: [number, number]
}
export interface Selection { draws: QuarterDraw[]; wanted: { level: number; ix: number; iz: number; distance: number }[]; deficit: number }

/**
 * Standard CDLOD selection, plus residency: when a required finer node is not loaded yet, its coarser parent quarter
 * is drawn instead and counted in `deficit` (a visible LOD shortfall the streamer must keep at zero), and the
 * missing node is reported in `wanted`. Nodes inside the prefetch margin are wanted before they are needed.
 */
export function selectNodes(input: SelectionInput, prefetch = 1.25): Selection {
  const draws: QuarterDraw[] = [], wanted: Selection['wanted'] = [], [cx, cy, cz] = input.camera
  let deficit = 0
  const box = (level: number, ix: number, iz: number) => {
    const size = nodeSize(level), x0 = input.origin[0] + ix * size, z0 = input.origin[1] + iz * size, bounds = input.bounds(level, ix, iz)
    return [x0, bounds.minY, z0, x0 + size, bounds.maxY, z0 + size] as const
  }
  const distanceSq = (level: number, ix: number, iz: number) => { const b = box(level, ix, iz); return boxDistanceSq(cx, cy, cz, ...b) }
  const want = (level: number, ix: number, iz: number) => { if (!input.resident(level, ix, iz)) wanted.push({ level, ix, iz, distance: Math.sqrt(distanceSq(level, ix, iz)) }) }
  // Returns false when the node lies beyond its own range (or is not loaded), so the parent keeps that quarter.
  // Nodes outside the frustum are still walked without drawing, so turning the camera finds them loaded.
  const visit = (level: number, ix: number, iz: number, draw: boolean): boolean => {
    const reach = input.field.reach(level, ix, iz), distance = distanceSq(level, ix, iz)
    if (level < input.levels - 1 && distance > reach * reach) {
      if (distance <= reach * reach * prefetch * prefetch) want(level, ix, iz)
      return false
    }
    if (!input.resident(level, ix, iz)) { want(level, ix, iz); return false }
    if (draw && input.visible && !input.visible(...box(level, ix, iz))) draw = false
    const finer = input.field.finer(level, ix, iz)
    if (level === 0 || distance > finer * finer) {
      if (draw) for (let quarter = 0; quarter < 4; quarter++) draws.push({ level, ix, iz, quarter })
      if (level > 0 && distance <= finer * finer * prefetch * prefetch) for (let quarter = 0; quarter < 4; quarter++) visit(level - 1, ix * 2 + (quarter & 1), iz * 2 + (quarter >> 1), false)
      return true
    }
    for (let quarter = 0; quarter < 4; quarter++) {
      const childX = ix * 2 + (quarter & 1), childZ = iz * 2 + (quarter >> 1)
      if (visit(level - 1, childX, childZ, draw) || !draw) continue
      const childReach = input.field.reach(level - 1, childX, childZ)
      if (distanceSq(level - 1, childX, childZ) <= childReach * childReach) deficit++
      draws.push({ level, ix, iz, quarter })
    }
    return true
  }
  const top = input.levels - 1
  for (let iz = 0; iz < input.roots[1]; iz++) for (let ix = 0; ix < input.roots[0]; ix++) visit(top, ix, iz, true)
  wanted.sort((a, b) => a.distance - b.distance || b.level - a.level)
  return { draws, wanted, deficit }
}

/**
 * Height on the level-L triangulation of a tile: cells split along the (i, j) → (i+1, j+1) diagonal at every level,
 * so coarser meshes are nested in finer ones and the GPU mesh, collision and error measurement agree exactly.
 */
export function interpolateCell(h00: number, h10: number, h01: number, h11: number, fx: number, fz: number): number {
  return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz
}

/**
 * Distance from a point at height `height` to the plane of the cell triangle under it, for a cell `spacing` metres
 * wide: the vertical difference scaled by the triangle's cosine. A displaced surface is seen by how far it moves,
 * not by its vertical offset, so this is the geometric error; on flat ground both are equal, on a cliff a 1 m
 * horizontal shift no longer counts as tens of metres.
 */
export function cellPlaneDistance(h00: number, h10: number, h01: number, h11: number, fx: number, fz: number, spacing: number, height: number): number {
  const gx = (fx >= fz ? h10 - h00 : h11 - h01) / spacing, gz = (fx >= fz ? h11 - h10 : h01 - h00) / spacing
  return Math.abs(height - interpolateCell(h00, h10, h01, h11, fx, fz)) / Math.sqrt(1 + gx * gx + gz * gz)
}
