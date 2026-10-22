import * as THREE from 'three'
import { hasSurface, type SceneNode, type ThreeSceneDocument } from './sceneDocument.ts'
import { fractalNoise, terrainHeightAt } from './sceneGeometrySpec.ts'
import { sceneMatrices } from './scenePlacement.ts'
import { characterPrefabs } from './scenePrefabs.ts'

/**
 * Walkable relief and grass mask baked into RGBA8 textures (no float/integer formats, linear filtering).
 * Texel layout: R/G = 16-bit height inside `range`, B = grass density, A = ground coverage. `tint` is the sRGB ground colour.
 */
export interface GroundField {
  texture: THREE.DataTexture
  tint: THREE.DataTexture
  bounds: [number, number, number, number]
  range: [number, number]
  size: [number, number]
  /** Highest water surface found (planes with water texture), or null. */
  water: number | null
  heightAt(x: number, z: number): number
  grassAt(x: number, z: number): number
  coverAt(x: number, z: number): number
  tintAt(x: number, z: number): [number, number, number]
  dispose(): void
}

const MAX_RESOLUTION = 512
const GRASS_BIOMES: Record<string, number> = { meadow: 1, forest: 0.9, tropical: 0.9, swamp: 0.7, alpine: 0.8, alien: 0.6 }
const BIOME_COLORS: Record<string, [string, string, string]> = {
  meadow: ['#b5a477', '#5d7d42', '#8e9460'], alpine: ['#9b9873', '#58704b', '#7d8264'], forest: ['#6d6345', '#3f5a2e', '#5b6a3a'],
  tropical: ['#e2cf9c', '#4f8a3a', '#79a352'], swamp: ['#4b4a33', '#4f5b2f', '#5e6038'], alien: ['#4b3b6b', '#3f8c7d', '#7a5aa0'],
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const unitCorners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const

interface Surface { node: SceneNode; matrix: THREE.Matrix4; inverse: THREE.Matrix4; grass: number; color: THREE.Color; terrain: boolean; top: number }

const isWater = (node: SceneNode) => node.material.texture === 'water' && (node.kind === 'plane' || (node.kind === 'box' && node.dimensions[1] <= 0.3 && !node.parentId))
const isSlab = (node: SceneNode) => (node.kind === 'box' || node.kind === 'roundedBox') && !node.parentId && !node.asset && node.dimensions[0] * node.scale[0] >= 4 && node.dimensions[2] * node.scale[2] >= 4 && node.dimensions[1] * node.scale[1] <= 1.5
function grassWeight(node: SceneNode): number {
  if (node.material.textureImage) return 0
  const biome = node.kind === 'terrain' ? node.geometry.biome ?? 'none' : 'none'
  if (biome !== 'none') return ['none', 'grass', 'rock', 'sand', 'leaves'].includes(node.material.texture ?? 'none') ? GRASS_BIOMES[biome] ?? 0 : 0
  return node.material.texture === 'grass' ? 1 : 0
}

/** Ground surfaces (terrains, horizontal floors), water level and obstacle footprints, sampled on a regular grid. */
export function buildGroundField(doc: ThreeSceneDocument, resolution = 256): GroundField | null {
  const matrices = sceneMatrices(doc), byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const visible = (node: SceneNode): boolean => node.visible && (!node.parentId || visible(byId.get(node.parentId)!))
  const surfaces: Surface[] = [], waters: { matrix: THREE.Matrix4; inverse: THREE.Matrix4; level: number }[] = []
  const bounds = new THREE.Box3(), point = new THREE.Vector3()
  for (const node of doc.nodes) {
    if (!visible(node) || !hasSurface(node.kind)) continue
    const matrix = matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))
    if (isWater(node)) { waters.push({ matrix, inverse: matrix.clone().invert(), level: point.set(0, node.kind === 'box' ? 0.5 : 0, 0).applyMatrix4(matrix).y }); continue }
    const up = new THREE.Vector3(0, 1, 0).transformDirection(matrices.get(node.id)!)
    if (!(node.kind === 'terrain' || ((node.kind === 'plane' || isSlab(node)) && up.y > 0.95))) continue
    const tint = new THREE.Color(node.material.color)
    surfaces.push({ node, matrix, inverse: matrix.clone().invert(), grass: grassWeight(node), color: tint, terrain: node.kind === 'terrain', top: node.kind === 'plane' ? 0 : 0.5 })
    for (const [u, v] of unitCorners) bounds.expandByPoint(point.set(u, 0, v).applyMatrix4(matrix))
  }
  if (!surfaces.length) return null
  const sizeX = Math.max(0.5, bounds.max.x - bounds.min.x), sizeZ = Math.max(0.5, bounds.max.z - bounds.min.z)
  const cell = Math.max(sizeX, sizeZ) / (Math.min(MAX_RESOLUTION, Math.max(16, Math.round(resolution))) - 1)
  const nx = Math.max(2, Math.min(MAX_RESOLUTION, Math.ceil(sizeX / cell) + 1)), nz = Math.max(2, Math.min(MAX_RESOLUTION, Math.ceil(sizeZ / cell) + 1))
  const minX = bounds.min.x, minZ = bounds.min.z, stepX = sizeX / (nx - 1), stepZ = sizeZ / (nz - 1)
  const height = new Float32Array(nx * nz), cover = new Uint8Array(nx * nz), grass = new Float32Array(nx * nz), colors = new Float32Array(nx * nz * 3)
  const color = new THREE.Color(), low = new THREE.Color(), mid = new THREE.Color(), dry = new THREE.Color()
  let minY = Infinity, maxY = -Infinity
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = minX + i * stepX, z = minZ + j * stepZ, index = j * nx + i
    let best = -Infinity, weight = 0
    for (const surface of surfaces) {
      point.set(x, surface.matrix.elements[13], z).applyMatrix4(surface.inverse)
      if (Math.abs(point.x) > 0.5 + 1e-6 || Math.abs(point.z) > 0.5 + 1e-6) continue
      const u = Math.max(-0.5, Math.min(0.5, point.x)), v = Math.max(-0.5, Math.min(0.5, point.z))
      const local = surface.terrain ? terrainHeightAt(surface.node.geometry, u, v) : surface.top
      const y = point.set(u, local, v).applyMatrix4(surface.matrix).y
      if (y <= best) continue
      best = y; weight = surface.grass
      color.copy(surface.color)
      const biome = surface.terrain ? surface.node.geometry.biome ?? 'none' : 'none'
      if (BIOME_COLORS[biome]) {
        const spec = surface.node.geometry, h = local + 0.5, patch = fractalNoise((u + 0.5) * 22, (v + 0.5) * 22, spec.seed + 71, 3)
        const [a, b, c] = BIOME_COLORS[biome]
        mid.set(b); dry.set(c)
        color.multiply(low.set(a).lerp(mid, smooth(0.08, 0.3, h)).lerp(dry, smooth(0.35, 0.75, patch) * 0.65).multiplyScalar((0.9 + patch * 0.2) * 0.85))
        weight *= smooth(0.06, 0.2, h) * (1 - smooth(biome === 'alpine' ? 0.67 : 0.8, biome === 'alpine' ? 0.77 : 0.9, h)) * (1 - 0.4 * smooth(0.35, 0.75, patch))
      } else color.multiplyScalar(0.8)
    }
    if (best === -Infinity) continue
    height[index] = best; cover[index] = 1; grass[index] = weight
    colors.set([color.r, color.g, color.b], index * 3)
    minY = Math.min(minY, best); maxY = Math.max(maxY, best)
  }
  if (minY === Infinity) return null
  if (maxY - minY < 0.01) maxY = minY + 0.01
  for (let i = 0; i < height.length; i++) if (!cover[i]) height[i] = minY
  // Slope from central differences: grass stops where biome shading turns to exposed rock.
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const index = j * nx + i
    if (!grass[index]) continue
    const at = (a: number, b: number) => height[Math.min(nz - 1, Math.max(0, b)) * nx + Math.min(nx - 1, Math.max(0, a))]
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * stepX), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * stepZ)
    grass[index] *= 1 - smooth(0.04, 0.16, 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz))
  }
  const level = waters.length ? Math.max(...waters.map((water) => water.level)) : null
  const carve = (x0: number, x1: number, z0: number, z1: number, factor: (x: number, z: number, index: number) => number) => {
    const i0 = Math.max(0, Math.floor((x0 - minX) / stepX)), i1 = Math.min(nx - 1, Math.ceil((x1 - minX) / stepX))
    const j0 = Math.max(0, Math.floor((z0 - minZ) / stepZ)), j1 = Math.min(nz - 1, Math.ceil((z1 - minZ) / stepZ))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const index = j * nx + i
      if (grass[index] > 0) grass[index] *= factor(minX + i * stepX, minZ + j * stepZ, index)
    }
  }
  for (const water of waters) {
    const corners = unitCorners.map(([u, v]) => point.set(u, 0, v).applyMatrix4(water.matrix).clone())
    carve(Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.z)), (x, z, index) => {
      point.set(x, water.level, z).applyMatrix4(water.inverse)
      return Math.abs(point.x) > 0.5 || Math.abs(point.z) > 0.5 ? 1 : smooth(water.level + 0.1, water.level + 0.45, height[index])
    })
  }
  const margin = 0.3, ground = (x: number, z: number) => height[Math.min(nz - 1, Math.max(0, Math.round((z - minZ) / stepZ))) * nx + Math.min(nx - 1, Math.max(0, Math.round((x - minX) / stepX)))]
  const segment = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    return Math.hypot(x - ax - dx * t, z - az - dz * t)
  }
  const skipped = new Set<string>()
  for (const node of doc.nodes) {
    const dynamicRoot = (node.asset && (characterPrefabs as readonly string[]).includes(node.asset.type)) || node.behavior?.type === 'enemy' || node.behavior?.type === 'npc' || node.interaction?.action === 'collect'
    if (dynamicRoot || (node.parentId && skipped.has(node.parentId))) skipped.add(node.id)
  }
  const surfaceIds = new Set(surfaces.map((surface) => surface.node.id))
  for (const node of doc.nodes) {
    if (!visible(node) || skipped.has(node.id) || surfaceIds.has(node.id) || isWater(node) || !hasSurface(node.kind) || node.kind === 'text') continue
    const matrix = matrices.get(node.id)!.clone().scale(new THREE.Vector3(...node.dimensions))
    if (node.path) {
      const points = node.path.points, half = node.path.width / 2
      const xs = points.map((p) => p[0]), zs = points.map((p) => p[1])
      carve(Math.min(...xs) - half - margin, Math.max(...xs) + half + margin, Math.min(...zs) - half - margin, Math.max(...zs) + half + margin, (x, z) => {
        let distance = Infinity
        for (let k = 1; k < points.length; k++) distance = Math.min(distance, segment(x, z, points[k - 1][0], points[k - 1][1], points[k][0], points[k][1]))
        return smooth(half, half + margin, distance)
      })
      continue
    }
    if (node.role === 'path' && node.kind === 'mesh' && node.geometry.indices.length) {
      const g = node.geometry, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      g.vertices.forEach((value, k) => { min[k % 3] = Math.min(min[k % 3], value); max[k % 3] = Math.max(max[k % 3], value) })
      const world = Array.from({ length: g.vertices.length / 3 }, (_, k) => point.set(...[0, 1, 2].map((axis) => (g.vertices[k * 3 + axis] - (min[axis] + max[axis]) / 2) / (max[axis] - min[axis] || 1)) as [number, number, number]).applyMatrix4(matrix).clone())
      for (let k = 0; k < g.indices.length; k += 3) {
        const [a, b, c] = [world[g.indices[k]], world[g.indices[k + 1]], world[g.indices[k + 2]]]
        const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
        if (Math.abs(area) < 1e-9) continue
        carve(Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z), (x, z) => {
          const w1 = ((x - a.x) * (c.z - a.z) - (c.x - a.x) * (z - a.z)) / area, w2 = ((b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z)) / area
          return w1 >= -0.02 && w2 >= -0.02 && w1 + w2 <= 1.02 ? 0 : 1
        })
      }
      continue
    }
    const box = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)).applyMatrix4(matrix)
    const center = box.getCenter(new THREE.Vector3()), floor = ground(center.x, center.z)
    if (box.min.y > floor + 0.35 || box.max.y < floor - 0.3) continue
    const inverse = matrix.clone().invert(), e = matrix.elements
    const spanX = Math.hypot(e[0], e[1], e[2]), spanZ = Math.hypot(e[8], e[9], e[10])
    carve(box.min.x - margin, box.max.x + margin, box.min.z - margin, box.max.z + margin, (x, z) => {
      point.set(x, center.y, z).applyMatrix4(inverse)
      const dx = Math.max(0, Math.abs(point.x) - 0.5) * spanX, dz = Math.max(0, Math.abs(point.z) - 0.5) * spanZ
      return smooth(0, margin, Math.hypot(dx, dz))
    })
  }
  const data = new Uint8Array(nx * nz * 4), tints = new Uint8Array(nx * nz * 4), span = maxY - minY
  for (let k = 0; k < nx * nz; k++) {
    const q = Math.round(Math.min(1, Math.max(0, (height[k] - minY) / span)) * 65535)
    data[k * 4] = q >> 8; data[k * 4 + 1] = q & 255; data[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, grass[k])) * 255); data[k * 4 + 3] = cover[k] * 255
    color.setRGB(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2], THREE.LinearSRGBColorSpace).convertLinearToSRGB()
    tints[k * 4] = Math.round(Math.min(1, color.r) * 255); tints[k * 4 + 1] = Math.round(Math.min(1, color.g) * 255); tints[k * 4 + 2] = Math.round(Math.min(1, color.b) * 255); tints[k * 4 + 3] = 255
  }
  const texture = dataTexture(data, nx, nz, THREE.NoColorSpace), tint = dataTexture(tints, nx, nz, THREE.SRGBColorSpace)
  const sample = (x: number, z: number, read: (index: number) => number) => {
    const fx = Math.min(nx - 1, Math.max(0, (x - minX) / stepX)), fz = Math.min(nz - 1, Math.max(0, (z - minZ) / stepZ))
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, tz = fz - j
    const a = read(j * nx + i), b = read(j * nx + i + 1), c = read((j + 1) * nx + i), d = read((j + 1) * nx + i + 1)
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }
  const inside = (x: number, z: number) => x >= minX - 1e-6 && x <= minX + sizeX + 1e-6 && z >= minZ - 1e-6 && z <= minZ + sizeZ + 1e-6
  return {
    texture, tint, bounds: [minX, minZ, sizeX, sizeZ], range: [minY, maxY], size: [nx, nz], water: level,
    heightAt: (x, z) => minY + sample(x, z, (k) => data[k * 4] * 256 + data[k * 4 + 1]) / 65535 * span,
    grassAt: (x, z) => inside(x, z) ? sample(x, z, (k) => data[k * 4 + 2]) / 255 : 0,
    coverAt: (x, z) => inside(x, z) ? sample(x, z, (k) => data[k * 4 + 3]) / 255 : 0,
    tintAt: (x, z) => [0, 1, 2].map((channel) => sample(x, z, (k) => tints[k * 4 + channel]) / 255) as [number, number, number],
    dispose() { texture.dispose(); tint.dispose() },
  }
}
function dataTexture(data: Uint8Array, width: number, height: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = colorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/** GLSL mirror of GroundField sampling; `groundSample(xz)` = (height, grass, coverage, 1). Needs the uniforms of `groundUniforms`. */
export const GROUND_GLSL = /* glsl */`
uniform sampler2D groundMap;
uniform sampler2D groundTint;
uniform vec4 groundBounds;
uniform vec4 groundInfo;
uniform float groundEnabled;
uniform float groundFallback;
vec2 groundUv(vec2 xz) {
  vec2 cell = clamp((xz - groundBounds.xy) / groundBounds.zw, 0.0, 1.0);
  return (cell * (groundInfo.zw - 1.0) + 0.5) / groundInfo.zw;
}
vec4 groundSample(vec2 xz) {
  if (groundEnabled < 0.5) return vec4(groundFallback, 0.0, 0.0, 1.0);
  vec2 cell = (xz - groundBounds.xy) / groundBounds.zw;
  float inside = step(0.0, cell.x) * step(cell.x, 1.0) * step(0.0, cell.y) * step(cell.y, 1.0);
  vec4 g = texture2D(groundMap, groundUv(xz));
  float h = groundInfo.x + (g.r * 65280.0 + g.g * 255.0) / 65535.0 * groundInfo.y;
  float cover = g.a * inside;
  return vec4(mix(groundFallback, h, step(0.5, cover)), g.b * inside, cover, 1.0);
}`

export function groundUniforms(): Record<string, THREE.IUniform> {
  return { groundMap: { value: null }, groundTint: { value: null }, groundBounds: { value: new THREE.Vector4(0, 0, 1, 1) }, groundInfo: { value: new THREE.Vector4(0, 1, 2, 2) }, groundEnabled: { value: 0 }, groundFallback: { value: 0 } }
}
/** Loads a field into uniforms created by `groundUniforms`; null keeps a flat fallback plane at y = 0. */
export function setGroundUniforms(uniforms: Record<string, THREE.IUniform>, field: GroundField | null): void {
  uniforms.groundMap.value = field?.texture ?? null
  uniforms.groundTint.value = field?.tint ?? null
  uniforms.groundEnabled.value = field ? 1 : 0
  uniforms.groundFallback.value = field ? field.range[0] : 0
  if (field) { (uniforms.groundBounds.value as THREE.Vector4).set(...field.bounds); (uniforms.groundInfo.value as THREE.Vector4).set(field.range[0], field.range[1] - field.range[0], field.size[0], field.size[1]) }
}
