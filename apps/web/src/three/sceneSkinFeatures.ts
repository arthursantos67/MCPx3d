import * as THREE from 'three'
import { hashNoise } from './sceneGeometrySpec.ts'
import type { PrefabPart } from './scenePrefabs.ts'
import { createField, ellipsoidPrim, fieldNormals, OP_SUBTRACT, OP_UNION, project, relax, segmentPrim, surfaceNets, type Field, type FieldOp } from './sceneSkinGeometry.ts'
import { emptyPiece, MATERIAL_BODY, MATERIAL_EYE, MATERIAL_HAIR, MATERIAL_SHELL, normalAt, overrideSlot, PATTERN, singleSlot, slotOf, surfaceAlong, type Piece, type SlotMaterial, type SlotTable } from './sceneSkinMesh.ts'
import type { FaceRig, SkinBone, SkinPart, SkinRequest, SpringPlan } from './sceneSkinModel.ts'
import type { SkinPlan } from './sceneSkinPlan.ts'

type V3 = [number, number, number]
export interface FeatureContext {
  request: SkinRequest; plan: SkinPlan; parts: PrefabPart[]; byId: Map<string, PrefabPart>; bind: Map<string, THREE.Matrix4>
  bones: SkinBone[]; boneIndex: Map<string, number>; internal: (name: string, parent: number, local: THREE.Matrix4) => number
  slots: SlotTable; skinParts: SkinPart[]; unitScale: number
  extraOps: { body: number; op: FieldOp; minLevel?: number; maxLevel?: number }[]
  face: FaceRig | null; springs: SpringPlan[]; eyeSlots: SlotMaterial[]; hairSlots: SlotMaterial[]
  refineRegions: { body: number; levels: number; center: V3; radius: number; inner?: { center: V3; radius: number } }[]
  decorateBody?: (piece: Piece, level: number, field: Field, body: number) => void
}
type Builder = (level: number, fields: Field[], h: number) => Piece[]
type Decorator = (piece: Piece, level: number, field: Field, body: number) => void

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.sqrt(dot(a, a))
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const apply = (m: THREE.Matrix4, p: V3): V3 => { const e = m.elements; return [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]] }
const rotate = (m: THREE.Matrix4, p: V3): V3 => { const e = m.elements; return norm([e[0] * p[0] + e[4] * p[1] + e[8] * p[2], e[1] * p[0] + e[5] * p[1] + e[9] * p[2], e[2] * p[0] + e[6] * p[1] + e[10] * p[2]]) }
const translation = (p: V3) => new THREE.Matrix4().makeTranslation(p[0], p[1], p[2])
const hexMix = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()

/** Appends one vertex; `weights` are (bone, weight) pairs, normalized here. */
function vertex(piece: Piece, p: V3, n: V3, uv: [number, number], color: number, weights: [number, number][], slots: number[]): number {
  piece.positions.push(...p); piece.normals.push(...n); piece.uvs.push(...uv); piece.colors.push(color, color, color)
  const list = weights.filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4), total = list.reduce((s, [, w]) => s + w, 0) || 1
  for (let i = 0; i < 4; i++) { piece.bones.push(list[i]?.[0] ?? 0); piece.weights.push(list[i] ? list[i][1] / total : 0) }
  piece.slots.push(...slots)
  return piece.positions.length / 3 - 1
}
/** Grid of rows × columns (columns wrap when `closed`), triangulated with outward winding. */
function grid(piece: Piece, start: number, rows: number, columns: number, closed: boolean, flip = false) {
  const span = closed ? columns : columns - 1, first = piece.indices.length
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < span; c++) {
    const a = start + r * columns + c, b = start + r * columns + (c + 1) % columns, d = start + (r + 1) * columns + c, e = start + (r + 1) * columns + (c + 1) % columns
    if (flip) piece.indices.push(a, b, d, b, e, d); else piece.indices.push(a, d, b, b, d, e)
  }
  orient(piece, first)
}
/** Makes the winding of the triangles appended since `first` agree with the vertex normals (front faces outside). */
function orient(piece: Piece, first: number) {
  const P = piece.positions, N = piece.normals, I = piece.indices
  let score = 0
  for (let t = first; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
    const n = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]])
    score += n[0] * (N[a] + N[b] + N[c]) + n[1] * (N[a + 1] + N[b + 1] + N[c + 1]) + n[2] * (N[a + 2] + N[b + 2] + N[c + 2])
  }
  if (score < 0) for (let t = first; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x }
}
/** Closed tube along a polyline with per-point radii (two radii for elliptic sections), capped at both ends. */
function tube(piece: Piece, path: V3[], radii: [number, number][], up: V3, sides: number, weights: (i: number, p: V3) => [number, number][], slots: (i: number, around: V3) => number[], color = 1) {
  const start = piece.positions.length / 3
  for (let i = 0; i < path.length; i++) {
    const t = norm(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)])), b = norm(cross(t, up)), n = cross(b, t)
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2, around = norm(add(mul(n, Math.cos(a)), mul(b, Math.sin(a))))
      const p = add(path[i], add(mul(n, Math.cos(a) * radii[i][0]), mul(b, Math.sin(a) * radii[i][1])))
      vertex(piece, p, around, [s / sides, i / (path.length - 1)], color, weights(i, p), slots(i, around))
    }
  }
  grid(piece, start, path.length, sides, true, true)
  for (const [end, sign] of [[0, -1], [path.length - 1, 1]] as const) {
    const t = norm(sub(path[Math.min(path.length - 1, end + 1)], path[Math.max(0, end - 1)])), p = add(path[end], mul(t, sign * Math.min(radii[end][0], radii[end][1]) * 0.6))
    const center = vertex(piece, p, mul(t, sign), [0.5, end ? 1 : 0], color, weights(end, p), slots(end, mul(t, sign))), ring = start + end * sides
    for (let s = 0; s < sides; s++) { const a = ring + s, b = ring + (s + 1) % sides; if (sign > 0) piece.indices.push(a, b, center); else piece.indices.push(b, a, center) }
  }
}

export function buildFeatures(ctx: FeatureContext): Builder {
  const builders: Builder[] = [], decorators: Decorator[] = []
  if (ctx.plan.kind === 'humanoid') {
    if (ctx.plan.face) face(ctx, builders, decorators)
    if (ctx.plan.fingers) hands(ctx, builders)
    if (ctx.plan.shell) shell(ctx, builders)
    if (ctx.plan.cape) cape(ctx, builders)
  }
  if (ctx.plan.bodies > 1) mouthInterior(ctx, decorators)
  ctx.decorateBody = (piece, level, field, body) => { for (const decorate of decorators) decorate(piece, level, field, body) }
  return (level, fields, h) => builders.flatMap((build) => build(level, fields, h))
}

function partColor(part: PrefabPart | undefined, fallback: string) { return part?.material?.color ?? fallback }

/** Face sculpt, eyes with lids, brows, mouth with jaw and corner bones, hair, beard and tusks. */
function face(ctx: FeatureContext, builders: Builder[], decorators: Decorator[]) {
  const head = ctx.byId.get('head'), headBone = ctx.boneIndex.get('j_head')
  if (!head || headBone === undefined) return
  const H = ctx.bind.get('j_head')!, Hinv = H.clone().invert(), seed = ctx.request.seed
  const hs = head.dimensions[1] / 0.25, c = head.position as V3, R: V3 = [head.dimensions[0] / 2, head.dimensions[1] / 2, head.dimensions[2] / 2]
  const world = (p: V3) => apply(H, p), local = (p: V3) => apply(Hinv, p), forward = rotate(H, [0, 0, 1])
  const character = ctx.request.character, realistic = character?.style === 'realistic', child = character?.age === 'child'
  const re = hs * (realistic ? 0.0118 : 0.0136) * (child ? 1.12 : 1)
  const headParts = ctx.skinParts.filter((part) => part.bone === headBone)
  const headSlot = headParts.find((part) => part.id === 'head')?.slot ?? 0
  const baseOps: FieldOp[] = headParts.map((part) => ({ prim: part.prim, op: OP_UNION, k: 0.02 * ctx.unitScale, offset: 0 }))
  const unions: FieldOp[] = [], carves: FieldOp[] = []
  const uni = (prim: ReturnType<typeof segmentPrim>, k: number) => unions.push({ prim, op: OP_UNION, k: k * hs, offset: 0 })
  const ellipsoid = (center: V3, radii: V3) => ellipsoidPrim(new THREE.Matrix4().copy(H).multiply(translation(center)).elements, mul(radii, hs) as V3)
  const seg = (a: V3, b: V3, ra: number, rb: number) => segmentPrim(world(a), world(b), ra * hs, rb * hs)
  const eyeY = (ctx.byId.get('eyeL')?.position[1] ?? c[1] + 0.005 * hs), eyeX = Math.abs(ctx.byId.get('eyeL')?.position[0] ?? 0.048 * hs)
  const mouthY = ctx.byId.get('mouth')?.position[1] ?? c[1] - 0.07 * hs
  if (!ctx.byId.has('chin')) uni(ellipsoid([c[0], c[1] - 0.085 * hs, c[2] + 0.058 * hs], [0.044, 0.034, 0.045]), 0.03)
  for (const side of [1, -1]) uni(ellipsoid([c[0] + side * 0.05 * hs, c[1] - 0.012 * hs, c[2] + 0.064 * hs], [0.034, 0.026, 0.034]), 0.02)
  let field = createField([...baseOps, ...unions], 0.1 * hs)
  const surface = (x: number, y: number, depth = 0): V3 => {
    const from = world([x, y, c[2]]), hit = surfaceAlong(field, from, forward, R[2] * 2.2, R[2] * 0.06)
    const p = hit ? local(hit) : [x, y, c[2] + R[2]] as V3
    return [p[0], p[1], p[2] - depth]
  }
  if (!ctx.byId.has('browRidge')) {
    const xs = [-0.062, -0.022, 0.022, 0.062], pts = xs.map((x) => surface(x * hs, eyeY + (Math.abs(x) > 0.04 ? 0.034 : 0.042) * hs, 0.006 * hs))
    for (let i = 0; i < 3; i++) uni(seg(pts[i], pts[i + 1], 0.012, 0.012), 0.016)
  }
  const nose = ctx.byId.get('nose')
  if (nose) {
    const top = surface(0, eyeY + 0.006 * hs, 0.004 * hs)
    uni(seg(top, nose.position as V3, 0.0075, 0.011), 0.012)
  }
  field = createField([...baseOps, ...unions], 0.1 * hs)
  const mouth = surface(0, mouthY), cornerX = 0.026 * hs
  const lip = (dy: number, r: number, push: number) => {
    const pts = [-1, -0.45, 0.45, 1].map((t) => { const p = surface(t * 0.024 * hs, mouthY + dy * hs); return [p[0], p[1] - Math.abs(t) * 0.002 * hs, p[2] + push * hs * (1 - t * t * 0.6)] as V3 })
    for (let i = 0; i < 3; i++) uni(seg(pts[i], pts[i + 1], r * (i === 1 ? 1 : 0.8), r * (i === 1 ? 1 : 0.8)), 0.007)
  }
  lip(0.0048, 0.0034, -0.0006); lip(-0.0055, 0.004, -0.001)
  const glowEyes = !!ctx.byId.get('eyeL')?.material?.emissive
  const eyes: { center: V3; forward: V3; side: number }[] = []
  for (const side of [1, -1]) {
    const s = surface(side * eyeX, eyeY), f = norm([side * 0.12, 0.02, 1]), center = sub(s, mul(f, re * 0.78))
    eyes.push({ center, forward: f, side })
    carves.push({ prim: ellipsoidPrim(new THREE.Matrix4().copy(H).multiply(translation(add(center, mul(f, re * 0.1)))).elements, [re * 1.42, re * 1.12, re * 1.2]), op: OP_SUBTRACT, k: re * 0.45, offset: 0 })
  }
  const groove = { a: [-0.022 * hs, mouthY, mouth[2] - 0.0012 * hs] as V3, b: [0.022 * hs, mouthY, mouth[2] - 0.0012 * hs] as V3, r: 0.0024 * hs }
  carves.push({ prim: segmentPrim(world(groove.a), world(groove.b), groove.r, groove.r), op: OP_SUBTRACT, k: 0.0025 * hs, offset: 0 })
  if (nose && nose.kind === 'sphere') for (const side of [1, -1]) {
    const tip = nose.position as V3
    carves.push({ prim: ellipsoidPrim(new THREE.Matrix4().copy(H).multiply(translation([tip[0] + side * 0.0095 * hs, tip[1] - nose.dimensions[1] * 0.4, tip[2] + nose.dimensions[2] * 0.12])).elements, [0.0045 * hs, 0.003 * hs, 0.0045 * hs]), op: OP_SUBTRACT, k: 0.002 * hs, offset: 0 })
  }
  for (const op of [...unions, ...carves]) ctx.extraOps.push({ body: 0, op })
  // Bones of the face: jaw, eyes, lids, brows and mouth corners hang from the head bone.
  const bone = (name: string, at: V3) => ctx.internal(name, headBone, translation(at))
  const jaw = bone('jaw', [c[0], c[1] - 0.015 * hs, c[2] - 0.025 * hs])
  const eyeBones = eyes.map((eye) => bone(`eye${eye.side > 0 ? 'L' : 'R'}`, eye.center)) as [number, number]
  const lidBones = eyes.map((eye) => bone(`lid${eye.side > 0 ? 'L' : 'R'}`, eye.center)) as [number, number]
  const browCenters = [1, -1].map((side) => surface(side * 0.042 * hs, eyeY + 0.042 * hs))
  const browBones = browCenters.map((p, i) => bone(`brow${i ? 'R' : 'L'}`, p)) as [number, number]
  const cornerPoints = [1, -1].map((side) => surface(side * cornerX, mouthY))
  const cornerBones = cornerPoints.map((p, i) => bone(`mouth${i ? 'R' : 'L'}`, p)) as [number, number]
  const lidOpen = 1.12
  ctx.face = { jaw, eyes: eyeBones, lids: lidBones, brows: browBones, corners: cornerBones, scale: hs, lidClosed: Math.PI / 2 + 0.42 - lidOpen }
  // Slots and colours.
  const skinColor = partColor(ctx.byId.get('head'), '#e3b08c')
  const style = hairStyle(ctx), hairColor = partColor(ctx.byId.get('hair') ?? ctx.byId.get('hairTuft') ?? ctx.byId.get('spike0') ?? ctx.byId.get('topknot') ?? ctx.byId.get('beard') ?? ctx.byId.get('hairTail') ?? ctx.byId.get('braidL'), '#3a2a20')
  const beardPart = ctx.byId.get('beard'), beardColor = partColor(beardPart, hairColor), browColor = partColor(ctx.byId.get('browL'), hexMix(hairColor, '#000000', 0.25))
  const hairSlotMat: SlotMaterial = { color: hairColor, roughness: 0.62, metalness: 0, sheen: 0.7, clearcoat: 0, emissive: '#000000', emissiveIntensity: 0, pattern: PATTERN.hair }
  const capSlot = ctx.slots.add({ ...hairSlotMat, color: hexMix(hairColor, '#000000', 0.18) })
  const lipSlot = ctx.slots.add({ ...slotOf(ctx.byId.get('head')?.material), color: hexMix(skinColor, '#b0484a', 0.2), roughness: 0.45 })
  const mouthSlot = ctx.slots.add({ color: '#3a1416', roughness: 0.5, metalness: 0, sheen: 0, clearcoat: 0.3, emissive: '#000000', emissiveIntensity: 0, pattern: PATTERN.plain })
  const lashSlot = ctx.slots.add({ color: hexMix(browColor, '#000000', 0.4), roughness: 0.8, metalness: 0, sheen: 0.3, clearcoat: 0, emissive: '#000000', emissiveIntensity: 0, pattern: PATTERN.plain })
  const ivorySlot = ctx.slots.add({ ...slotOf(ctx.byId.get('tuskL')?.material), pattern: PATTERN.plain })
  ctx.hairSlots.push(hairSlotMat, { ...hairSlotMat, color: browColor }, { ...hairSlotMat, color: beardColor })
  const irisColor = partColor(ctx.byId.get('irisL'), '#5a3b1e'), glowColor = ctx.byId.get('eyeL')?.material?.emissive ?? '#ffd23a'
  ctx.eyeSlots.push(
    { color: glowEyes ? hexMix(glowColor, '#3a2a10', 0.55) : '#efe9e0', roughness: 0.18, metalness: 0, sheen: 0, clearcoat: 1, emissive: glowEyes ? glowColor : '#000000', emissiveIntensity: glowEyes ? 0.35 : 0, pattern: PATTERN.plain },
    { color: glowEyes ? glowColor : irisColor, roughness: 0.25, metalness: 0, sheen: 0, clearcoat: 1, emissive: glowEyes ? glowColor : '#000000', emissiveIntensity: glowEyes ? 2.2 : 0, pattern: PATTERN.plain },
    { color: '#0a0807', roughness: 0.15, metalness: 0, sheen: 0, clearcoat: 1, emissive: '#000000', emissiveIntensity: 0, pattern: PATTERN.plain })
  // Refinement: the whole head once, the front of the face twice (LOD0).
  ctx.refineRegions.push({ body: 0, levels: 2, center: world([c[0], c[1] - 0.015 * hs, c[2] + 0.045 * hs]), radius: 0.125 * hs, inner: { center: world([c[0], c[1] - 0.028 * hs, c[2] + 0.085 * hs]), radius: 0.062 * hs } })
  const hairlineFront = style.receding ? 0.62 : 0.5
  const hairline = (az: number) => { const k = Math.cos(az); return k > 0 ? 0.06 + (hairlineFront - 0.06) * k * k : 0.06 + 0.62 * k }
  const ellipse = (p: V3) => { const q: V3 = [(p[0] - c[0]) / R[0], (p[1] - c[1]) / R[1], (p[2] - c[2]) / R[2]]; return { q, r: len(q), elevation: Math.asin(Math.max(-1, Math.min(1, q[1] / (len(q) || 1)))), az: Math.atan2(q[0], q[2]) } }
  const inHair = (p: V3) => {
    if (style.kind === 'bald' || style.kind === 'none') return -1
    const { q, elevation, az } = ellipse(p)
    if (style.kind === 'mohawk') return Math.min(0.2 - Math.abs(q[0]), elevation + 0.2)
    let g = elevation - hairline(az)
    if (style.hat !== null) g = Math.min(g, (style.hat - p[1]) / R[1] + 0.1)
    return g
  }
  const beardOn = !!beardPart, beardLong = beardPart?.kind === 'lathe'
  const inBeard = (p: V3) => {
    if (!beardOn) return -1
    const { elevation, az } = ellipse(p), front = Math.cos(az)
    const chin = p[1] < mouthY - 0.012 * hs && front > -0.15, sideburn = Math.abs(az) > 0.85 && Math.abs(az) < 1.75 && elevation < 0.05 && p[1] < eyeY - 0.01 * hs
    return chin || sideburn ? 0.02 : -1
  }
  decorators.push((piece, level, _field, body) => {
    if (body !== 0) return
    const count = piece.positions.length / 3
    for (let v = 0; v < count; v++) {
      let wHead = 0
      for (let i = 0; i < 4; i++) if (piece.bones[v * 4 + i] === headBone) wHead += piece.weights[v * 4 + i]
      if (wHead < 0.05) continue
      const p = local([piece.positions[v * 3], piece.positions[v * 3 + 1], piece.positions[v * 3 + 2]]), { r } = ellipse(p)
      const scalp = r < 1.12 && wHead > 0.5
      if (scalp) { const g = inHair(p); if (g > -0.08) overrideSlot(piece, v, capSlot, -g * R[1] * 0.6) }
      if (scalp && beardOn) { const g = inBeard(p); if (g > 0) overrideSlot(piece, v, capSlot, -g * hs) }
      const lx = p[0] / (0.031 * hs), ly = (p[1] - mouthY) / (0.0155 * hs)
      if (p[2] > c[2] && Math.abs(lx) < 2) overrideSlot(piece, v, lipSlot, (Math.sqrt(lx * lx + ly * ly) - 1) * 0.008 * hs)
      const t = Math.max(0, Math.min(1, (p[0] - groove.a[0]) / (groove.b[0] - groove.a[0]))), gp = mix(groove.a, groove.b, t), gd = len(sub(p, gp)) - groove.r * 1.55
      if (gd < groove.r * 2) overrideSlot(piece, v, mouthSlot, gd)
      // Facial bones take their share of the head weight.
      const jawShare = smooth(mouthY + 0.004 * hs, mouthY - 0.009 * hs, p[1]) * smooth(c[2] - 0.05 * hs, c[2] + 0.02 * hs, p[2])
      const shares = new Map<number, number>()
      cornerPoints.forEach((corner, i) => { const d = len(sub(p, corner)) / (0.024 * hs); if (d < 1) shares.set(cornerBones[i], 0.85 * (1 - d) ** 2) })
      browCenters.forEach((center, i) => { const d = len(sub(p, center)) / (0.034 * hs); if (d < 1 && p[1] > eyeY + 0.01 * hs) shares.set(browBones[i], 0.6 * (1 - d) ** 2) })
      const cornerTotal = [...shares.entries()].filter(([b]) => cornerBones.includes(b)).reduce((s, [, w]) => s + w, 0)
      if (jawShare > 0) shares.set(jaw, jawShare * (1 - cornerTotal))
      const total = [...shares.values()].reduce((s, w) => s + w, 0)
      if (!total) continue
      const scale = Math.min(1, 1 / total), map = new Map<number, number>()
      for (let i = 0; i < 4; i++) { const b = piece.bones[v * 4 + i], w = piece.weights[v * 4 + i]; if (w > 0) map.set(b, (map.get(b) ?? 0) + w) }
      map.set(headBone, wHead * (1 - Math.min(1, total)))
      for (const [b, w] of shares) map.set(b, (map.get(b) ?? 0) + wHead * w * scale)
      const list = [...map].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = list.reduce((s, [, w]) => s + w, 0) || 1
      for (let i = 0; i < 4; i++) { piece.bones[v * 4 + i] = list[i]?.[0] ?? 0; piece.weights[v * 4 + i] = list[i] ? list[i][1] / sum : 0 }
    }
    void level
  })
  builders.push((level, fields, h) => {
    const eyesPiece = emptyPiece('olhos', MATERIAL_EYE), lids = emptyPiece('pálpebras', MATERIAL_BODY), brows = emptyPiece('sobrancelhas', MATERIAL_HAIR)
    const rings = [16, 11, 7][level], segments = [20, 14, 9][level], alphaIris = realistic ? 0.5 : 0.6, alphaPupil = alphaIris * (glowEyes ? 0.3 : 0.45)
    eyes.forEach((eye, i) => {
      const f = eye.forward, up = norm(sub([0, 1, 0], mul(f, f[1]))), right = cross(up, f), start = eyesPiece.positions.length / 3
      for (let r = 0; r <= rings; r++) {
        const alpha = (r / rings) * Math.PI
        for (let s = 0; s < segments; s++) {
          const phi = (s / segments) * Math.PI * 2, dir = norm(add(mul(f, Math.cos(alpha)), add(mul(up, Math.sin(alpha) * Math.cos(phi)), mul(right, Math.sin(alpha) * Math.sin(phi)))))
          const bulge = 1 + 0.07 * Math.max(0, (Math.cos(alpha) - Math.cos(alphaIris)) / (1 - Math.cos(alphaIris)))
          const lateral = dot(dir, right), vertical = dot(dir, up), slit = glowEyes ? Math.sqrt((lateral * 3) ** 2 + vertical ** 2) : Math.sin(alpha)
          const slots = [0, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05]
          const gIris = (alpha - alphaIris) * re, gPupil = (cos0(alpha) ? (slit - Math.sin(alphaPupil)) : 1) * re
          slots[1] = gIris; slots[2] = gIris + gPupil
          const shade = alpha < alphaIris ? 0.7 + 0.5 * (1 - alpha / alphaIris) : 1
          vertex(eyesPiece, world(add(eye.center, mul(dir, re * bulge))), rotate(H, dir), [s / segments, r / rings], shade, [[eyeBones[i], 1]], normalizeEye(slots))
        }
      }
      for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
        const a = start + r * segments + s, b = start + r * segments + (s + 1) % segments, d = a + segments, e = b + segments
        eyesPiece.indices.push(a, b, d, b, e, d)
      }
      const lidStart = lids.positions.length / 3, lidRows = [6, 4, 3][level]
      for (let r = 0; r <= lidRows + 1; r++) {
        const theta = r <= lidRows ? (r / lidRows) * lidOpen : lidOpen + 0.03, radius = r <= lidRows ? 1.06 : 0.98
        for (let s = 0; s < segments; s++) {
          const phi = (s / segments) * Math.PI * 2, dir = norm(add(mul(up, Math.cos(theta)), add(mul(f, Math.sin(theta) * Math.cos(phi)), mul(right, Math.sin(theta) * Math.sin(phi)))))
          const slots = singleSlot(headSlot)
          if (theta > lidOpen - 0.12) slots[lashSlot] = -0.001
          vertex(lids, world(add(eye.center, mul(dir, re * radius))), rotate(H, dir), [s / segments, r / lidRows], 1, [[lidBones[i], 1]], slots)
        }
      }
      grid(lids, lidStart, lidRows + 2, segments, true, true)
      const lowStart = lids.positions.length / 3, lowRows = [4, 3, 2][level], lowOpen = 1.2
      for (let r = 0; r <= lowRows + 1; r++) {
        const theta = r <= lowRows ? (r / lowRows) * lowOpen : lowOpen + 0.03, radius = r <= lowRows ? 1.05 : 0.98
        for (let s = 0; s < segments; s++) {
          const phi = (s / segments) * Math.PI * 2, dir = norm(add(mul(up, -Math.cos(theta)), add(mul(f, Math.sin(theta) * Math.cos(phi)), mul(right, Math.sin(theta) * Math.sin(phi)))))
          const slots = singleSlot(headSlot)
          if (theta > lowOpen - 0.07) slots[lashSlot] = -0.001
          vertex(lids, world(add(eye.center, mul(dir, re * radius))), rotate(H, dir), [s / segments, r / lowRows], 1, [[headBone, 1]], slots)
        }
      }
      grid(lids, lowStart, lowRows + 2, segments, true)
    })
    // Brows: three tapered strands per side lying on the brow ridge.
    browCenters.forEach((_, i) => {
      const side = i === 0 ? 1 : -1, angry = !!ctx.byId.get(`brow${side > 0 ? 'L' : 'R'}`)?.rotation && Math.abs(ctx.byId.get(`brow${side > 0 ? 'L' : 'R'}`)!.rotation![2]) > 10
      for (let k = 0; k < (level === 2 ? 1 : 3); k++) {
        const pts: V3[] = [], n = 6
        for (let j = 0; j <= n; j++) {
          const t = j / n, x = side * (0.016 + 0.052 * t) * hs, y = eyeY + (0.033 + 0.012 * Math.sin(Math.PI * t * 0.9) - 0.006 * t + (k - 1) * 0.0035 - (angry ? 0.014 * (1 - t) : 0)) * hs
          pts.push(add(surface(x, y), [0, 0, 0.0018 * hs]))
        }
        ribbon(brows, pts.map(world), pts.map((_, j) => (0.0105 - 0.005 * j / n) * hs * (k === 1 ? 1 : 0.7)), pts.map((p) => rotate(H, norm(sub(p, c)))), [[browBones[i], 1]], singleSlot(1), 0.9 + 0.1 * k)
      }
    })
    const pieces = [eyesPiece, lids, brows]
    pieces.push(...hairPieces(ctx, level, fields[0], { H, c, R, hs, style, inHair, seed, headBone, mouthY, eyeY, surface, beardPart, beardLong, world, local }, h))
    if (ctx.plan.tusks) {
      const tusks = emptyPiece('presas', MATERIAL_BODY)
      for (const id of ['tuskL', 'tuskR']) {
        const part = ctx.byId.get(id)
        if (!part) continue
        const m = ctx.bind.get(id)!, [w, h, d] = part.dimensions, sides = [8, 6, 4][level], path: V3[] = [], radii: [number, number][] = []
        for (let j = 0; j <= 3; j++) { const t = j / 3; path.push(apply(m, [0, (t - 0.5) * h, 0])); radii.push([w / 2 * (1 - t * 0.85), d / 2 * (1 - t * 0.85)]) }
        tube(tusks, path, radii, rotate(m, [0, 0, 1]), sides, () => [[jaw, 1]], () => singleSlot(ivorySlot))
      }
      pieces.push(tusks)
    }
    return pieces
  })
}
const cos0 = (alpha: number) => alpha < Math.PI / 2
function normalizeEye(slots: number[]): number[] {
  const min = Math.min(...slots)
  return slots.map((s) => Math.min(0.05, s - min))
}

/** Flat strand (three vertices across) along `path`, lying on the surface whose outward normals are `normals`. */
function ribbon(piece: Piece, path: V3[], widths: number[], normals: V3[], weights: [number, number][] | ((i: number) => [number, number][]), slots: number[], color: number, thickness = 0.25) {
  const start = piece.positions.length / 3
  for (let i = 0; i < path.length; i++) {
    const t = norm(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)])), n = normals[i], b = norm(cross(t, n)), w = widths[i]
    const ws = typeof weights === 'function' ? weights(i) : weights, shade = color * (0.72 + 0.3 * i / (path.length - 1))
    vertex(piece, add(path[i], mul(b, -w / 2)), norm(add(n, mul(b, -0.6))), [0, i / (path.length - 1)], shade, ws, slots)
    vertex(piece, add(path[i], mul(n, w * thickness)), n, [0.5, i / (path.length - 1)], shade * 1.05, ws, slots)
    vertex(piece, add(path[i], mul(b, w / 2)), norm(add(n, mul(b, 0.6))), [1, i / (path.length - 1)], shade, ws, slots)
  }
  grid(piece, start, path.length, 3, false)
}

interface HairStyle { kind: 'none' | 'bald' | 'short' | 'quiff' | 'long' | 'bun' | 'ponytail' | 'topknot' | 'braids' | 'mohawk'; hat: number | null; receding: boolean }
function hairStyle(ctx: FeatureContext): HairStyle {
  const has = (id: string) => ctx.byId.has(id)
  const hatParts = ['hatBrim', 'hatCrown', 'hatCone', 'helm', 'helmet'].map((id) => ctx.byId.get(id)).filter((part): part is PrefabPart => !!part && part.parentId === 'j_head')
  const hat = hatParts.length ? Math.min(...hatParts.map((part) => part.position[1] - part.dimensions[1] / 2)) : null
  const receding = ctx.request.character?.age === 'elder'
  if (has('spike0') || ctx.byId.get('hairTuft')?.name === 'Moicano') return { kind: 'mohawk', hat, receding: false }
  if (has('topknot')) return { kind: 'topknot', hat, receding }
  if (has('hairTail')) return { kind: 'ponytail', hat, receding }
  if (has('braidL')) return { kind: 'braids', hat, receding }
  if (has('hairBun')) return { kind: 'bun', hat, receding }
  if (has('hairLong')) return { kind: 'long', hat, receding }
  if (has('hairTuft')) return { kind: 'quiff', hat, receding }
  if (has('hair')) return { kind: 'short', hat, receding }
  return { kind: 'bald', hat, receding }
}

interface HeadFrame {
  H: THREE.Matrix4; c: V3; R: V3; hs: number; style: HairStyle; inHair: (p: V3) => number; seed: number; headBone: number; mouthY: number; eyeY: number
  surface: (x: number, y: number, depth?: number) => V3; beardPart: PrefabPart | undefined; beardLong: boolean; world: (p: V3) => V3; local: (p: V3) => V3
}
const springChains = new WeakMap<FeatureContext, Map<string, number[]>>()
/** Spring chain hanging from the head bone at `anchor` (head-local), created once per context. */
function chain(ctx: FeatureContext, frame: HeadFrame, name: string, anchor: V3, length: number, count: number): number[] {
  const known = springChains.get(ctx) ?? new Map<string, number[]>()
  springChains.set(ctx, known)
  if (known.has(name)) return known.get(name)!
  const bones: number[] = []
  let parent = frame.headBone
  for (let i = 0; i < count; i++) {
    const index = ctx.internal(`${name}${i}`, parent, translation(i === 0 ? anchor : [0, -length / count, 0]))
    bones.push(index); parent = index
  }
  known.set(name, bones)
  ctx.springs.push({ bones, stiffness: 26, damping: 5, gravity: 1, limit: 0.7, wind: 0.5 })
  return bones
}
/** Weights along a vertical chain anchored at `anchor` (head-local y), blending into the head above it. */
function chainWeights(frame: HeadFrame, bones: number[], anchorY: number, length: number, p: V3): [number, number][] {
  const s = (anchorY - p[1]) / length * bones.length
  if (s <= 0) return [[frame.headBone, 1]]
  if (s < 0.5) return [[frame.headBone, 1 - s * 2], [bones[0], s * 2]]
  const u = Math.min(bones.length - 1, s - 0.5), i = Math.floor(u), f = u - i
  return i + 1 < bones.length ? [[bones[i], 1 - f], [bones[i + 1], f]] : [[bones[bones.length - 1], 1]]
}

/** Hair clumps, beard and moustache as strands that hug the scalp/jaw; long styles hang on spring chains. */
function hairPieces(ctx: FeatureContext, level: number, field: Field, frame: HeadFrame, h: number): Piece[] {
  const { c, R, hs, style, seed, world, local } = frame, hair = emptyPiece('cabelo', MATERIAL_HAIR), rnd = (k: number) => hashNoise(seed, k, 9157)
  const scalp = (dir: V3, off: number): V3 => { const d = norm(dir); return [c[0] + d[0] * R[0] * (1 + off), c[1] + d[1] * R[1] * (1 + off), c[2] + d[2] * R[2] * (1 + off)] }
  const outward = (p: V3): V3 => norm([(p[0] - c[0]) / (R[0] * R[0]), (p[1] - c[1]) / (R[1] * R[1]), (p[2] - c[2]) / (R[2] * R[2])])
  const keepOut = (p: V3, gap: number): V3 => {
    let q = p
    for (let i = 0; i < 6; i++) { const w = world(q), v = field.value(...w); if (v > gap) break; const n = normalAt(field, w, gap * 0.3); q = local(add(w, mul(n, gap - v + 0.002))) }
    return q
  }
  const strands: { path: V3[]; width: number; weights: (p: V3) => [number, number][]; slot: number; shade: number; taper: number }[] = []
  const add3 = (_piece: Piece, path: V3[], width: number, weights: (p: V3) => [number, number][], slot: number, shade: number, taper = 0.85) => { strands.push({ path, width, weights, slot, shade, taper }) }
  if (style.kind !== 'bald' && style.kind !== 'none') {
    const count = [130, 70, 32][level], steps = [6, 4, 3][level], back: V3 = [c[0], c[1] - 1.3 * R[1], c[2] - 1.2 * R[2]], over: V3 = [c[0], c[1] + 1.5 * R[1], c[2] - 1.3 * R[2]]
    const long = style.kind === 'long', tie: V3 | null = style.kind === 'ponytail' ? scalp([0, 0.15, -1], 0.08) : style.kind === 'topknot' || style.kind === 'bun' ? scalp([0, 0.75, -0.66], 0.06) : null
    const hang = long ? 0.36 * hs * 1.6 : 0, napeY = c[1] - 0.35 * R[1]
    const longChain = long ? chain(ctx, frame, 'hair', [c[0], napeY, c[2] - R[2] * 0.85], hang, 3) : null
    for (let n = 0; n < count * 2.4; n++) {
      const y = 1 - (n + 0.5) / (count * 2.4) * 2, ring = Math.sqrt(1 - y * y), a = n * 2.399963 + rnd(n) * 0.3
      const dir: V3 = [ring * Math.sin(a), y, ring * Math.cos(a)], root = scalp(dir, 0.01)
      if (frame.inHair(root) < 0.02) continue
      const path: V3[] = [root]
      let p = root, length = style.kind === 'mohawk' ? 0.07 * hs : long ? 0.14 * hs : style.kind === 'quiff' && dir[2] > 0.3 ? 0.1 * hs : 0.075 * hs
      if (tie) length = Math.max(0.03 * hs, len(sub(tie, root)))
      length *= 0.85 + rnd(n + 7) * 0.3
      for (let s = 1; s <= steps; s++) {
        const here = outward(p)
        let flow: V3
        if (style.kind === 'mohawk') flow = add(mul(here, 1.6), [0, 0, -0.6])
        else if (tie) flow = sub(tie, p)
        else flow = add(sub(p[2] > c[2] - 0.15 * R[2] && p[1] > c[1] - 0.2 * R[1] ? over : back, p), [Math.sign(dir[0] || 1) * Math.max(0, dir[2]) * 0.04 * hs, 0, 0])
        if (style.kind === 'quiff' && dir[2] > 0.3) flow = add(flow, mul(here, 0.8 * (1 - s / steps)))
        const tangent = style.kind === 'mohawk' ? norm(flow) : norm(sub(flow, mul(here, dot(flow, here))))
        p = add(p, mul(tangent, length / steps))
        if (style.kind !== 'mohawk') p = scalp(sub(p, c), 0.03 + 0.05 * s / steps + rnd(n + 3) * 0.03)
        path.push(p)
      }
      if (long && p[1] < c[1] + 0.1 * R[1] && p[2] < c[2] - 0.25 * R[2]) {
        const drop = hang * (0.7 + rnd(n + 11) * 0.3), extra = [3, 2, 1][level]
        for (let s = 1; s <= extra; s++) { p = keepOut(add(p, [0, -drop / extra, -0.012 * hs]), 0.012 * hs); path.push(p) }
      }
      const width = (style.kind === 'mohawk' ? 0.03 : 0.042) * hs * (0.8 + rnd(n + 5) * 0.4)
      add3(hair, path, width, (q) => longChain ? chainWeights(frame, longChain, napeY, hang, q) : [[frame.headBone, 1]], 0, 0.88 + rnd(n + 9) * 0.24)
    }
    if (style.kind === 'ponytail' || style.kind === 'topknot' || style.kind === 'braids' || style.kind === 'bun') {
      const anchors: V3[] = style.kind === 'braids' ? [scalp([0.75, -0.25, -0.6], 0.06), scalp([-0.75, -0.25, -0.6], 0.06)] : [tie!]
      anchors.forEach((anchor, k) => {
        if (style.kind === 'bun') {
          for (let n = 0; n < [14, 9, 5][level]; n++) {
            const a = n / 3 * Math.PI * 0.66, path: V3[] = []
            for (let s = 0; s <= 6; s++) { const t = a + s * 0.9, r = 0.045 * hs * (1 - s / 14); path.push(add(anchor, add(mul(outward(anchor), 0.03 * hs + Math.sin(t * 0.5 + n) * 0.012 * hs), [Math.cos(t) * r, Math.sin(t) * r * 0.8, -Math.sin(t) * r * 0.4]))) }
            add3(hair, path, 0.03 * hs, () => [[frame.headBone, 1]], 0, 0.95, 0.5)
          }
          return
        }
        const length = (style.kind === 'topknot' ? 0.2 : 0.3) * hs * 1.5, bones = chain(ctx, frame, `tail${k}`, anchor, length, 3)
        const strands = style.kind === 'braids' ? [10, 8, 6][level] : [12, 8, 4][level]
        for (let n = 0; n < strands; n++) {
          const path: V3[] = [], twist = n / strands * Math.PI * 2, steps = [8, 6, 4][level]
          for (let s = 0; s <= steps; s++) {
            const t = s / steps, r = (style.kind === 'braids' ? 0.016 : 0.022) * hs * (1 - t * 0.6) * (style.kind === 'braids' ? 0.8 + 0.4 * Math.abs(Math.sin(t * 14 + twist)) : 1)
            const base = style.kind === 'topknot' ? add(anchor, [0, t * length * 0.25, -t * length * 0.5]) : add(anchor, [0, -t * length, -0.03 * hs * Math.sin(t * Math.PI)])
            path.push(keepOut(add(base, [Math.cos(twist + t * (style.kind === 'braids' ? 9 : 1)) * r, 0, Math.sin(twist + t * (style.kind === 'braids' ? 9 : 1)) * r]), 0.008 * hs))
          }
          add3(hair, path, 0.026 * hs, (q) => chainWeights(frame, bones, anchor[1], length, style.kind === 'topknot' ? [q[0], anchor[1] - len(sub(q, anchor)), q[2]] : q), 0, 0.9 + rnd(n + 40) * 0.2, 0.7)
        }
      })
    }
  }
  if (frame.beardPart) {
    const beard = frame.beardLong, rows = [7, 5, 3][level], columns = [13, 9, 5][level], jawBone = ctx.face!.jaw
    for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
      const u = (j / (columns - 1)) * 2 - 1, v = i / (rows - 1), x = u * 0.085 * hs, yTop = frame.mouthY - 0.016 * hs + Math.abs(u) ** 1.5 * 0.07 * hs
      const y = yTop - v * (frame.mouthY - 0.016 * hs - (c[1] - R[1] * 0.98)) * (1 - Math.abs(u) * 0.35)
      if (Math.abs(x) > R[0] * 0.95) continue
      const root = frame.surface(x * (1 - v * 0.2), y, -0.002 * hs), path: V3[] = [root], length = (beard ? 0.26 : 0.045) * hs * (0.8 + rnd(i * 31 + j) * 0.4) * (beard ? 1 - Math.abs(u) * 0.4 : 1), steps = beard ? [6, 4, 3][level] : 3
      let p = root
      for (let s = 1; s <= steps; s++) { p = keepOut(add(p, [-u * 0.004 * hs, -length / steps, (beard ? 0.012 : 0.008) * hs * (1 - s / steps)]), 0.006 * hs); path.push(p) }
      add3(hair, path, 0.028 * hs, (q) => [[jawBone, q[1] < frame.mouthY - 0.02 * hs ? 1 : 0.6], [frame.headBone, q[1] < frame.mouthY - 0.02 * hs ? 0 : 0.4]], 2, 0.9 + rnd(i * 17 + j) * 0.2, 0.75)
    }
    if (ctx.byId.has('moustache')) for (const side of [1, -1]) for (let k = 0; k < [3, 2, 1][level]; k++) {
      const path: V3[] = []
      for (let s = 0; s <= 4; s++) { const t = s / 4; path.push(frame.surface(side * (0.004 + 0.03 * t) * hs, frame.mouthY + (0.016 - 0.012 * t - (beard ? 0.012 * t * t : 0) + k * 0.002) * hs, -0.004 * hs)) }
      add3(hair, path, 0.017 * hs, () => [[frame.headBone, 1]], 2, 0.95, 0.6)
    }
  }
  return strands.length ? [sculptedHair(ctx, frame, strands, h, level, outward)] : []
}

/** Four fingers and a thumb per hand built from the palm frame; curled into a fist when the hand holds something. */
function hands(ctx: FeatureContext, builders: Builder[]) {
  const holding = new Set(ctx.parts.filter((part) => part.kind === 'group' && !part.id.startsWith('j_') && part.parentId?.startsWith('j_elbow')).map((part) => part.parentId!.slice(-1)))
  for (const s of ['L', 'R']) {
    const palm = ctx.byId.get(`palm${s}`)
    if (palm) ctx.refineRegions.push({ body: 0, levels: 1, center: apply(ctx.bind.get(`palm${s}`)!, [0, 0, 0]), radius: Math.max(...palm.dimensions) * 0.75 })
  }
  builders.push((level) => {
    if (level >= 2) return []
    const piece = emptyPiece('dedos', MATERIAL_BODY)
    for (const s of ['L', 'R']) {
      const palm = ctx.byId.get(`palm${s}`), fingers = ctx.byId.get(`fingers${s}`), thumb = ctx.byId.get(`thumb${s}`)
      if (!palm) continue
      const side = s === 'L' ? 1 : -1, m = ctx.bind.get(`palm${s}`)!, bone = ctx.skinParts.find((part) => part.id === `palm${s}`)?.bone ?? 0
      const [w, h, d] = palm.dimensions, slot = ctx.skinParts.find((part) => part.id === `palm${s}`)?.slot ?? 0
      const gloved = (palm.material?.metalness ?? 0) > 0.3 || palm.material?.texture === 'fabric', nail = gloved ? slot : ctx.slots.add({ ...slotOf(palm.material), color: hexMix(palm.material?.color ?? '#e3b08c', '#ffe8e0', 0.35), roughness: 0.3, clearcoat: 0.5 })
      const fist = holding.has(s), curl = fist ? [1.15, 1.45, 0.95] : [0.22, 0.32, 0.22], L = (fingers?.dimensions[1] ?? h * 0.85) * 1.05, sides = level ? 5 : 7
      const palmSide: V3 = [-side, 0, 0]
      ;[[0.29, 0.93, 1, 0.07], [0.1, 1, 1.04, 0.02], [-0.1, 0.95, 0.98, -0.03], [-0.29, 0.77, 0.86, -0.09]].forEach(([z, length, girth, spread]) => {
        const r = d * 0.105 * girth, path: V3[] = [[side * w * 0.05, -h * 0.3, z * d * 0.92]]
        let direction: V3 = norm([0, -1, spread]), angle = 0
        path.push(add(path[0], mul(direction, h * 0.14)))
        for (let j = 0; j < 3; j++) {
          angle += curl[j]
          direction = norm(add(mul([0, -1, spread], Math.cos(angle)), mul(palmSide, Math.sin(angle))))
          const segment = L * length * [0.45, 0.32, 0.23][j], from = path[path.length - 1]
          path.push(add(from, mul(direction, segment / 2)), add(from, mul(direction, segment)))
        }
        const radii = path.map((_, i): [number, number] => { const t = Math.max(0, i - 1) / (path.length - 2); return [r * (1 - 0.22 * t) * 0.9, r * (1 - 0.22 * t)] })
        tube(piece, path.map((p) => apply(m, p)), radii, rotate(m, [0, 0, 1]), sides, () => [[bone, 1]], (i, around) => {
          const slots = singleSlot(slot)
          if (!gloved && i >= path.length - 2) { const back = dot(around, rotate(m, [side, 0, 0])); slots[nail] = Math.min(slots[nail], (0.45 - back) * r) }
          return slots
        })
      })
      if (thumb) {
        const t = ctx.bind.get(`thumb${s}`)!, [tw, tl] = thumb.dimensions, path: V3[] = []
        for (let j = 0; j <= 4; j++) { const k = j / 4; path.push(apply(t, [-side * Math.sin(k * (fist ? 1 : 0.4)) * tl * 0.25, (k - 0.55) * tl * 1.1, 0])) }
        tube(piece, path, path.map((_, j): [number, number] => [tw * 0.42 * (1 - j * 0.04), tw * 0.46 * (1 - j * 0.04)]), rotate(t, [0, 0, 1]), sides, () => [[bone, 1]], (i, around) => {
          const slots = singleSlot(slot)
          if (!gloved && i >= path.length - 2) { const back = dot(around, rotate(t, [0, 0, 1])); slots[nail] = Math.min(slots[nail], (0.4 - back) * tw) }
          return slots
        })
      }
    }
    return [piece]
  })
}

/** Skirt, tunic hem or robe as an open lathe shell that follows the hips and opens with the thighs. */
function shell(ctx: FeatureContext, builders: Builder[]) {
  const plan = ctx.plan.shell!, hips = ctx.boneIndex.get('j_hips'), left = ctx.boneIndex.get('j_hipL'), right = ctx.boneIndex.get('j_hipR')
  if (hips === undefined || left === undefined || right === undefined) return
  const ids = [plan.part, ...(plan.trim ? [plan.trim] : [])].filter((id) => ctx.byId.has(id))
  const hipsInverse = ctx.bind.get('j_hips')!.clone().invert(), pull = plan.long ? 0.62 : 0.8
  builders.push((level) => {
    const piece = emptyPiece('saia', MATERIAL_SHELL)
    for (const id of ids) {
      const part = ctx.byId.get(id)!, m = ctx.bind.get(id)!, profile = (part.geometry?.profile as [number, number][] | undefined) ?? [[1, 0], [1, 1]], [w, h, d] = part.dimensions
      const rmax = Math.max(...profile.map((p) => p[0])), t0 = Math.min(...profile.map((p) => p[1])), t1 = Math.max(...profile.map((p) => p[1])), slot = ctx.slots.add(slotOf(part.material))
      const segments = [32, 22, 14][level], split = [3, 2, 1][level], points: [number, number][] = []
      for (let i = 0; i < profile.length - 1; i++) for (let k = 0; k < split; k++) { const t = k / split; points.push([profile[i][0] + (profile[i + 1][0] - profile[i][0]) * t, profile[i][1] + (profile[i + 1][1] - profile[i][1]) * t]) }
      points.push(profile[profile.length - 1])
      const start = piece.positions.length / 3, top = Math.max(...points.map((p) => p[1])), bottom = Math.min(...points.map((p) => p[1]))
      for (const [r, t] of points) for (let s = 0; s < segments; s++) {
        const phi = (s / segments) * Math.PI * 2, wave = 1 + 0.035 * Math.sin(phi * 7 + ctx.request.seed) * ((top - t) / ((top - bottom) || 1))
        const p = apply(m, [Math.sin(phi) * r / rmax * w / 2 * wave, ((t - t0) / ((t1 - t0) || 1) - 0.5) * h, Math.cos(phi) * r / rmax * d / 2 * wave]), q = apply(hipsInverse, p)
        const depth = smooth(0.05, 1, (top - t) / ((top - bottom) || 1)) * (id === plan.trim ? 1 : 1), side = Math.min(1, Math.max(0, 0.5 + q[0] / (w * 0.6)))
        const wh = 1 - pull * depth
        vertex(piece, p, rotate(m, norm([Math.sin(phi), 0, Math.cos(phi)])), [s / segments, t], 0.92 + 0.08 * Math.cos(phi * 3), [[hips, wh], [left, (1 - wh) * side], [right, (1 - wh) * (1 - side)]], singleSlot(slot))
      }
      grid(piece, start, points.length, segments, true)
    }
    return [piece]
  })
}

/** Cape strip on a four-bone spring chain hanging from the spine. */
function cape(ctx: FeatureContext, builders: Builder[]) {
  const id = ctx.plan.cape!, part = ctx.byId.get(id), spine = ctx.boneIndex.get('j_spine')
  if (!part || spine === undefined) return
  const m = ctx.bind.get(id)!, [w, h] = part.dimensions, slot = ctx.slots.add(slotOf(part.material)), count = 4
  const top = m.clone().multiply(translation([0, h * 0.5, 0])), spineInverse = ctx.bind.get('j_spine')!.clone().invert(), bones: number[] = []
  let parent = spine
  for (let i = 0; i < count; i++) { const local = i === 0 ? spineInverse.clone().multiply(top) : translation([0, -h / count, 0]); parent = ctx.internal(`cape${i}`, parent, local); bones.push(parent) }
  ctx.springs.push({ bones, stiffness: 14, damping: 3.5, gravity: 1, limit: 1, wind: 1 })
  builders.push((level) => {
    const piece = emptyPiece('capa', MATERIAL_SHELL), columns = [11, 7, 5][level], rows = [13, 8, 5][level], start = piece.positions.length / 3
    for (let r = 0; r < rows; r++) for (let k = 0; k < columns; k++) {
      const s = r / (rows - 1), u = k / (columns - 1) * 2 - 1, half = (0.32 + 0.18 * s) * w, x = u * half, y = (0.5 - s * 0.97) * h
      const z = 0.075 * w * u * u * (1 - s * 0.5) + 0.015 * w * Math.sin(u * 6 + s * 3)
      const position = s * count, i = Math.min(count - 1, Math.floor(position)), f = position - i
      const weights: [number, number][] = s < 0.03 ? [[spine, 1]] : i + 1 < count ? [[bones[i], 1 - f], [bones[i + 1], f]] : [[bones[count - 1], 1]]
      vertex(piece, apply(m, [x, y, z]), rotate(m, norm([-u * 0.3, 0, -1])), [k / (columns - 1), s], 0.9 + 0.1 * Math.cos(u * 3), weights, singleSlot(slot))
    }
    grid(piece, start, rows, columns, false)
    return [piece]
  })
}

/** Dark mouth interior on the facing surfaces of a separate jaw body and the skull above it. */
function mouthInterior(ctx: FeatureContext, decorators: Decorator[]) {
  const jawParts = ctx.skinParts.filter((part) => part.body === 1)
  if (!jawParts.length) return
  const jawBone = jawParts[0].bone, headBone = ctx.bones[jawBone].parent, mouthSlot = ctx.slots.add({ color: '#4a1a1c', roughness: 0.45, metalness: 0, sheen: 0, clearcoat: 0.4, emissive: '#000000', emissiveIntensity: 0, pattern: PATTERN.plain })
  const up = rotate(ctx.bones[jawBone].bind, [0, 1, 0]), center: V3 = [jawParts[0].prim.cx, jawParts[0].prim.cy, jawParts[0].prim.cz], radius = jawParts[0].prim.radius
  decorators.push((piece, _level, _field, body) => {
    const count = piece.positions.length / 3
    for (let v = 0; v < count; v++) {
      const p: V3 = [piece.positions[v * 3], piece.positions[v * 3 + 1], piece.positions[v * 3 + 2]], n: V3 = [piece.normals[v * 3], piece.normals[v * 3 + 1], piece.normals[v * 3 + 2]]
      if (body === 1) overrideSlot(piece, v, mouthSlot, (0.45 - dot(n, up)) * 0.02 * ctx.unitScale)
      else if (len(sub(p, center)) < radius * 1.05 && piece.bones.slice(v * 4, v * 4 + 4).includes(headBone)) overrideSlot(piece, v, mouthSlot, (0.55 + dot(n, up)) * 0.02 * ctx.unitScale)
    }
  })
}

/**
 * Hair mass sculpted from the strand paths: each strand is a chain of flattened ellipsoids blended into its neighbours,
 * polygonized as a closed surface. Weights, colour and strand coordinates come from the nearest strand segment.
 */
function sculptedHair(ctx: FeatureContext, frame: HeadFrame, strands: { path: V3[]; width: number; weights: (p: V3) => [number, number][]; slot: number; shade: number; taper: number }[], h: number, level: number, outward: (p: V3) => V3): Piece {
  const { hs, c, R, world } = frame, ops: FieldOp[] = [], tags = new Map<object, { strand: number; i: number; a: V3; b: V3 }>()
  strands.forEach((strand, index) => {
    const { path } = strand
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], t = norm(sub(b, a)), mid = mul(add(a, b), 0.5), hanging = mid[1] < c[1] - 0.55 * R[1]
      let n = hanging ? norm([mid[0] - c[0], 0, mid[2] - c[2]]) : outward(mid)
      n = norm(sub(n, mul(t, dot(n, t))))
      const bx = norm(cross(t, n)), s = (i + 0.5) / (path.length - 1), w = strand.width * 0.5 * (1 - strand.taper * s ** 1.6) + strand.width * 0.05
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...bx), new THREE.Vector3(...t), new THREE.Vector3(...n)).setPosition(...mid)
      const prim = ellipsoidPrim(frame.H.clone().multiply(m).elements, [w, len(sub(b, a)) * 0.62 + w * 0.25, w * 0.42])
      ops.push({ prim, op: OP_UNION, k: 0.006 * hs, offset: 0 })
      tags.set(prim, { strand: index, i, a: world(a), b: world(b) })
    }
  })
  const hh = h * [0.4, 0.5, 0.62][level], field = createField(ops, hh * 5), e = hh * 0.08
  const mesh = surfaceNets(field, hh)
  project(field, mesh.positions, 0, e, hh * 0.75, 2)
  relax(mesh, field, 1, e, hh * 0.75)
  const piece = emptyPiece('cabelo', MATERIAL_HAIR)
  piece.positions = mesh.positions; piece.indices = mesh.indices; piece.normals = Array.from(fieldNormals(field, mesh.positions, e))
  const count = mesh.positions.length / 3
  for (let v = 0; v < count; v++) {
    const p: V3 = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]
    let best: { strand: number; i: number; a: V3; b: V3 } | null = null, bestD = Infinity, bestT = 0
    for (const op of field.reach(...p)) {
      const tag = tags.get(op.prim)
      if (!tag) continue
      const ab = sub(tag.b, tag.a), t = Math.max(0, Math.min(1, dot(sub(p, tag.a), ab) / (dot(ab, ab) || 1))), d = len(sub(p, add(tag.a, mul(ab, t))))
      if (d < bestD) { bestD = d; best = tag; bestT = t }
    }
    const strand = best ? strands[best.strand] : strands[0], i = best?.i ?? 0, along = (i + bestT) / Math.max(1, strand.path.length - 1)
    const q = best ? mix(strand.path[i], strand.path[Math.min(strand.path.length - 1, i + 1)], bestT) : strand.path[0]
    const w = strand.weights(q).filter(([, x]) => x > 1e-4).sort((x, y) => y[1] - x[1]).slice(0, 4), total = w.reduce((sum, [, x]) => sum + x, 0) || 1
    for (let k = 0; k < 4; k++) { piece.bones.push(w[k]?.[0] ?? 0); piece.weights.push(w[k] ? w[k][1] / total : 0) }
    piece.slots.push(...singleSlot(strand.slot))
    const shade = strand.shade * (0.78 + 0.28 * along)
    piece.colors.push(shade, shade, shade)
    piece.uvs.push(((best?.strand ?? 0) * 0.6180339) % 1, along)
  }
  void ctx
  return piece
}
