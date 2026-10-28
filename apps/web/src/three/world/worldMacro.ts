import { noised, random, smoothstep, type NoiseSample } from './worldNoise.ts'

/**
 * World-scale fields on an 8 m grid, computed once per world in a worker: hydraulic erosion, drainage with lakes and
 * rivers carved down to the sea, and climate (temperature, humidity) turned into ground-layer weights. Everything is
 * sequential with a seeded PRNG, so a world always produces the same fields.
 */
export const MACRO_CELL = 8
/** Ground layers of the splat, in texture-array order. */
export const GROUND_LAYERS = ['grass', 'forest', 'sand', 'dry', 'mud', 'snow', 'rock', 'taiga'] as const
export type GroundLayer = typeof GROUND_LAYERS[number]
export const BIOMES = ['ocean', 'beach', 'grassland', 'forest', 'rainforest', 'savanna', 'desert', 'swamp', 'taiga', 'tundra', 'snow', 'alpine'] as const

export interface ClimateSettings { temperature: number; humidity: number; wind: number }
export interface MacroInput {
  seed: number
  size: [number, number]
  range: [number, number]
  seaLevel: number | null
  erosion: number
  climate: ClimateSettings
  /** Base relief before erosion. */
  base: (x: number, z: number) => number
  rivers: boolean
  /** Settlement footprints flattened and cleared, and roads to carve between them. */
  layout?: MacroLayout
}
export interface MacroLayout { sites: { x: number; z: number; radius: number }[]; roads: { from: number; to: number; width: number }[] }
export interface WorldMacro {
  cell: number
  /** Grid points per axis. */
  points: [number, number]
  origin: [number, number]
  /** Metres added to the base relief: erosion and river beds. */
  delta: Float32Array
  /** Water surface height (lakes, rivers), NaN where dry; the sea is separate. */
  water: Float32Array
  lake?: Uint8Array
  /** 0..1 river presence, for wet banks. */
  river: Float32Array
  temperature: Float32Array
  humidity: Float32Array
  /** GROUND_LAYERS.length weights per point, 0–255, summing to ~255. */
  ground: Uint8Array
  /** Index into BIOMES per point. */
  biome: Uint8Array
  /** Next point downstream (-1 at the sea and the borders): every land point drains to an outlet. */
  drain: Int32Array
  /** Water level after filling depressions (lakes keep this level). */
  filled: Float32Array
  /** 0..1 where settlements and roads keep the ground free of vegetation. */
  clear: Float32Array
  /** Road centrelines in world coordinates. */
  roads: [number, number][][]
  /** Ground level each layout site was flattened to (NaN when none), in layout order. */
  siteLevels: Float32Array
  /** Exact flat footprints (x, z, radius, level), applied after interpolation on every thread. */
  pads?: Float32Array
  stats: { droplets: number; lakes: number; riverCells: number; ms: number }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** Droplet erosion (after Beyer 2015 / Lague 2019) on heights normalised by the elevation span. */
function erode(heights: Float32Array, nx: number, nz: number, droplets: number, seed: number): void {
  const next = random(seed), radius = 3, brush: [number, number, number][] = []
  let total = 0
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const weight = Math.max(0, radius - Math.hypot(dx, dz))
    if (weight > 0) { brush.push([dx, dz, weight]); total += weight }
  }
  for (const entry of brush) entry[2] /= total
  const inertia = 0.05, capacityFactor = 4, minCapacity = 0.01, depositSpeed = 0.3, erodeSpeed = 0.3, evaporate = 0.01, gravity = 4, life = 30
  const sample = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, i = iz * nx + ix
    const a = heights[i], b = heights[i + 1], c = heights[i + nx], d = heights[i + nx + 1]
    return { height: a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz, gx: (b - a) * (1 - fz) + (d - c) * fz, gz: (c - a) * (1 - fx) + (d - b) * fx }
  }
  for (let drop = 0; drop < droplets; drop++) {
    let x = next() * (nx - 2), z = next() * (nz - 2), dx = 0, dz = 0, speed = 1, water = 1, sediment = 0
    for (let step = 0; step < life; step++) {
      const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, here = sample(x, z)
      dx = dx * inertia - here.gx * (1 - inertia); dz = dz * inertia - here.gz * (1 - inertia)
      const length = Math.hypot(dx, dz)
      if (length < 1e-9) break
      dx /= length; dz /= length; x += dx; z += dz
      if (x < 0 || z < 0 || x >= nx - 1 || z >= nz - 1) break
      const dh = sample(x, z).height - here.height, capacity = Math.max(-dh * speed * water * capacityFactor, minCapacity)
      const i = iz * nx + ix
      if (sediment > capacity || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositSpeed
        sediment -= amount
        heights[i] += amount * (1 - fx) * (1 - fz); heights[i + 1] += amount * fx * (1 - fz); heights[i + nx] += amount * (1 - fx) * fz; heights[i + nx + 1] += amount * fx * fz
      } else {
        const amount = Math.min((capacity - sediment) * erodeSpeed, -dh)
        for (const [bx, bz, weight] of brush) {
          const px = ix + bx, pz = iz + bz
          if (px < 0 || pz < 0 || px >= nx || pz >= nz) continue
          const j = pz * nx + px, removed = Math.min(heights[j], amount * weight)
          heights[j] -= removed; sediment += removed
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity)); water *= 1 - evaporate
    }
  }
}

/** Binary min-heap of grid indices keyed by a float array (priority-flood). */
function heap(keys: Float32Array) {
  const items: number[] = []
  const up = (i: number) => { while (i > 0) { const p = (i - 1) >> 1; if (keys[items[p]] <= keys[items[i]]) break; [items[p], items[i]] = [items[i], items[p]]; i = p } }
  const down = (i: number) => { for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < items.length && keys[items[l]] < keys[items[m]]) m = l; if (r < items.length && keys[items[r]] < keys[items[m]]) m = r; if (m === i) break; [items[m], items[i]] = [items[i], items[m]]; i = m } }
  return { push(i: number) { items.push(i); up(items.length - 1) }, pop() { const top = items[0], last = items.pop()!; if (items.length) { items[0] = last; down(0) } return top }, get size() { return items.length } }
}

const D8: [number, number, number][] = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]]

export function buildMacro(input: MacroInput): WorldMacro {
  const started = performance.now(), cell = MACRO_CELL
  const nx = Math.round(input.size[0] / cell) + 1, nz = Math.round(input.size[1] / cell) + 1, count = nx * nz
  const origin: [number, number] = [-input.size[0] / 2, -input.size[1] / 2], [low, high] = input.range, span = high - low
  const sea = input.seaLevel ?? -Infinity
  const base = new Float32Array(count), heights = new Float32Array(count)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) base[j * nx + i] = input.base(origin[0] + i * cell, origin[1] + j * cell)
  for (let k = 0; k < count; k++) heights[k] = (base[k] - low) / span
  const droplets = Math.round(count * 0.7 * clamp(input.erosion, 0, 1))
  if (droplets) erode(heights, nx, nz, droplets, input.seed ^ 0x51ed)
  for (let k = 0; k < count; k++) heights[k] = low + heights[k] * span

  // Drainage: fill depressions from the sea and the borders, so every land point has a way down.
  const filled = new Float32Array(count).fill(Infinity), done = new Uint8Array(count), queue = heap(filled)
  for (let k = 0; k < count; k++) {
    const i = k % nx, j = Math.floor(k / nx)
    if (heights[k] <= sea || i === 0 || j === 0 || i === nx - 1 || j === nz - 1) { filled[k] = heights[k]; queue.push(k); done[k] = 1 }
  }
  const downstream = new Int32Array(count).fill(-1), order: number[] = []
  while (queue.size) {
    const k = queue.pop(), i = k % nx, j = Math.floor(k / nx)
    order.push(k)
    for (const [dx, dz] of D8) {
      const pi = i + dx, pj = j + dz
      if (pi < 0 || pj < 0 || pi >= nx || pj >= nz) continue
      const n = pj * nx + pi
      if (done[n]) continue
      done[n] = 1
      filled[n] = Math.max(heights[n], filled[k] + 1e-4)
      downstream[n] = k
      queue.push(n)
    }
  }
  // Flow accumulates from the highest filled points down the spanning tree of the flood.
  const area = new Float32Array(count).fill(cell * cell)
  for (let o = order.length - 1; o >= 0; o--) { const k = order[o], d = downstream[k]; if (d >= 0) area[d] += area[k] }

  const water = new Float32Array(count).fill(NaN), river = new Float32Array(count), delta = new Float32Array(count), lakeMask = new Uint8Array(count)
  let lakes = 0, riverCells = 0
  for (let k = 0; k < count; k++) delta[k] = heights[k] - base[k]
  // Priority-flood heights route drainage; they must not replace the terrain of entire closed basins.
  // Only bounded lakes get that water level, and tiny erosion pits are filled by at most 1.5 m.
  const seen = new Uint8Array(count), stack: number[] = []
  for (let start = 0; start < count; start++) {
    if (seen[start] || heights[start] <= sea || filled[start] - heights[start] <= 0.05) continue
    const component: number[] = []
    let deepest = 0
    seen[start] = 1; stack.push(start)
    while (stack.length) {
      const k = stack.pop()!, i = k % nx, j = Math.floor(k / nx)
      component.push(k); deepest = Math.max(deepest, filled[k] - heights[k])
      for (const [dx, dz] of D8) {
        const pi = i + dx, pj = j + dz, n = pj * nx + pi
        if (pi < 0 || pj < 0 || pi >= nx || pj >= nz || seen[n] || heights[n] <= sea || filled[n] - heights[n] <= 0.05) continue
        seen[n] = 1; stack.push(n)
      }
    }
    const lake = deepest >= 1.5 && component.length >= 64 && component.length <= 6000
    for (const k of component) { if (lake) { water[k] = filled[k]; lakeMask[k] = 1 } else if (component.length < 64) delta[k] += Math.min(1.5, filled[k] - heights[k]) }
    if (lake) lakes++
  }
  if (input.rivers) {
    // Rivers where more than ~0.35 km² drains; width and depth grow with the root of the drained area.
    const threshold = 350_000, beds: { k: number; width: number; depth: number; level: number }[] = []
    for (let k = 0; k < count; k++) {
      if (area[k] < threshold || heights[k] <= sea || !Number.isNaN(water[k])) continue
      const width = clamp(3 + 0.008 * Math.sqrt(area[k]), 3, 24), depth = 0.6 + 0.12 * width
      beds.push({ k, width, depth, level: heights[k] })
      riverCells++
    }
    for (const bed of beds) {
      const i = bed.k % nx, j = Math.floor(bed.k / nx), reach = Math.ceil((bed.width / 2 + cell * 2) / cell)
      for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
        const pi = i + dx, pj = j + dz
        if (pi < 0 || pj < 0 || pi >= nx || pj >= nz) continue
        const n = pj * nx + pi, distance = Math.hypot(dx, dz) * cell, bank = 1 - smoothstep(bed.width / 2, bed.width / 2 + cell * 2, distance)
        if (bank <= 0) continue
        const target = bed.level - bed.depth, carved = base[n] + delta[n] + (target - (base[n] + delta[n])) * bank
        if (carved < base[n] + delta[n]) delta[n] = carved - base[n]
        const lake = lakeMask[n] === 1
        if (bank > 0.2 && !lake) water[n] = Math.min(Number.isNaN(water[n]) ? Infinity : water[n], bed.level - bed.depth * 0.25)
        river[n] = Math.max(river[n], bank)
      }
    }
  }

  const clear = new Float32Array(count), roads: [number, number][][] = [], siteLevels = new Float32Array(input.layout?.sites.length ?? 0).fill(NaN)
  if (input.layout) shapeLayout(input.layout, { nx, nz, cell, origin, base, delta, water, river, clear, roads, siteLevels })
  const final = new Float32Array(count)
  for (let k = 0; k < count; k++) final[k] = base[k] + delta[k]
  // Climate: colder with altitude and towards the north (+z), wetter near water and on windward slopes.
  const temperature = new Float32Array(count), humidity = new Float32Array(count), sample: NoiseSample = { value: 0, dx: 0, dz: 0 }
  const distance = new Float32Array(count).fill(1e9)
  for (let k = 0; k < count; k++) if (final[k] <= sea || !Number.isNaN(water[k])) distance[k] = 0
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i
    if (i) distance[k] = Math.min(distance[k], distance[k - 1] + cell)
    if (j) distance[k] = Math.min(distance[k], distance[k - nx] + cell)
    if (i && j) distance[k] = Math.min(distance[k], distance[k - nx - 1] + cell * Math.SQRT2)
    if (j && i < nx - 1) distance[k] = Math.min(distance[k], distance[k - nx + 1] + cell * Math.SQRT2)
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i
    if (i < nx - 1) distance[k] = Math.min(distance[k], distance[k + 1] + cell)
    if (j < nz - 1) distance[k] = Math.min(distance[k], distance[k + nx] + cell)
    if (i < nx - 1 && j < nz - 1) distance[k] = Math.min(distance[k], distance[k + nx + 1] + cell * Math.SQRT2)
    if (j < nz - 1 && i) distance[k] = Math.min(distance[k], distance[k + nx - 1] + cell * Math.SQRT2)
  }
  const wind = input.climate.wind * Math.PI / 180, wx = Math.cos(wind), wz = Math.sin(wind), seaRef = Number.isFinite(sea) ? sea : low
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = origin[0] + i * cell, z = origin[1] + j * cell, h = final[k]
    const altitude = clamp((h - seaRef) / Math.max(1, high - seaRef), 0, 1), north = z / (input.size[1] / 2)
    temperature[k] = input.climate.temperature - 24 * altitude - 6 * north + 3 * noised(x / 1500, z / 1500, input.seed + 301, sample).value
    // Upwind ground higher than here casts a rain shadow.
    const upwind = (dxs: number) => { const px = clamp(Math.round(i - wx * dxs / cell), 0, nx - 1), pz = clamp(Math.round(j - wz * dxs / cell), 0, nz - 1); return final[pz * nx + px] }
    const shadow = clamp((Math.max(upwind(250), upwind(600)) - h) / (span * 0.35), 0, 1)
    humidity[k] = clamp(input.climate.humidity * (0.45 + 0.55 * Math.exp(-distance[k] / 700)) - 0.35 * shadow + 0.15 * noised(x / 1100 - 3.1, z / 1100 + 7.7, input.seed + 517, sample).value, 0, 1)
  }

  // Biomes as soft kernels in (temperature, humidity); each maps to one ground layer.
  const kernels: [typeof BIOMES[number], number, number, GroundLayer][] = [
    ['desert', 26, 0.08, 'sand'], ['savanna', 24, 0.32, 'dry'], ['grassland', 13, 0.42, 'grass'], ['forest', 11, 0.68, 'forest'],
    ['rainforest', 24, 0.88, 'forest'], ['swamp', 17, 0.97, 'mud'], ['taiga', 1, 0.6, 'taiga'], ['tundra', -5, 0.35, 'dry'], ['snow', -14, 0.5, 'snow'],
  ]
  const ground = new Uint8Array(count * GROUND_LAYERS.length), biome = new Uint8Array(count), weights = new Float32Array(GROUND_LAYERS.length)
  for (let k = 0; k < count; k++) {
    weights.fill(0)
    const h = final[k], t = temperature[k], m = humidity[k]
    let best = 0, bestWeight = -1
    if (h <= sea) { biome[k] = 0; weights[GROUND_LAYERS.indexOf('sand')] = 1 }
    else {
      kernels.forEach(([name, kt, km, layer]) => {
        const weight = Math.exp(-(((t - kt) / 7) ** 2) - (((m - km) / 0.17) ** 2))
        weights[GROUND_LAYERS.indexOf(layer)] += weight
        if (weight > bestWeight) { bestWeight = weight; best = BIOMES.indexOf(name) }
      })
      const beach = 1 - smoothstep(sea + 1, sea + 4, h)
      if (beach > 0) { for (let l = 0; l < weights.length; l++) weights[l] *= 1 - beach; weights[GROUND_LAYERS.indexOf('sand')] += beach; if (beach > 0.5) best = BIOMES.indexOf('beach') }
      if (river[k] > 0) { const wet = river[k] * 0.7; for (let l = 0; l < weights.length; l++) weights[l] *= 1 - wet; weights[GROUND_LAYERS.indexOf('mud')] += wet }
      if (clear[k] > 0) { const bare = clear[k] * 0.8; for (let l = 0; l < weights.length; l++) weights[l] *= 1 - bare; weights[GROUND_LAYERS.indexOf('dry')] += bare }
      biome[k] = best
    }
    let sum = 0
    for (const w of weights) sum += w
    for (let l = 0; l < weights.length; l++) ground[k * weights.length + l] = Math.round(255 * weights[l] / (sum || 1))
  }
  const pads = new Float32Array((input.layout?.sites ?? []).flatMap((site, index) => [site.x, site.z, site.radius, siteLevels[index]]))
  return { cell, points: [nx, nz], origin, delta, water, lake: lakeMask, river, temperature, humidity, ground, biome, drain: downstream, filled, clear, roads, siteLevels, pads, stats: { droplets, lakes, riverCells, ms: performance.now() - started } }
}

interface LayoutGrid { nx: number; nz: number; cell: number; origin: [number, number]; base: Float32Array; delta: Float32Array; water: Float32Array; river: Float32Array; clear: Float32Array; roads: [number, number][][]; siteLevels: Float32Array }

/**
 * Flattens each settlement footprint to its median height with a smooth rim, then links the requested pairs with
 * roads: an A* path on the grid that avoids lakes and steep ground, smoothed, given a gentle longitudinal profile and
 * a flat cross-section with shoulders. River beds are left alone (fords).
 */
function shapeLayout(layout: MacroLayout, grid: LayoutGrid): void {
  const { nx, nz, cell, origin, base, delta, water, river, clear } = grid, height = (k: number) => base[k] + delta[k]
  const index = (x: number, z: number) => Math.min(nz - 1, Math.max(0, Math.round((z - origin[1]) / cell))) * nx + Math.min(nx - 1, Math.max(0, Math.round((x - origin[0]) / cell)))
  const blend = (k: number, target: number, amount: number) => { if (river[k] > 0.2 || amount <= 0) return; delta[k] += (target - height(k)) * amount }
  for (const [order, site] of layout.sites.entries()) {
    const reach = Math.ceil((site.radius * 1.6) / cell), centre = index(site.x, site.z), ci = centre % nx, cj = Math.floor(centre / nx), inside: number[] = []
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      const i = ci + dx, j = cj + dz
      if (i >= 0 && j >= 0 && i < nx && j < nz && Math.hypot(dx, dz) * cell <= site.radius) inside.push(height(j * nx + i))
    }
    inside.sort((a, b) => a - b)
    const level = inside[inside.length >> 1] ?? height(centre)
    grid.siteLevels[order] = level
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      const i = ci + dx, j = cj + dz
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue
      const k = j * nx + i, amount = 1 - smoothstep(site.radius, site.radius * 1.6, Math.hypot(dx, dz) * cell)
      blend(k, level, amount); clear[k] = Math.max(clear[k], amount)
    }
  }
  for (const road of layout.roads) {
    const a = layout.sites[road.from], b = layout.sites[road.to]
    if (!a || !b) continue
    const path = findRoute(index(a.x, a.z), index(b.x, b.z), grid)
    if (path.length < 2) continue
    // Chaikin smoothing of the grid path, then a moving-average profile so slopes change gently.
    let points = simplify(path.map((k): [number, number] => [origin[0] + (k % nx) * cell, origin[1] + Math.floor(k / nx) * cell]), cell * 0.75)
    for (let pass = 0; pass < 3; pass++) points = [points[0], ...points.slice(0, -1).flatMap((p, i) => { const q = points[i + 1]; return [[p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]] as [number, number][] }), points.at(-1)!]
    // Longitudinal profile: terrain averaged over ±40 m of road, then grades limited to 12% in both directions.
    const along = [0]
    for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
    const raw = points.map(([x, z]) => height(index(x, z))), profile = raw.map((_, i) => {
      let sum = 0, n = 0
      for (let j = i; j >= 0 && along[i] - along[j] <= 40; j--) { sum += raw[j]; n++ }
      for (let j = i + 1; j < raw.length && along[j] - along[i] <= 40; j++) { sum += raw[j]; n++ }
      return sum / n
    }), grade = 0.12
    profile[0] = raw[0]; profile[profile.length - 1] = raw[raw.length - 1]
    for (let i = 1; i < profile.length; i++) { const step = grade * (along[i] - along[i - 1]); profile[i] = Math.min(profile[i - 1] + step, Math.max(profile[i - 1] - step, profile[i])) }
    for (let i = profile.length - 2; i >= 0; i--) { const step = grade * (along[i + 1] - along[i]); profile[i] = Math.min(profile[i + 1] + step, Math.max(profile[i + 1] - step, profile[i])) }
    // The carved bench is at least three grid cells wide so the smooth (B-spline) reading keeps it level across.
    const half = Math.max(road.width / 2, cell * 1.5), shoulder = half + cell * 2
    // Each cell follows the nearest road point only, so switchback legs never overwrite each other's bench.
    const nearest = new Map<number, [number, number]>()
    points.forEach(([x, z], p) => {
      const centre = index(x, z), ci = centre % nx, cj = Math.floor(centre / nx), reach = Math.ceil(shoulder / cell)
      for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
        const i = ci + dx, j = cj + dz
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue
        const k = j * nx + i, distance = Math.hypot(origin[0] + i * cell - x, origin[1] + j * cell - z), best = nearest.get(k)
        if (distance < shoulder && (!best || distance < best[0])) nearest.set(k, [distance, profile[p]])
      }
    })
    for (const [k, [distance, level]] of nearest) {
      const amount = 1 - smoothstep(half, shoulder, distance)
      if (amount > 0 && Number.isNaN(water[k])) { blend(k, level, amount); clear[k] = Math.max(clear[k], amount) }
    }
    grid.roads.push(points)
  }
}

/** Douglas–Peucker: drops grid zig-zags so a road bends only where the route really turns. */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points
  const [a, b] = [points[0], points[points.length - 1]], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1
  let worst = 0, at = 0
  for (let i = 1; i < points.length - 1; i++) {
    const distance = Math.abs((points[i][0] - a[0]) * dz - (points[i][1] - a[1]) * dx) / length
    if (distance > worst) { worst = distance; at = i }
  }
  return worst <= tolerance ? [a, b] : [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)]
}

/** A* on the 8-connected grid: length plus a strong penalty for slope; lakes are impassable, rivers costly. */
function findRoute(start: number, goal: number, grid: LayoutGrid): number[] {
  const { nx, nz, cell, base, delta, water, river } = grid, count = nx * nz, cost = new Float32Array(count).fill(Infinity), from = new Int32Array(count).fill(-1), done = new Uint8Array(count)
  const score = new Float32Array(count).fill(Infinity), open = heap(score), gi = goal % nx, gj = Math.floor(goal / nx)
  const estimate = (k: number) => Math.hypot(k % nx - gi, Math.floor(k / nx) - gj) * cell
  cost[start] = 0; score[start] = estimate(start); open.push(start)
  while (open.size) {
    const k = open.pop()
    if (done[k]) continue
    if (k === goal) break
    done[k] = 1
    const i = k % nx, j = Math.floor(k / nx)
    for (const [dx, dz, length] of D8) {
      const pi = i + dx, pj = j + dz, n = pj * nx + pi
      if (pi < 0 || pj < 0 || pi >= nx || pj >= nz || done[n] || (!Number.isNaN(water[n]) && river[n] < 0.2)) continue
      const rise = Math.abs(base[n] + delta[n] - base[k] - delta[k]) / (length * cell), step = length * cell * (1 + 400 * rise * rise + (river[n] > 0.2 ? 6 : 0))
      if (cost[k] + step >= cost[n]) continue
      cost[n] = cost[k] + step; from[n] = k; score[n] = cost[n] + estimate(n); open.push(n)
    }
  }
  if (from[goal] < 0 && goal !== start) return []
  const path = [goal]
  while (path[path.length - 1] !== start) path.push(from[path[path.length - 1]])
  return path.reverse()
}

/**
 * Smooth (uniform cubic B-spline, C2) reading of a macro grid at (x, z): grid lines leave no creases, which keeps the
 * terrain's LOD error bounded where erosion and river beds meet.
 */
export function sampleMacro(field: Float32Array, macro: Pick<WorldMacro, 'cell' | 'points' | 'origin'>, x: number, z: number): number {
  const [nx, nz] = macro.points, u = (x - macro.origin[0]) / macro.cell, v = (z - macro.origin[1]) / macro.cell
  const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv
  const basis = (t: number, out: number[]) => { const s = 1 - t; out[0] = s * s * s / 6; out[1] = (3 * t * t * t - 6 * t * t + 4) / 6; out[2] = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6; out[3] = t * t * t / 6; return out }
  const bu = basis(fu, [0, 0, 0, 0]), bv = basis(fv, [0, 0, 0, 0])
  let value = 0
  for (let b = 0; b < 4; b++) {
    const row = Math.min(nz - 1, Math.max(0, iv - 1 + b)) * nx
    let line = 0
    for (let a = 0; a < 4; a++) line += bu[a] * field[row + Math.min(nx - 1, Math.max(0, iu - 1 + a))]
    value += bv[b] * line
  }
  return value
}

export interface WaterMesh { positions: Float32Array; indices: Uint32Array; levels: Float32Array; depths?: Float32Array; triangles?: Uint8Array }

/**
 * One mesh for every lake and river of the world: grid points with water keep their level, dry points next to water
 * take the lowest neighbouring level, so upstream water does not spill across a lower dry bank.
 */
export function waterMesh(macro: Pick<WorldMacro, 'water' | 'cell' | 'points' | 'origin'>, heightAt?: (x: number, z: number) => number): WaterMesh {
  const [nx, nz] = macro.points, level = new Float32Array(nx * nz).fill(NaN), vertex = new Int32Array(nx * nz).fill(-1)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i
    if (!Number.isNaN(macro.water[k])) { level[k] = macro.water[k]; continue }
    let best = Infinity
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const pi = i + dx, pj = j + dz
      if (pi >= 0 && pj >= 0 && pi < nx && pj < nz && !Number.isNaN(macro.water[pj * nx + pi])) best = Math.min(best, macro.water[pj * nx + pi])
    }
    if (best < Infinity) level[k] = best
  }
  const positions: number[] = [], indices: number[] = [], depths = heightAt ? new Float32Array(nx * nz).fill(-1) : undefined, triangles = heightAt ? new Uint8Array((nx - 1) * (nz - 1) * 2) : undefined
  if (depths) for (let k = 0; k < level.length; k++) if (Number.isFinite(level[k])) depths[k] = Math.min(Number.isFinite(macro.water[k]) ? Infinity : -0.02, level[k] - heightAt!(macro.origin[0] + (k % nx) * macro.cell, macro.origin[1] + Math.floor(k / nx) * macro.cell))
  const at = (i: number, j: number) => {
    const k = j * nx + i
    if (vertex[k] < 0) { vertex[k] = positions.length / 3; positions.push(macro.origin[0] + i * macro.cell, level[k], macro.origin[1] + j * macro.cell) }
    return vertex[k]
  }
  const edges = new Map<string, number>()
  const clipped = (ids: number[], cell: number) => {
    if (!depths || !triangles) { indices.push(...ids.map(k => at(k % nx, Math.floor(k / nx)))); return }
    const points = ids.map(k => ({ k, x: macro.origin[0] + (k % nx) * macro.cell, y: level[k], z: macro.origin[1] + Math.floor(k / nx) * macro.cell, depth: depths[k] }))
    const bed = points.map(p => heightAt!(p.x, p.z)), span = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))
    if (span > Math.max(macro.cell * 0.75, Math.max(...bed) - Math.min(...bed) + 2)) return
    const polygon: number[] = []
    for (let i = 0; i < 3; i++) {
      const a = points[i], b = points[(i + 1) % 3]
      if (a.depth > 0) polygon.push(at(a.k % nx, Math.floor(a.k / nx)))
      if ((a.depth > 0) === (b.depth > 0)) continue
      const key = a.k < b.k ? `${a.k}:${b.k}` : `${b.k}:${a.k}`
      let index = edges.get(key)
      if (index === undefined) { const t = a.depth / (a.depth - b.depth); index = positions.length / 3; positions.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); edges.set(key, index) }
      polygon.push(index)
    }
    if (polygon.length < 3) return
    triangles[cell] = 1
    for (let i = 1; i + 1 < polygon.length; i++) indices.push(polygon[0], polygon[i], polygon[i + 1])
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = j * nx + i
    if (Number.isNaN(level[k]) || Number.isNaN(level[k + 1]) || Number.isNaN(level[k + nx]) || Number.isNaN(level[k + nx + 1])) continue
    const t = (j * (nx - 1) + i) * 2
    clipped([k, k + nx + 1, k + 1], t)
    clipped([k, k + nx, k + nx + 1], t + 1)
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), levels: level, ...(depths ? { depths, triangles } : {}) }
}

/** Same diagonal and float32 vertex levels as waterMesh; null where no water triangle is drawn. */
export function waterHeightAt(levels: Float32Array, grid: Pick<WorldMacro, 'cell' | 'points' | 'origin'>, x: number, z: number, triangles?: Uint8Array, depths?: Float32Array): number | null {
  const [nx, nz] = grid.points, u = (x - grid.origin[0]) / grid.cell, v = (z - grid.origin[1]) / grid.cell, i = Math.floor(u), j = Math.floor(v)
  if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return null
  const k = j * nx + i, a = levels[k], b = levels[k + 1], c = levels[k + nx + 1], d = levels[k + nx]
  if (![a, b, c, d].every(Number.isFinite)) return null
  const fx = u - i, fz = v - j
  if (triangles && !triangles[(j * (nx - 1) + i) * 2 + (fx >= fz ? 0 : 1)]) return null
  if (depths) { const [da, db, dc, dd] = [depths[k], depths[k + 1], depths[k + nx + 1], depths[k + nx]]; const depth = fx >= fz ? da + fx * (db - da) + fz * (dc - db) : da + fx * (dc - dd) + fz * (dd - da); if (depth <= 0) return null }
  return fx >= fz ? a + fx * (b - a) + fz * (c - b) : a + fx * (c - d) + fz * (d - a)
}
