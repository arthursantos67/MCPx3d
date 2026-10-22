import * as THREE from 'three'

import type { PrefabPart } from './scenePrefabs.ts'
import type { QualityLevel } from './sceneRuntimeTypes.ts'
import type { CharacterSpec } from './sceneCharacterArchetype.ts'
import { createField, fieldNormals, OP_CLAMP, OP_SUBTRACT, OP_UNION, primDistance, primFrom, refine, relax, project, surfaceNets, type Field, type FieldOp, type Prim, type RawMesh } from './sceneSkinGeometry.ts'
import { emptyPiece, MATERIAL_BODY, normalizeSlots, pushWeights, slotOf, smoothWeights, SlotTable, type Piece, type SlotMaterial } from './sceneSkinMesh.ts'
import { skinPlan, type SkinPlan } from './sceneSkinPlan.ts'
import { buildFeatures, type FeatureContext } from './sceneSkinFeatures.ts'

type V3 = [number, number, number]
/** A bone of the generated skeleton. Joint bones are attached (identity) to the holder of `joint`; internal bones hang from `parent` with `local`. */
export interface SkinBone { name: string; joint: string | null; parent: number; local: THREE.Matrix4; bind: THREE.Matrix4 }
export interface SkinLod {
  positions: Float32Array; normals: Float32Array; uvs: Float32Array; colors: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array
  slotA: Float32Array; slotB: Float32Array; indices: Uint32Array; groups: { start: number; count: number; material: number }[]
  /** Triangles of the continuous body surface (one closed component per entry of `bodyComponents`). */
  bodyTriangles: number; components: { name: string; start: number; count: number }[]
}
export interface FaceRig { jaw: number; eyes: [number, number]; lids: [number, number]; brows: [number, number]; corners: [number, number]; scale: number; lidClosed: number }
export interface SpringPlan { bones: number[]; stiffness: number; damping: number; gravity: number; limit: number; wind: number }
export interface SkinModel {
  bones: SkinBone[]; lods: SkinLod[]; slots: SlotMaterial[]; eyeSlots: SlotMaterial[]; hairSlots: SlotMaterial[]
  hidden: string[]; springs: SpringPlan[]; face: FaceRig | null; height: number; milliseconds: number
}
export interface SkinRequest { type: string; parts: PrefabPart[]; quality: QualityLevel; seed: number; overrides?: Map<string, { position: V3; quaternion: [number, number, number, number] }>; avatar?: string; character?: CharacterSpec }

const RAD = Math.PI / 180
/** Root-local matrices of every part, optionally with bind-pose tweaks for joints. */
export function partMatrices(parts: PrefabPart[], overrides?: SkinRequest['overrides'], tweak?: (id: string) => THREE.Matrix4 | null): Map<string, THREE.Matrix4> {
  const byId = new Map(parts.map((part) => [part.id, part])), out = new Map<string, THREE.Matrix4>()
  const resolve = (id: string): THREE.Matrix4 => {
    const known = out.get(id)
    if (known) return known
    const part = byId.get(id)!, override = overrides?.get(id)
    const local = override ? new THREE.Matrix4().compose(new THREE.Vector3(...override.position), new THREE.Quaternion(...override.quaternion), new THREE.Vector3(1, 1, 1))
      : new THREE.Matrix4().compose(new THREE.Vector3(...part.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]).map((v) => v * RAD) as V3)), new THREE.Vector3(1, 1, 1))
    const extra = tweak?.(id)
    if (extra) local.multiply(extra)
    const world = part.parentId ? resolve(part.parentId).clone().multiply(local) : local
    out.set(id, world)
    return world
  }
  for (const part of parts) resolve(part.id)
  return out
}


export interface SkinPart { id: string; prim: Prim; bone: number; slot: number; body: number; inset: number }
interface BodyBuild { field: Field; parts: SkinPart[] }

const SMOOTH: Record<string, number> = { torso: 0.035, pelvis: 0.04, neck: 0.03, head: 0.03, deltoid: 0.035, upperArm: 0.025, forearm: 0.022, palm: 0.018, thigh: 0.04, shin: 0.03, foot: 0.025, sole: 0.012 }
const smoothOf = (id: string, plan: SkinPlan) => plan.blend[id] ?? SMOOTH[id.replace(/(L|R|F[LR]|B[LR]|\d+)$/, '')] ?? plan.defaultBlend

/** Root-to-bind transform pipeline: builds the skeleton, the bodies' fields and every LOD. Pure and deterministic. */
export function buildSkinModel(request: SkinRequest): SkinModel | null {
  const started = performance.now(), plan = skinPlan(request)
  if (!plan) return null
  const parts = request.parts, byId = new Map(parts.map((part) => [part.id, part]))
  const tweak = (id: string) => plan.bindTweak[id] ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...plan.bindTweak[id].map((v) => v * RAD) as V3)) : null
  const bind = partMatrices(parts, request.overrides, tweak)
  const joints = parts.filter((part) => part.kind === 'group' && part.id.startsWith('j_'))
  const bones: SkinBone[] = [], boneIndex = new Map<string, number>()
  for (const joint of joints) {
    let parent = joint.parentId
    while (parent && !boneIndex.has(parent)) parent = byId.get(parent)?.parentId ?? null
    boneIndex.set(joint.id, bones.length)
    bones.push({ name: joint.id, joint: joint.id, parent: parent ? boneIndex.get(parent)! : -1, local: new THREE.Matrix4(), bind: bind.get(joint.id)!.clone() })
  }
  const boneOf = (id: string): number => { for (let p: string | null = id; p; p = byId.get(p)?.parentId ?? null) if (boneIndex.has(p)) return boneIndex.get(p)!; return 0 }
  const internal = (name: string, parent: number, local: THREE.Matrix4) => { bones.push({ name, joint: null, parent, local, bind: bones[parent].bind.clone().multiply(local) }); return bones.length - 1 }
  const slots = new SlotTable()
  const skinParts: SkinPart[] = []
  for (const id of plan.skin) {
    const part = byId.get(id)
    if (!part || part.kind === 'group' || part.kind === 'light') continue
    const kind = part.kind === 'sphere' ? 'sphere' : part.kind === 'capsule' ? 'capsule' : part.kind === 'lathe' ? 'lathe' : part.kind === 'cylinder' ? 'cylinder' : part.kind === 'cone' ? 'cone' : part.kind === 'box' || part.kind === 'roundedBox' ? 'box' : null
    if (!kind) continue
    skinParts.push({ id, prim: primFrom({ kind, dimensions: part.dimensions, matrix: bind.get(id)!.elements, profile: part.geometry?.profile as [number, number][] | undefined }),
      bone: boneOf(id), slot: slots.add(plan.slotOverride[id] ?? slotOf(part.material)), body: plan.bodyOf(id), inset: plan.inset[id] ?? 0 })
  }
  const unitScale = plan.scale, cut = 0.14 * unitScale
  const ctx: FeatureContext = { request, plan, parts, byId, bind, bones, boneIndex, internal, slots, skinParts, unitScale, extraOps: [], face: null, springs: [], eyeSlots: [], hairSlots: [], refineRegions: [] }
  const features = buildFeatures(ctx)
  const inLevel = (id: string, level: number) => { const range = plan.levels[id]; return !range || (level >= range[0] && level <= range[1]) }
  const cache = new Map<string, BodyBuild>()
  const bodyAt = (body: number, level: number): BodyBuild => {
    const members = skinParts.filter((part) => part.body === body && inLevel(part.id, level)), key = `${body}:${members.map((part) => part.id).join(',')}`
    const known = cache.get(key)
    if (known) return known
    const ops: FieldOp[] = []
    for (const part of members) ops.push({ prim: part.prim, op: OP_UNION, k: smoothOf(part.id, plan) * unitScale, offset: part.inset })
    for (const extra of ctx.extraOps) if (extra.body === body && (extra.minLevel ?? 0) <= level && level <= (extra.maxLevel ?? 2)) ops.push(extra.op)
    if (body === 0) for (const id of plan.wrap) {
      const part = byId.get(id)
      if (!part || !bind.has(id)) continue
      const kind = part.kind === 'lathe' ? 'lathe' : part.kind === 'cylinder' ? 'cylinder' : null
      if (!kind) continue
      const m = bind.get(id)!, prim = primFrom({ kind, dimensions: part.dimensions, matrix: m.elements, profile: part.geometry?.profile as [number, number][] | undefined })
      const region = primFrom({ kind: 'cylinder', dimensions: [part.dimensions[0] * 1.9, part.dimensions[1], part.dimensions[2] * 1.9], matrix: m.elements })
      ops.push({ prim, op: OP_CLAMP, k: 0, offset: 0.004 * unitScale, region, regionFade: 0.012 * unitScale })
    }
    const sorted = [...ops.filter((op) => op.op === OP_UNION), ...ops.filter((op) => op.op === OP_SUBTRACT), ...ops.filter((op) => op.op === OP_CLAMP)]
    const built = { field: createField(sorted, cut), parts: members }
    cache.set(key, built)
    return built
  }
  const quality = request.quality === 'high' ? 1 : request.quality === 'medium' ? 1.25 : 1.6
  const lods: SkinLod[] = []
  for (let level = 0; level < 3; level++) {
    const h = plan.voxel * unitScale * quality * [1, 1.65, 2.7][level], bodies = Array.from({ length: plan.bodies }, (_, body) => bodyAt(body, level))
    const pieces: Piece[] = bodies.map((body, index) => bodyPiece(body, h, level, ctx, index))
    pieces.push(...features(level, bodies.map((body) => body.field), h))
    lods.push(assemble(pieces))
  }
  const height = Math.max(...[...bind.values()].map((m) => m.elements[13])) - Math.min(0, ...[...bind.values()].map((m) => m.elements[13]))
  return { bones, lods, slots: slots.slots, eyeSlots: ctx.eyeSlots, hairSlots: ctx.hairSlots, hidden: plan.hidden, springs: ctx.springs, face: ctx.face, height, milliseconds: performance.now() - started }
}

/** Polygonizes one body, refines the declared regions, relaxes and computes normals, weights and slots. */
function bodyPiece(body: BodyBuild, h: number, level: number, ctx: FeatureContext, index: number): Piece {
  const field = body.field, e = h * 0.08, limit = h * 0.75
  let mesh: RawMesh = surfaceNets(field, h)
  project(field, mesh.positions, 0, e, limit, 2)
  relax(mesh, field, 2, e, limit)
  for (const region of ctx.refineRegions) if (region.body === index && region.levels > level) {
    const [cx, cy, cz] = region.center, r2 = region.radius * region.radius
    mesh = refine(mesh, field, (x, y, z) => (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 < r2, e * 0.5, limit)
    if (region.levels - level > 1 && region.inner) {
      const [ix, iy, iz] = region.inner.center, i2 = region.inner.radius ** 2
      mesh = refine(mesh, field, (x, y, z) => (x - ix) ** 2 + (y - iy) ** 2 + (z - iz) ** 2 < i2, e * 0.25, limit)
    }
  }
  if (ctx.refineRegions.some((region) => region.body === index && region.levels > level)) relax(mesh, field, 1, e * 0.5, limit)
  const normals = fieldNormals(field, mesh.positions, e * 0.5)
  const piece = emptyPiece(index === 0 ? 'corpo' : `corpo ${index + 1}`, MATERIAL_BODY)
  piece.body = true
  piece.positions = mesh.positions
  piece.indices = mesh.indices
  piece.normals = Array.from(normals)
  const count = mesh.positions.length / 3, parts = body.parts, sigma = ctx.plan.weightBlend * ctx.unitScale
  const parentOf = ctx.bones.map((bone) => bone.parent)
  const adjacent = (a: number, b: number) => a === b || parentOf[a] === b || parentOf[b] === a
  const distances = new Float64Array(parts.length)
  for (let v = 0; v < count; v++) {
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2]
    let best = 0, bestD = Infinity
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].prim, far = Math.hypot(x - p.cx, y - p.cy, z - p.cz) - p.radius
      distances[i] = far > sigma * 3 ? far : primDistance(p, x, y, z) + parts[i].inset
      if (distances[i] < bestD) { bestD = distances[i]; best = i }
    }
    const owner = parts[best].bone, accum = new Map<number, number>(), slotMin = new Array(8).fill(Infinity)
    for (let i = 0; i < parts.length; i++) {
      const d = distances[i]
      if (d < slotMin[parts[i].slot]) slotMin[parts[i].slot] = d
      if (!adjacent(owner, parts[i].bone)) continue
      const w = Math.max(0, 1 - (d - bestD) / sigma) ** 2
      if (w > 0) accum.set(parts[i].bone, Math.max(accum.get(parts[i].bone) ?? 0, w))
    }
    pushWeights(piece, accum)
    for (let s = 0; s < 8; s++) piece.slots.push(slotMin[s])
    piece.colors.push(1, 1, 1)
    piece.uvs.push(Math.atan2(x, z) / (2 * Math.PI) + 0.5, y / Math.max(0.5, ctx.unitScale * 2))
  }
  smoothWeights(piece, mesh.indices, 2)
  ctx.decorateBody?.(piece, level, field, index)
  normalizeSlots(piece)
  return piece
}

function assemble(pieces: Piece[]): SkinLod {
  const order = [...pieces].filter((piece) => piece.indices.length).sort((a, b) => a.material - b.material)
  let vertices = 0, triangles = 0
  for (const piece of order) { vertices += piece.positions.length / 3; triangles += piece.indices.length / 3 }
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), uvs = new Float32Array(vertices * 2), colors = new Float32Array(vertices * 3)
  const skinIndex = new Uint16Array(vertices * 4), skinWeight = new Float32Array(vertices * 4), slotA = new Float32Array(vertices * 4), slotB = new Float32Array(vertices * 4), indices = new Uint32Array(triangles * 3)
  const groups: SkinLod['groups'] = [], components: SkinLod['components'] = []
  let v0 = 0, t0 = 0, bodyTriangles = 0
  for (const piece of order) {
    const n = piece.positions.length / 3
    positions.set(piece.positions, v0 * 3); normals.set(piece.normals, v0 * 3); uvs.set(piece.uvs, v0 * 2); colors.set(piece.colors, v0 * 3)
    skinIndex.set(piece.bones, v0 * 4); skinWeight.set(piece.weights, v0 * 4)
    for (let v = 0; v < n; v++) for (let s = 0; s < 4; s++) { slotA[(v0 + v) * 4 + s] = piece.slots[v * 8 + s]; slotB[(v0 + v) * 4 + s] = piece.slots[v * 8 + 4 + s] }
    for (let i = 0; i < piece.indices.length; i++) indices[t0 * 3 + i] = piece.indices[i] + v0
    const last = groups[groups.length - 1]
    if (last && last.material === piece.material) last.count += piece.indices.length
    else groups.push({ start: t0 * 3, count: piece.indices.length, material: piece.material })
    components.push({ name: piece.name, start: t0 * 3, count: piece.indices.length })
    if (piece.body) bodyTriangles += piece.indices.length / 3
    v0 += n; t0 += piece.indices.length / 3
  }
  return { positions, normals, uvs, colors, skinIndex, skinWeight, slotA, slotB, indices, groups, bodyTriangles, components }
}

