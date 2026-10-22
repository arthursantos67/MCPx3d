/**
 * Pure geometry for procedural skinned characters: signed distance primitives, smooth unions, narrow-band surface nets,
 * local refinement with projection, relaxation and field normals. No WebGL; every function is deterministic.
 */

export const PRIM_ELLIPSOID = 0, PRIM_CAPSULE = 1, PRIM_LATHE = 2, PRIM_CYLINDER = 3, PRIM_BOX = 4, PRIM_SEGMENT = 5
/** One solid in world (root bind) space. `m` holds the rigid world matrix (column-major 4x4) of the primitive's center. */
export interface Prim {
  kind: number
  /** Rotation rows (R^T) and translation: local = R^T (p - t). */
  r: Float64Array
  /** Kind-specific sizes: ellipsoid/capsule radii, lathe/cylinder mean radius scaling, box half extents. */
  sx: number; sy: number; sz: number
  /** Lathe profile (pairs ρ, y in metres, mean-radius space) or segment data. */
  poly: Float64Array | null
  round: number
  /** Bounding sphere. */
  cx: number; cy: number; cz: number; radius: number
}
export interface PrimSource { kind: 'sphere' | 'capsule' | 'lathe' | 'cylinder' | 'cone' | 'box'; dimensions: [number, number, number]; matrix: ArrayLike<number>; profile?: [number, number][] }

function rotation(m: ArrayLike<number>): Float64Array {
  return new Float64Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[12], m[13], m[14]])
}
/** Builds a primitive matching the normalized node geometry of sceneGeometry.ts (dimensions are the exact local bounding box). */
export function primFrom(source: PrimSource): Prim {
  const [w, h, d] = source.dimensions, r = rotation(source.matrix), base = { r, cx: r[9], cy: r[10], cz: r[11], radius: 0.5 * Math.hypot(w, h, d), poly: null as Float64Array | null, round: 0 }
  switch (source.kind) {
    case 'sphere': return { ...base, kind: PRIM_ELLIPSOID, sx: w / 2, sy: h / 2, sz: d / 2 }
    case 'capsule': return { ...base, kind: PRIM_CAPSULE, sx: w / 2, sy: h / 4, sz: d / 2 }
    case 'box': return { ...base, kind: PRIM_BOX, sx: w / 2, sy: h / 2, sz: d / 2, round: Math.min(w, h, d) * 0.3 }
    case 'cylinder': return { ...base, kind: PRIM_CYLINDER, sx: w / 2, sy: h / 2, sz: d / 2, round: Math.min(w, d, h) * 0.18 }
    default: {
      const profile = source.kind === 'cone' ? [[0, 0], [1, 0], [0, 1]] as [number, number][] : source.profile ?? [[0, 0], [1, 0], [1, 1], [0, 1]]
      const rmax = Math.max(...profile.map((p) => p[0])) || 1, t0 = Math.min(...profile.map((p) => p[1])), t1 = Math.max(...profile.map((p) => p[1])), mean = (w + d) / 4
      const poly = new Float64Array(profile.length * 2)
      profile.forEach(([radius, t], i) => { poly[i * 2] = radius / rmax * mean; poly[i * 2 + 1] = ((t - t0) / ((t1 - t0) || 1) - 0.5) * h })
      return { ...base, kind: PRIM_LATHE, sx: w / 2, sy: h / 2, sz: d / 2, poly }
    }
  }
}
/** Tapered capsule between two world points (radii ra → rb). */
export function segmentPrim(a: [number, number, number], b: [number, number, number], ra: number, rb: number): Prim {
  const poly = new Float64Array([a[0], a[1], a[2], b[0] - a[0], b[1] - a[1], b[2] - a[2], ra, rb])
  return { kind: PRIM_SEGMENT, r: new Float64Array(12), sx: 0, sy: 0, sz: 0, poly, round: 0, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, cz: (a[2] + b[2]) / 2,
    radius: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + Math.max(ra, rb) }
}
/** Ellipsoid with explicit world center and rotation matrix (column-major 4x4 or 3x3 inside a 4x4). */
export function ellipsoidPrim(matrix: ArrayLike<number>, radii: [number, number, number]): Prim {
  const r = rotation(matrix)
  return { kind: PRIM_ELLIPSOID, r, sx: radii[0], sy: radii[1], sz: radii[2], poly: null, round: 0, cx: r[9], cy: r[10], cz: r[11], radius: Math.max(...radii) }
}

/** 2D distance to a lathe profile in (ρ, y); returns signed distance and fills `out` with the outward direction. */
function profileDistance(poly: Float64Array, px: number, py: number, out: number[]): number {
  const n = poly.length / 2
  let best = Infinity, bx = 0, by = 0, inside = false
  const edge = (ax: number, ay: number, ex: number, ey: number) => {
    const wx = px - ax, wy = py - ay, ee = ex * ex + ey * ey
    const t = ee > 0 ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / ee)) : 0
    const dx = wx - ex * t, dy = wy - ey * t, dd = dx * dx + dy * dy
    if (dd < best) { best = dd; bx = dx; by = dy }
  }
  for (let i = 0; i < n - 1; i++) {
    const ax = poly[i * 2], ay = poly[i * 2 + 1], cx = poly[i * 2 + 2], cy = poly[i * 2 + 3]
    edge(ax, ay, cx - ax, cy - ay)
    if ((ay > py) !== (cy > py) && px < ax + (py - ay) * (cx - ax) / (cy - ay)) inside = !inside
  }
  if (poly[0] > 0) edge(poly[0], poly[1], -poly[0], 0)
  const lx = poly[n * 2 - 2], ly = poly[n * 2 - 1]
  if (lx > 0) edge(lx, ly, -lx, 0)
  const distance = Math.sqrt(best), s = inside ? -1 : 1
  if (distance > 1e-12) { out[0] = s * bx / distance; out[1] = s * by / distance } else { out[0] = 1; out[1] = 0 }
  return s * distance
}
const dir = [0, 0]
/** Approximate metric signed distance (exact zero set, first-order accurate magnitude). */
export function primDistance(p: Prim, x: number, y: number, z: number): number {
  if (p.kind === PRIM_SEGMENT) {
    const s = p.poly!, ax = x - s[0], ay = y - s[1], az = z - s[2], bx = s[3], by = s[4], bz = s[5], bb = bx * bx + by * by + bz * bz
    const t = bb > 0 ? Math.min(1, Math.max(0, (ax * bx + ay * by + az * bz) / bb)) : 0
    return Math.sqrt((ax - bx * t) ** 2 + (ay - by * t) ** 2 + (az - bz * t) ** 2) - (s[6] + (s[7] - s[6]) * t)
  }
  const r = p.r, dx = x - r[9], dy = y - r[10], dz = z - r[11]
  const lx = r[0] * dx + r[1] * dy + r[2] * dz, ly = r[3] * dx + r[4] * dy + r[5] * dz, lz = r[6] * dx + r[7] * dy + r[8] * dz
  switch (p.kind) {
    case PRIM_ELLIPSOID: {
      const qx = lx / p.sx, qy = ly / p.sy, qz = lz / p.sz, q = Math.sqrt(qx * qx + qy * qy + qz * qz)
      if (q < 1e-9) return -Math.min(p.sx, p.sy, p.sz)
      const ux = qx / p.sx, uy = qy / p.sy, uz = qz / p.sz, g = Math.sqrt(ux * ux + uy * uy + uz * uz) / q
      return (q - 1) / g
    }
    case PRIM_CAPSULE: {
      const qx = lx / p.sx, qy = ly / p.sy, qz = lz / p.sz, cy = qy - Math.min(1, Math.max(-1, qy)), q = Math.sqrt(qx * qx + cy * cy + qz * qz)
      if (q < 1e-9) return -Math.min(p.sx, p.sz)
      const ux = qx / p.sx, uy = cy / p.sy, uz = qz / p.sz, g = Math.sqrt(ux * ux + uy * uy + uz * uz) / q
      return (q - 1) / g
    }
    case PRIM_BOX: {
      const e = p.round, qx = Math.abs(lx) - p.sx + e, qy = Math.abs(ly) - p.sy + e, qz = Math.abs(lz) - p.sz + e
      const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0)
      return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - e
    }
    default: {
      const mean = (p.sx + p.sz) / 2, fx = mean / p.sx, fz = mean / p.sz, qx = lx * fx, qz = lz * fz, rho = Math.sqrt(qx * qx + qz * qz)
      let g: number
      if (p.kind === PRIM_CYLINDER) {
        const e = p.round, vx = rho - mean + e, vy = Math.abs(ly) - p.sy + e
        g = Math.hypot(Math.max(vx, 0), Math.max(vy, 0)) + Math.min(Math.max(vx, vy), 0) - e
        if (vx > 0 || vy > 0) { const l = Math.hypot(Math.max(vx, 0), Math.max(vy, 0)) || 1; dir[0] = Math.max(vx, 0) / l; dir[1] = Math.max(vy, 0) / l * Math.sign(ly || 1) }
        else if (vx > vy) { dir[0] = 1; dir[1] = 0 } else { dir[0] = 0; dir[1] = Math.sign(ly || 1) }
      } else g = profileDistance(p.poly!, rho, ly, dir)
      const nx = rho > 1e-9 ? dir[0] * qx / rho : dir[0], nz = rho > 1e-9 ? dir[0] * qz / rho : 0
      const ax = nx * fx, az = nz * fz
      return g / Math.max(1e-6, Math.sqrt(ax * ax + dir[1] * dir[1] + az * az))
    }
  }
}

export const OP_UNION = 0, OP_SUBTRACT = 1, OP_CLAMP = 2
/** `k` is the smooth blend radius; `offset` grows (negative) or insets (positive) the solid. OP_CLAMP keeps the field inside the solid within `region`. */
export interface FieldOp { prim: Prim; op: number; k: number; offset: number; region?: Prim; regionFade?: number }
export interface Field { ops: FieldOp[]; value: (x: number, y: number, z: number) => number; min: [number, number, number]; max: [number, number, number]; cut: number; reach: (x: number, y: number, z: number) => FieldOp[] }

const smin = (a: number, b: number, k: number) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25 }
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)

/** Builds a field with per-bin operation lists so evaluations only touch nearby solids. Values farther than `cut` are clamped. */
export function createField(ops: FieldOp[], cut: number): Field {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const op of ops) if (op.op === OP_UNION) {
    const p = op.prim, r = p.radius + op.k
    min[0] = Math.min(min[0], p.cx - r); min[1] = Math.min(min[1], p.cy - r); min[2] = Math.min(min[2], p.cz - r)
    max[0] = Math.max(max[0], p.cx + r); max[1] = Math.max(max[1], p.cy + r); max[2] = Math.max(max[2], p.cz + r)
  }
  const pad = cut * 1.5
  for (let a = 0; a < 3; a++) { min[a] -= pad; max[a] += pad }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]), bin = Math.max(cut * 0.5, size / 64)
  const nx = Math.ceil((max[0] - min[0]) / bin), ny = Math.ceil((max[1] - min[1]) / bin), nz = Math.ceil((max[2] - min[2]) / bin)
  const lists: FieldOp[][] = Array.from({ length: nx * ny * nz }, () => [])
  ops.forEach((op) => {
    const p = op.region ?? op.prim, reach = p.radius + op.k + (op.op === OP_UNION ? cut : (op.regionFade ?? 0)) + bin * 0.87
    const i0 = Math.max(0, Math.floor((p.cx - reach - min[0]) / bin)), i1 = Math.min(nx - 1, Math.floor((p.cx + reach - min[0]) / bin))
    const j0 = Math.max(0, Math.floor((p.cy - reach - min[1]) / bin)), j1 = Math.min(ny - 1, Math.floor((p.cy + reach - min[1]) / bin))
    const k0 = Math.max(0, Math.floor((p.cz - reach - min[2]) / bin)), k1 = Math.min(nz - 1, Math.floor((p.cz + reach - min[2]) / bin))
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const x = min[0] + (i + 0.5) * bin, y = min[1] + (j + 0.5) * bin, z = min[2] + (k + 0.5) * bin
      if (Math.hypot(x - p.cx, y - p.cy, z - p.cz) <= reach) lists[(k * ny + j) * nx + i].push(op)
    }
  })
  const empty: FieldOp[] = []
  const reachOf = (x: number, y: number, z: number) => {
    const i = Math.floor((x - min[0]) / bin), j = Math.floor((y - min[1]) / bin), k = Math.floor((z - min[2]) / bin)
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? empty : lists[(k * ny + j) * nx + i]
  }
  const value = (x: number, y: number, z: number) => {
    const list = reachOf(x, y, z)
    let f = cut
    for (let n = 0; n < list.length; n++) {
      const op = list[n], p = op.prim, cx = x - p.cx, cy = y - p.cy, cz = z - p.cz, lower = Math.sqrt(cx * cx + cy * cy + cz * cz) - p.radius + op.offset
      if (op.op === OP_UNION) { if (lower < f + op.k) f = smin(f, primDistance(p, x, y, z) + op.offset, op.k) }
      else if (op.op === OP_SUBTRACT) { if (lower < op.k - f) f = smax(f, -(primDistance(p, x, y, z) + op.offset), op.k) }
      else {
        const d = primDistance(p, x, y, z) + op.offset
        const region = op.region ? primDistance(op.region, x, y, z) : -1, fade = op.regionFade ?? 0.01
        const w = region <= 0 ? 1 : region >= fade ? 0 : 1 - region / fade
        if (w > 0 && d > f) f += (d - f) * w
      }
    }
    return Math.min(f, cut)
  }
  return { ops, value, min, max, cut, reach: reachOf }
}

/** Indexed triangle mesh used while building. */
export interface RawMesh { positions: number[]; indices: number[] }

/**
 * Narrow-band surface nets: a coarse pass (4h) finds cells near the surface, the fine grid (h) is evaluated lazily there.
 * Checkerboard faces are resolved before meshing, so every edge of the output is shared by exactly two triangles.
 */
export function surfaceNets(field: Field, h: number): RawMesh {
  const [x0, y0, z0] = field.min, nx = Math.ceil((field.max[0] - x0) / h) + 1, ny = Math.ceil((field.max[1] - y0) / h) + 1, nz = Math.ceil((field.max[2] - z0) / h) + 1
  const sy = nx + 1, sz = (nx + 1) * (ny + 1), corners = new Float32Array(sz * (nz + 1)).fill(Number.NaN)
  const corner = (index: number) => {
    let v = corners[index]
    if (v !== v) {
      const k = Math.floor(index / sz), j = Math.floor((index - k * sz) / sy), i = index - k * sz - j * sy
      v = field.value(x0 + i * h, y0 + j * h, z0 + k * h); if (v === 0) v = 1e-7; corners[index] = v
    }
    return v
  }
  const C = 4, cx = Math.ceil(nx / C), cy = Math.ceil(ny / C), cz = Math.ceil(nz / C), H = h * C, active: number[] = []
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const v = field.value(x0 + (i + 0.5) * H, y0 + (j + 0.5) * H, z0 + (k + 0.5) * H)
    if (Math.abs(v) < H * 1.05) active.push(i, j, k)
  }
  const fine: number[] = [], S = 2, threshold = h * S * 0.95
  for (let a = 0; a < active.length; a += 3) for (let k = 0; k < C / S; k++) for (let j = 0; j < C / S; j++) for (let i = 0; i < C / S; i++) {
    const bi = active[a] * C + i * S, bj = active[a + 1] * C + j * S, bk = active[a + 2] * C + k * S
    if (bi >= nx || bj >= ny || bk >= nz) continue
    if (Math.abs(field.value(x0 + (bi + S / 2) * h, y0 + (bj + S / 2) * h, z0 + (bk + S / 2) * h)) < threshold) fine.push(bi, bj, bk)
  }
  const each = (visit: (index: number) => void) => {
    for (let a = 0; a < fine.length; a += 3) {
      const i0 = Math.max(1, fine[a]), i1 = Math.min(nx - 1, fine[a] + S - 1), j0 = Math.max(1, fine[a + 1]), j1 = Math.min(ny - 1, fine[a + 1] + S - 1)
      const k0 = Math.max(1, fine[a + 2]), k1 = Math.min(nz - 1, fine[a + 2] + S - 1)
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(i + j * sy + k * sz)
    }
  }
  const steps = [1, sy, sz]
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    each((index) => {
      for (let f = 0; f < 3; f++) {
        const u = steps[f === 2 ? 1 : 0], v = steps[f === 0 ? 1 : 2]
        const c00 = corner(index), c10 = corner(index + u), c01 = corner(index + v), c11 = corner(index + u + v)
        if ((c00 < 0) === (c11 < 0) && (c10 < 0) === (c01 < 0) && (c00 < 0) !== (c10 < 0)) {
          const values = [c00, c10, c01, c11], offsets = [0, u, v, u + v]
          let weakest = 0
          for (let n = 1; n < 4; n++) if (Math.abs(values[n]) < Math.abs(values[weakest])) weakest = n
          corners[index + offsets[weakest]] = -values[weakest] || 1e-7
          changed = true
        }
      }
    })
    if (!changed) break
  }
  const cellVertex = new Int32Array(corners.length).fill(-1), vertexCell: number[] = [], positions: number[] = [], indices: number[] = []
  const vertexOf = (cell: number): number => {
    const known = cellVertex[cell]
    if (known >= 0) return known
    let px = 0, py = 0, pz = 0, count = 0
    for (let e = 0; e < 12; e++) {
      const a = EDGES[e][0], b = EDGES[e][1], va = corner(cell + CORNER[a]), vb = corner(cell + CORNER[b])
      if ((va < 0) === (vb < 0)) continue
      const t = va / (va - vb)
      px += (a & 1) + ((b & 1) - (a & 1)) * t; py += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; pz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; count++
    }
    const k = Math.floor(cell / sz), j = Math.floor((cell - k * sz) / sy), i = cell - k * sz - j * sy, index = positions.length / 3
    positions.push(x0 + (i + px / count) * h, y0 + (j + py / count) * h, z0 + (k + pz / count) * h)
    cellVertex[cell] = index
    vertexCell.push(cell)
    return index
  }
  const CORNER = [0, 1, sy, 1 + sy, sz, 1 + sz, sy + sz, 1 + sy + sz]
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    const pa = a * 3, pb = b * 3, pc = c * 3, pd = d * 3
    const ac = (positions[pa] - positions[pc]) ** 2 + (positions[pa + 1] - positions[pc + 1]) ** 2 + (positions[pa + 2] - positions[pc + 2]) ** 2
    const bd = (positions[pb] - positions[pd]) ** 2 + (positions[pb + 1] - positions[pd + 1]) ** 2 + (positions[pb + 2] - positions[pd + 2]) ** 2
    if (ac < bd) { if (flip) indices.push(a, c, b, a, d, c); else indices.push(a, b, c, a, c, d) }
    else if (flip) indices.push(a, d, b, b, d, c); else indices.push(a, b, d, b, c, d)
  }
  const done = new Uint8Array(corners.length)
  const edges = (index: number) => {
    const v0 = corner(index)
    for (let axis = 0; axis < 3; axis++) {
      if (done[index] & (1 << axis)) continue
      done[index] |= 1 << axis
      const v1 = corner(index + steps[axis])
      if ((v0 < 0) === (v1 < 0)) continue
      const u = steps[axis === 0 ? 1 : 0], v = steps[axis === 2 ? 1 : 2], flip = axis === 1 ? v0 < 0 : v0 > 0
      quad(vertexOf(index - u - v), vertexOf(index - v), vertexOf(index), vertexOf(index - u), flip)
    }
  }
  each(edges)
  // Steep fields (clamps, thin parts) can escape the band test; grow the visited region around open edges until the surface closes.
  for (let pass = 0; pass < 8; pass++) {
    const count = new Map<number, number>(), V = positions.length / 3 + 1
    for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) { const a = indices[t + e], b = indices[t + (e + 1) % 3], key = a < b ? a * V + b : b * V + a; count.set(key, (count.get(key) ?? 0) + 1) }
    const cells = new Set<number>()
    for (const [key, n] of count) if (n !== 2) { cells.add(vertexCell[Math.floor(key / V)]); cells.add(vertexCell[key % V]) }
    if (!cells.size) break
    for (const cell of cells) for (let dk = -1; dk <= 2; dk++) for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
      const index = cell + di + dj * sy + dk * sz, k = Math.floor(index / sz), j = Math.floor((index - k * sz) / sy), i = index - k * sz - j * sy
      if (i >= 1 && j >= 1 && k >= 1 && i < nx && j < ny && k < nz) edges(index)
    }
  }
  return { positions, indices }
}
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const

const TETRA = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]] as const
/** Field gradient (unnormalized) by the tetrahedral stencil. */
export function gradient(field: Field, x: number, y: number, z: number, e: number, out: number[]): void {
  out[0] = 0; out[1] = 0; out[2] = 0
  for (const [a, b, c] of TETRA) { const v = field.value(x + a * e, y + b * e, z + c * e); out[0] += a * v; out[1] += b * v; out[2] += c * v }
  out[0] /= 4 * e; out[1] /= 4 * e; out[2] /= 4 * e
}
const g = [0, 0, 0]
/** Newton steps towards the zero set; displacement per step is capped by `limit`. */
export function project(field: Field, positions: number[], from: number, e: number, limit: number, steps = 2): void {
  for (let i = from * 3; i < positions.length; i += 3) for (let s = 0; s < steps; s++) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2], f = field.value(x, y, z)
    if (Math.abs(f) < e * 0.05) break
    gradient(field, x, y, z, e, g)
    const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2]
    if (gg < 1e-8) break
    let step = f / gg
    const length = Math.abs(step) * Math.sqrt(gg)
    if (length > limit) step *= limit / length
    positions[i] = x - g[0] * step; positions[i + 1] = y - g[1] * step; positions[i + 2] = z - g[2] * step
  }
}

/**
 * Red-green refinement of the triangles whose centroid satisfies `inside`, new vertices projected onto the field.
 * Neighbours with one split edge are bisected, so the mesh stays conforming (no T-junctions).
 */
export function refine(mesh: RawMesh, field: Field, inside: (x: number, y: number, z: number) => boolean, e: number, limit: number): RawMesh {
  const { positions, indices } = mesh, start = positions.length / 3, V = start + 1
  const key = (a: number, b: number) => a < b ? a * V + b : b * V + a
  const marked = new Set<number>()
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    if (inside((positions[a] + positions[b] + positions[c]) / 3, (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3, (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3)) {
      marked.add(key(indices[t], indices[t + 1])); marked.add(key(indices[t + 1], indices[t + 2])); marked.add(key(indices[t + 2], indices[t]))
    }
  }
  for (let changed = true; changed;) {
    changed = false
    for (let t = 0; t < indices.length; t += 3) {
      const ks = [key(indices[t], indices[t + 1]), key(indices[t + 1], indices[t + 2]), key(indices[t + 2], indices[t])], count = ks.filter((k) => marked.has(k)).length
      if (count === 2) { for (const k of ks) marked.add(k); changed = true }
    }
  }
  const middle = new Map<number, number>()
  const mid = (a: number, b: number) => {
    const k = key(a, b), known = middle.get(k)
    if (known !== undefined) return known
    const index = positions.length / 3
    positions.push((positions[a * 3] + positions[b * 3]) / 2, (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2, (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2)
    middle.set(k, index)
    return index
  }
  const out: number[] = []
  for (let t = 0; t < indices.length; t += 3) {
    const v = [indices[t], indices[t + 1], indices[t + 2]], split = [marked.has(key(v[0], v[1])), marked.has(key(v[1], v[2])), marked.has(key(v[2], v[0]))]
    const count = split.filter(Boolean).length
    if (count === 0) out.push(...v)
    else if (count === 3) { const ab = mid(v[0], v[1]), bc = mid(v[1], v[2]), ca = mid(v[2], v[0]); out.push(v[0], ab, ca, ab, v[1], bc, ca, bc, v[2], ab, bc, ca) }
    else { const s = split.indexOf(true), a = v[s], b = v[(s + 1) % 3], c = v[(s + 2) % 3], m = mid(a, b); out.push(a, m, c, m, b, c) }
  }
  project(field, positions, start, e, limit, 3)
  return { positions, indices: out }
}

/** Vertex adjacency (unique neighbours) as CSR arrays. */
export function adjacency(count: number, indices: ArrayLike<number>): { offsets: Int32Array; list: Int32Array } {
  const sets: Set<number>[] = Array.from({ length: count }, () => new Set())
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) { const a = indices[t + e], b = indices[t + (e + 1) % 3]; sets[a].add(b); sets[b].add(a) }
  const offsets = new Int32Array(count + 1)
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + sets[i].size
  const list = new Int32Array(offsets[count])
  for (let i = 0; i < count; i++) { let n = offsets[i]; for (const j of sets[i]) list[n++] = j }
  return { offsets, list }
}

/** Tangential Laplacian relaxation followed by re-projection: evens the triangles while keeping the designed surface. */
export function relax(mesh: RawMesh, field: Field, iterations: number, e: number, limit: number): void {
  const { positions } = mesh, count = positions.length / 3, { offsets, list } = adjacency(count, mesh.indices), next = new Float64Array(positions.length)
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < count; i++) {
      let ax = 0, ay = 0, az = 0
      const n = offsets[i + 1] - offsets[i]
      for (let o = offsets[i]; o < offsets[i + 1]; o++) { const j = list[o] * 3; ax += positions[j]; ay += positions[j + 1]; az += positions[j + 2] }
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
      if (!n) { next[i * 3] = x; next[i * 3 + 1] = y; next[i * 3 + 2] = z; continue }
      let dx = (ax / n - x) * 0.6, dy = (ay / n - y) * 0.6, dz = (az / n - z) * 0.6
      gradient(field, x, y, z, e, g)
      const l = Math.hypot(g[0], g[1], g[2])
      if (l > 1e-9) { const d = (dx * g[0] + dy * g[1] + dz * g[2]) / l; dx -= g[0] / l * d; dy -= g[1] / l * d; dz -= g[2] / l * d }
      next[i * 3] = x + dx; next[i * 3 + 1] = y + dy; next[i * 3 + 2] = z + dz
    }
    for (let i = 0; i < positions.length; i++) positions[i] = next[i]
    project(field, positions, 0, e, limit, 2)
  }
}

/** Unit normals from the field gradient (smooth across blends, no faceting). */
export function fieldNormals(field: Field, positions: ArrayLike<number>, e: number): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    gradient(field, positions[i], positions[i + 1], positions[i + 2], e, g)
    const l = Math.hypot(g[0], g[1], g[2]) || 1
    normals[i] = g[0] / l; normals[i + 1] = g[1] / l; normals[i + 2] = g[2] / l
  }
  return normals
}

/** Edge-manifold check: returns the number of edges not shared by exactly two triangles and the connected components. */
export function topology(indices: ArrayLike<number>, count: number): { openEdges: number; components: number } {
  const edges = new Map<number, number>(), V = count + 1
  for (let t = 0; t < indices.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = indices[t + e], b = indices[t + (e + 1) % 3], k = a < b ? a * V + b : b * V + a
    edges.set(k, (edges.get(k) ?? 0) + 1)
  }
  let openEdges = 0
  for (const n of edges.values()) if (n !== 2) openEdges++
  const parent = Int32Array.from({ length: count }, (_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let t = 0; t < indices.length; t += 3) { const a = find(indices[t]); parent[find(indices[t + 1])] = a; parent[find(indices[t + 2])] = a }
  const used = new Set<number>()
  for (let t = 0; t < indices.length; t++) used.add(find(indices[t]))
  return { openEdges, components: used.size }
}
