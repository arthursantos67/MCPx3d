export type Point2 = [number, number]
export type Point3 = [number, number, number]
export type PolyhedronVariant = 'icosahedron' | 'dodecahedron' | 'octahedron' | 'tetrahedron'
export const terrainStyles = ['rolling', 'ridged', 'terraced', 'dunes'] as const
export const terrainBiomes = ['none', 'meadow', 'alpine', 'desert', 'volcanic', 'forest', 'snow', 'tropical', 'swamp', 'lunar', 'alien'] as const
export interface GeometrySpec {
  segments: number; radius: number; bevel: number; closed: boolean
  profile: Point2[]; holes: Point2[][]; points: Point3[]
  vertices: number[]; indices: number[]; normals: number[]; uvs: number[]
  detail: number; variant: PolyhedronVariant; seed: number; text: string
  /** Terrain flattening areas in normalized local units: [u, v, halfWidth, halfDepth, height]. */
  pads: number[][]
  terrainStyle?: typeof terrainStyles[number]
  biome?: typeof terrainBiomes[number]
}
export const MAX_SCENE_TRIANGLES = 2_000_000
export const polyhedronVariants: PolyhedronVariant[] = ['icosahedron', 'dodecahedron', 'octahedron', 'tetrahedron']
export function defaultGeometry(kind: string): GeometrySpec {
  return { segments: kind === 'terrain' ? 64 : 48, radius: 0.08, bevel: kind === 'polyhedron' ? 0 : 0.04, closed: false,
    profile: kind === 'lathe' ? [[0, -0.5], [0.25, -0.5], [0.38, -0.38], [0.28, -0.15], [0.34, 0.2], [0.18, 0.48], [0, 0.5]]
      : kind === 'extrude' ? [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.1], [0.25, 0.5], [-0.25, 0.5], [-0.5, 0.1]] : [],
    holes: [], points: kind === 'tube' ? [[-0.5, 0, 0], [-0.2, 0.4, 0.1], [0.2, -0.2, -0.1], [0.5, 0.2, 0]] : [],
    vertices: kind === 'mesh' ? [-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0, 0, 0, 0.5] : [],
    indices: kind === 'mesh' ? [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3] : [], normals: [], uvs: [],
    detail: kind === 'terrain' ? 3 : 0, variant: 'icosahedron', seed: 1, text: kind === 'text' ? 'Texto' : '', pads: [] }
}
function finite(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field}: valor fora de ${min}–${max}.`)
  return value
}
function integer(value: unknown, min: number, max: number, field: string): number {
  const result = finite(value, min, max, field)
  if (!Number.isInteger(result)) throw new Error(`${field} deve ser inteiro.`)
  return result
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Geometria: quantidade de pontos/índices excedida ou lista inválida.')
  return value
}
function points(value: unknown, axes: number, max: number): number[][] {
  return Array.from(array(value, max), (point) => {
    const values = array(point, axes)
    if (values.length !== axes) throw new Error('Coordenada de geometria incompleta.')
    return Array.from(values, (v) => finite(v, -1000, 1000, 'Coordenada'))
  })
}
function cross(a: Point2, b: Point2, c: Point2) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) }
function intersects(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const c1 = cross(a, b, c), c2 = cross(a, b, d), c3 = cross(c, d, a), c4 = cross(c, d, b)
  const within = (p: Point2, x: Point2, y: Point2) => p[0] >= Math.min(x[0], y[0]) - 1e-9 && p[0] <= Math.max(x[0], y[0]) + 1e-9 && p[1] >= Math.min(x[1], y[1]) - 1e-9 && p[1] <= Math.max(x[1], y[1]) + 1e-9
  return (c1 * c2 < 0 && c3 * c4 < 0) || (Math.abs(c1) < 1e-9 && within(c, a, b)) || (Math.abs(c2) < 1e-9 && within(d, a, b)) || (Math.abs(c3) < 1e-9 && within(a, c, d)) || (Math.abs(c4) < 1e-9 && within(b, c, d))
}
function polygon(profile: Point2[]) {
  if (profile.length < 3) throw new Error('O perfil de extrusão precisa de pelo menos três pontos.')
  let area = 0
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i], b = profile[(i + 1) % profile.length]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8) throw new Error('O perfil contém pontos consecutivos repetidos.')
    area += a[0] * b[1] - a[1] * b[0]
    for (let j = i + 2; j < profile.length; j++) if (!(i === 0 && j === profile.length - 1) && intersects(a, b, profile[j], profile[(j + 1) % profile.length])) throw new Error('O perfil se cruza. Corrija os pontos.')
  }
  if (Math.abs(area) < 1e-8) throw new Error('O perfil não possui área.')
}
function inside(point: Point2, poly: Point2[]) {
  let result = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result
  }
  return result
}
export function validateGeometry(value: unknown, kind: string): GeometrySpec {
  const defaults = defaultGeometry(kind)
  if (value === undefined || value === null) return defaults
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Parâmetros de geometria inválidos.')
  const source = { ...defaults, ...value }
  if (source.terrainStyle !== undefined && !terrainStyles.includes(source.terrainStyle)) throw new Error('Estilo de terreno desconhecido.')
  if (source.biome !== undefined && !terrainBiomes.includes(source.biome)) throw new Error('Bioma de terreno desconhecido.')
  if (typeof source.closed !== 'boolean') throw new Error('Trajetória fechada deve ser booleana.')
  if (!polyhedronVariants.includes(source.variant)) throw new Error('Variante de poliedro desconhecida.')
  if (typeof source.text !== 'string' || source.text.length > 160) throw new Error('Texto: até 160 caracteres.')
  const result: GeometrySpec = { segments: integer(source.segments, 8, 128, 'Segmentos'), radius: finite(source.radius, 0.001, 0.5, 'Raio tubular'), bevel: finite(source.bevel, 0, 0.2, 'Bisel'), closed: source.closed,
    profile: points(source.profile, 2, 64) as Point2[], holes: array(source.holes, 8).map((v) => points(v, 2, 32) as Point2[]),
    points: points(source.points, 3, 64) as Point3[],
    vertices: Array.from(array(source.vertices, 300000), (v) => finite(v, -1000, 1000, 'Vértice')),
    indices: Array.from(array(source.indices, 300000), (v) => finite(v, 0, 99999, 'Índice')),
    normals: Array.from(array(source.normals, 300000), (v) => finite(v, -1, 1, 'Normal')),
    uvs: Array.from(array(source.uvs, 200000), (v) => finite(v, -10000, 10000, 'UV')),
    detail: integer(source.detail, 0, 5, 'Detalhe'), variant: source.variant, seed: integer(source.seed, 0, 9999, 'Semente'), text: source.text,
    pads: array(source.pads, 256).map((pad) => { const values = array(pad, 5); if (values.length !== 5) throw new Error('Área aplainada requer [u, v, meia largura, meia profundidade, altura].'); return [finite(values[0], -0.6, 0.6, 'Área aplainada'), finite(values[1], -0.6, 0.6, 'Área aplainada'), finite(values[2], 0.001, 0.5, 'Área aplainada'), finite(values[3], 0.001, 0.5, 'Área aplainada'), finite(values[4], -0.5, 0.5, 'Área aplainada')] }),
    ...(source.terrainStyle !== undefined ? { terrainStyle: source.terrainStyle } : {}), ...(source.biome !== undefined ? { biome: source.biome } : {}) }
  if (kind === 'extrude') {
    polygon(result.profile)
    const all = [result.profile, ...result.holes]
    for (let i = 1; i < all.length; i++) {
      polygon(all[i])
      if (!all[i].every((p) => inside(p, result.profile))) throw new Error('Um recorte está fora do perfil.')
      for (let j = 0; j < i; j++) {
        for (let a = 0; a < all[i].length; a++) for (let b = 0; b < all[j].length; b++) if (intersects(all[i][a], all[i][(a + 1) % all[i].length], all[j][b], all[j][(b + 1) % all[j].length])) throw new Error('Perfis e recortes não podem se cruzar.')
        if (j && (inside(all[i][0], all[j]) || inside(all[j][0], all[i]))) throw new Error('Recortes não podem se conter.')
      }
    }
  }
  if (kind === 'lathe' && (result.profile.length < 3 || result.profile.some((p) => p[0] < 0))) throw new Error('Revolução requer um perfil raio/altura com raios não negativos.')
  if (kind === 'tube') {
    if (result.points.length < 2) throw new Error('O tubo precisa de dois ou mais pontos.')
    for (let i = 1; i < result.points.length; i++) if (Math.hypot(...result.points[i].map((v, a) => v - result.points[i - 1][a])) < 1e-6) throw new Error('A trajetória contém pontos repetidos.')
  }
  if (kind === 'text' && !result.text.trim()) throw new Error('Texto 3D requer conteúdo.')
  if (kind === 'mesh') {
    if (result.vertices.length < 9 || result.vertices.length % 3 || result.indices.length < 3 || result.indices.length % 3) throw new Error('Malha: vértices XYZ e triângulos indexados são obrigatórios.')
    if (result.indices.some((i) => !Number.isInteger(i) || i >= result.vertices.length / 3)) throw new Error('A malha referencia um vértice inexistente.')
    if (result.normals.length && result.normals.length !== result.vertices.length) throw new Error('Normais não correspondem aos vértices.')
    if (result.uvs.length && result.uvs.length !== result.vertices.length / 3 * 2) throw new Error('UVs não correspondem aos vértices.')
    for (let i = 0; i < result.indices.length; i += 3) {
      const [a, b, c] = result.indices.slice(i, i + 3).map((v) => result.vertices.slice(v * 3, v * 3 + 3))
      const u = b.map((v, k) => v - a[k]), v = c.map((w, k) => w - a[k])
      if (Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) < 1e-12) throw new Error('A malha contém triângulos degenerados.')
    }
  }
  return result
}
const polyhedronFaces: Record<PolyhedronVariant, number> = { icosahedron: 20, dodecahedron: 36, octahedron: 8, tetrahedron: 4 }
export function estimateTriangles(kind: string, spec: GeometrySpec): number {
  if (kind === 'group' || kind === 'light') return 0
  if (kind === 'mesh') return spec.indices.length / 3
  if (kind === 'box') return 12
  if (kind === 'plane' || kind === 'text') return 2
  if (kind === 'cylinder') return spec.segments * 4
  if (kind === 'cone') return spec.segments * 2
  if (kind === 'capsule') return spec.segments * 36
  if (kind === 'polyhedron') return polyhedronFaces[spec.variant] * (spec.detail + 1) ** 2
  if (kind === 'terrain') return spec.segments * spec.segments * 2
  if (kind === 'torus') return spec.segments * 96
  if (kind === 'sphere') return 2 * spec.segments * Math.max(12, Math.floor(spec.segments * 0.75))
  if (kind === 'roundedBox') return 12 * 12 * 12
  if (kind === 'extrude') return (spec.profile.length + spec.holes.reduce((sum, p) => sum + p.length, 0)) * 40
  if (kind === 'lathe') return spec.segments * (spec.profile.length + 1) * 2
  if (kind === 'tube' || kind === 'torusKnot') return spec.segments * 4 * 24 * 2
  return spec.segments * spec.segments * 2
}

export function hashNoise(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
/** Periodic value noise: identical in the renderer, the worker and recipe expansion. */
export function valueNoise(x: number, y: number, seed: number, period = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0
  const wrap = (v: number) => period ? ((v % period) + period) % period : v
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const a = hashNoise(wrap(x0), wrap(y0), seed), b = hashNoise(wrap(x0 + 1), wrap(y0), seed)
  const c = hashNoise(wrap(x0), wrap(y0 + 1), seed), d = hashNoise(wrap(x0 + 1), wrap(y0 + 1), seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
export function fractalNoise(x: number, y: number, seed: number, octaves: number, period = 0): number {
  let sum = 0, amplitude = 1, total = 0, frequency = 1
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise(x * frequency, y * frequency, seed + octave * 101, period ? period * frequency : 0) * amplitude
    total += amplitude; amplitude *= 0.5; frequency *= 2
  }
  return sum / total
}
const heightCache = new Map<string, Float32Array>()
/**
 * Grid heights normalized to [-0.5, 0.5]; `closed` lowers the borders to form an island. Pads flatten areas
 * (buildings, roads) with a smooth border, the way game terrains are prepared before placing structures.
 */
export function terrainHeights(spec: GeometrySpec): Float32Array {
  const key = JSON.stringify([spec.segments, spec.detail, spec.seed, spec.closed, spec.pads, spec.terrainStyle])
  const cached = heightCache.get(key)
  if (cached) return cached
  const n = spec.segments, heights = new Float32Array((n + 1) * (n + 1))
  let min = Infinity, max = -Infinity
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n
    let h = fractalNoise(u * 3, v * 3, spec.seed, spec.detail + 1)
    // Domain-warped ridges, softened terraces and directional dunes give landscapes distinct silhouettes.
    // The default rolling field is unchanged for existing projects.
    const style = spec.terrainStyle ?? 'rolling'
    if (style !== 'rolling') {
      const warp = valueNoise(u * 4, v * 4, spec.seed + 47) - 0.5
      if (style === 'ridged') {
        const ridge = 1 - Math.abs(2 * fractalNoise(u * 4 + warp, v * 4 - warp, spec.seed + 211, 3) - 1)
        h = h * 0.4 + ridge ** 3 * 0.6
      } else if (style === 'terraced') {
        const step = h * 6, base = Math.floor(step), fraction = step - base
        const blend = Math.max(0, Math.min(1, (fraction - 0.3) / 0.4))
        h = (base + blend * blend * (3 - 2 * blend)) / 6
      } else h = 0.5 + Math.sin((u * 7 + v * 2 + warp * 0.6) * Math.PI) * 0.27 + h * 0.2
    }
    if (spec.closed) { const edge = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2); h = h * (1 - edge ** 3) + 0.15 * (1 - edge) }
    heights[j * (n + 1) + i] = h
    min = Math.min(min, h); max = Math.max(max, h)
  }
  for (let i = 0; i < heights.length; i++) heights[i] = max - min < 1e-9 ? 0 : (heights[i] - min) / (max - min) - 0.5
  // Each vertex follows the most influential pad, so a neighbour's soft border never bends another flat core.
  if (spec.pads?.length) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    let best = 0, level = 0
    for (const [pu, pv, hw, hd, height] of spec.pads) {
      const margin = Math.max(hw, hd) * 0.8 + 0.01
      const distance = Math.hypot(Math.max(Math.abs(i / n - 0.5 - pu) - hw, 0), Math.max(Math.abs(j / n - 0.5 - pv) - hd, 0))
      if (distance >= margin) continue
      const t = distance / margin, weight = 1 - t * t * (3 - 2 * t)
      if (weight > best || (weight === 1 && best === 1)) { best = weight; level = height }
    }
    const index = j * (n + 1) + i
    heights[index] += (level - heights[index]) * best
  }
  if (heightCache.size > 64) heightCache.clear()
  heightCache.set(key, heights)
  return heights
}
/** Height on the exact triangulated surface for local coordinates u, v in [-0.5, 0.5]. */
export function terrainHeightAt(spec: GeometrySpec, u: number, v: number, heights = terrainHeights(spec)): number {
  const n = spec.segments
  const gx = Math.min(n, Math.max(0, (u + 0.5) * n)), gz = Math.min(n, Math.max(0, (v + 0.5) * n))
  const i = Math.min(n - 1, Math.floor(gx)), j = Math.min(n - 1, Math.floor(gz)), fx = gx - i, fz = gz - j
  const at = (x: number, z: number) => heights[z * (n + 1) + x]
  const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1)
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz)
}
