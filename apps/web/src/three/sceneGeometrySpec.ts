export type Point2 = [number, number]
export type Point3 = [number, number, number]
export interface GeometrySpec {
  segments: number; radius: number; bevel: number; closed: boolean
  profile: Point2[]; holes: Point2[][]; points: Point3[]
  vertices: number[]; indices: number[]; normals: number[]; uvs: number[]
}
export const MAX_SCENE_TRIANGLES = 2_000_000
export function defaultGeometry(kind: string): GeometrySpec {
  return { segments: 48, radius: 0.08, bevel: 0.04, closed: false,
    profile: kind === 'lathe' ? [[0, -0.5], [0.25, -0.5], [0.38, -0.38], [0.28, -0.15], [0.34, 0.2], [0.18, 0.48], [0, 0.5]]
      : kind === 'extrude' ? [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.1], [0.25, 0.5], [-0.25, 0.5], [-0.5, 0.1]] : [],
    holes: [], points: kind === 'tube' ? [[-0.5, 0, 0], [-0.2, 0.4, 0.1], [0.2, -0.2, -0.1], [0.5, 0.2, 0]] : [],
    vertices: kind === 'mesh' ? [-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0, 0, 0, 0.5] : [],
    indices: kind === 'mesh' ? [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3] : [], normals: [], uvs: [] }
}
function finite(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field}: valor fora de ${min}–${max}.`)
  return value
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
  const segments = finite(source.segments, 8, 128, 'Segmentos')
  if (!Number.isInteger(segments)) throw new Error('Segmentos deve ser inteiro.')
  if (typeof source.closed !== 'boolean') throw new Error('Trajetória fechada deve ser booleana.')
  const result: GeometrySpec = { segments, radius: finite(source.radius, 0.001, 0.5, 'Raio tubular'), bevel: finite(source.bevel, 0, 0.2, 'Bisel'), closed: source.closed,
    profile: points(source.profile, 2, 64) as Point2[], holes: array(source.holes, 8).map((v) => points(v, 2, 32) as Point2[]),
    points: points(source.points, 3, 64) as Point3[],
    vertices: Array.from(array(source.vertices, 300000), (v) => finite(v, -1000, 1000, 'Vértice')),
    indices: Array.from(array(source.indices, 300000), (v) => finite(v, 0, 99999, 'Índice')),
    normals: Array.from(array(source.normals, 300000), (v) => finite(v, -1, 1, 'Normal')),
    uvs: Array.from(array(source.uvs, 200000), (v) => finite(v, -10000, 10000, 'UV')) }
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
export function estimateTriangles(kind: string, spec: GeometrySpec): number {
  if (kind === 'group') return 0
  if (kind === 'mesh') return spec.indices.length / 3
  if (kind === 'box') return 12
  if (kind === 'cylinder') return spec.segments * 4
  if (kind === 'cone') return spec.segments * 2
  if (kind === 'torus') return spec.segments * 96
  if (kind === 'sphere') return 2 * spec.segments * Math.max(12, Math.floor(spec.segments * 0.75))
  if (kind === 'roundedBox') return 12 * 12 * 12
  if (kind === 'extrude') return (spec.profile.length + spec.holes.reduce((sum, p) => sum + p.length, 0)) * 40
  if (kind === 'lathe') return spec.segments * (spec.profile.length + 1) * 2
  if (kind === 'tube' || kind === 'torusKnot') return spec.segments * 4 * 24 * 2
  return spec.segments * spec.segments * 2
}
