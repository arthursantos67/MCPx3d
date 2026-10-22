import * as THREE from 'three'
import { hasSurface, type SceneNode, type ThreeSceneDocument } from './sceneDocument.ts'
import { buildNodeGeometry } from './sceneGeometry.ts'
import { GROUND_GLSL, groundUniforms, setGroundUniforms, type GroundField } from './sceneGroundField.ts'
import { characterPrefabs } from './scenePrefabs.ts'

export { buildGroundField, type GroundField } from './sceneGroundField.ts'

export type WindKind = 'tree' | 'foliage' | 'grass' | 'flag'
export interface WindSpec { kind: WindKind; stiffness: number; anchor?: 'top' | 'side' }
export interface WindSystem {
  uniforms: Record<string, THREE.IUniform>
  setGround(field: GroundField | null): void
  setStrength(wind: number): void
  update(seconds: number, player: THREE.Vector3 | null): void
  /** Mean wind at the current time (direction × strength, m/s-like scale) for weather, smoke and springs. */
  vector(target?: THREE.Vector3): THREE.Vector3
  dispose(): void
}

const KIND_CODE: Record<WindKind, number> = { tree: 0, foliage: 1, grass: 2, flag: 3 }
const BASE_ANGLE = 0.6
/** Wind heading over time: a slow veer around the prevailing direction keeps gust fronts from looking mechanical. */
export function windDirection(seconds: number): [number, number] {
  const angle = BASE_ANGLE + 0.35 * Math.sin(seconds * 0.031) + 0.15 * Math.sin(seconds * 0.077 + 1.3)
  return [Math.cos(angle), Math.sin(angle)]
}

/** CPU mirror of `windField` in WIND_GLSL: continuous world-space XZ wind with travelling gust fronts and turbulence. */
export function windField(x: number, z: number, time: number, direction: [number, number], strength: number): [number, number] {
  const [dx, dz] = direction, sx = -dz, sz = dx
  const along = x * dx + z * dz, across = x * sx + z * sz
  const front = along * 0.075 - time * 0.9 + Math.sin(across * 0.045 + time * 0.13) * 1.7
  let gust = 0.5 + 0.5 * Math.sin(front)
  gust *= gust
  const sway = Math.sin(time * 1.6 + along * 0.31 + across * 0.07) * 0.6 + Math.sin(time * 2.7 + across * 0.43 - along * 0.12) * 0.4
  const tx = Math.sin(time * 3.3 + x * 0.83 + z * 0.37) * 0.12, tz = Math.sin(time * 2.9 + z * 0.79 - x * 0.29) * 0.12
  const main = (0.3 + 0.7 * gust) * (0.75 + 0.25 * sway), side = sway * 0.18 * (0.4 + gust)
  return [(dx * main + sx * side + tx) * strength, (dz * main + sz * side + tz) * strength]
}

/**
 * CPU mirror of the vertex displacement (metres) for a world point `height` metres above the ground.
 * Plants depend only on world position and height, so parts that touch move together; flags need `reach` from the anchor and the cloth `normal`.
 */
export function windOffset(position: [number, number, number], ground: number, time: number, spec: WindSpec, strength: number, direction: [number, number] = windDirection(time),
  cloth: { reach: number; normal: [number, number, number] } = { reach: 0, normal: [0, 0, 1] }): [number, number, number] {
  const [x, y, z] = position, h = Math.max(0, y - ground), [fx, fz] = windField(x, z, time, direction, strength)
  if (spec.kind === 'flag') {
    const w = Math.hypot(fx, fz), [nx, ny, nz] = cloth.normal, reach = cloth.reach, phase = x * 0.37 + z * 0.71
    const wave = Math.sin(reach * 3.2 - time * (4 + 3 * w) + phase) * 0.6 + Math.sin(reach * 6.1 - time * (6.5 + 2 * w) + phase * 1.7) * 0.25
    const amount = reach * (1 - 0.8 * spec.stiffness), billow = (fx * nx + fz * nz) * 0.3
    const along = wave * (0.05 + 0.08 * w) * amount + billow * amount
    const d = [nx * along + fx * 0.08 * amount * reach, ny * along, nz * along + fz * 0.08 * amount * reach]
    const m = Math.hypot(d[0], d[1], d[2]), cap = Math.min(0.6 * reach, 1.2)
    const k = m > cap ? cap / m : 1
    return [d[0] * k, d[1] * k, d[2] * k]
  }
  const flex = 1 - 0.9 * spec.stiffness, bend = spec.kind === 'grass' ? 0.22 * h : 0.035 * h * Math.sqrt(h)
  let dx = fx * bend * flex, dz = fz * bend * flex
  const m = Math.hypot(dx, dz), cap = Math.min(0.4 * h, 1.5)
  if (m > cap) { dx *= cap / m; dz *= cap / m }
  let ox = 0, oy = 0, oz = 0
  if (spec.kind === 'foliage') {
    const amount = 0.03 * flex * Math.hypot(fx, fz) * smoothstep(0.1, 1, h)
    ox = Math.sin(time * 5.3 + x * 1.7 + y * 1.1 + z * 1.3) * amount
    oy = 0.6 * Math.sin(time * 4.1 - x * 1.2 + y * 1.9 + z * 0.8) * amount
    oz = Math.sin(time * 4.7 + x * 0.9 - y * 1.4 + z * 1.6) * amount
  }
  return [dx + ox, -(dx * dx + dz * dz) / (2 * Math.max(h, 0.25)) + oy, dz + oz]
}
function smoothstep(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export const WIND_GLSL = /* glsl */`
${GROUND_GLSL}
uniform float windTime;
uniform vec2 windDirection;
uniform float windStrength;
uniform vec4 windPlayer;
vec2 windField(vec2 xz) {
  vec2 d = windDirection, s = vec2(-d.y, d.x);
  float along = dot(xz, d), across = dot(xz, s);
  float front = along * 0.075 - windTime * 0.9 + sin(across * 0.045 + windTime * 0.13) * 1.7;
  float gust = 0.5 + 0.5 * sin(front);
  gust *= gust;
  float sway = sin(windTime * 1.6 + along * 0.31 + across * 0.07) * 0.6 + sin(windTime * 2.7 + across * 0.43 - along * 0.12) * 0.4;
  vec2 turb = vec2(sin(windTime * 3.3 + xz.x * 0.83 + xz.y * 0.37), sin(windTime * 2.9 + xz.y * 0.79 - xz.x * 0.29)) * 0.12;
  return (d * (0.3 + 0.7 * gust) * (0.75 + 0.25 * sway) + s * sway * 0.18 * (0.4 + gust) + turb) * windStrength;
}`

const displaceGLSL = /* glsl */`
uniform float windStiffness;
#if WIND_KIND == 3
attribute float clothReach;
attribute vec3 clothAxis;
#endif
vec3 windDisplace(vec3 wp, vec3 local, mat3 basis) {
  vec2 f = windField(wp.xz);
#if WIND_KIND == 3
  bool authored = dot(clothAxis, clothAxis) > 0.0;
  vec3 axis = normalize(authored ? basis * clothAxis : basis[2]);
  float reach = authored ? clothReach : max(0.0, 0.5 - local.y) * length(basis[1]);
  float w = length(f), phase = dot(wp.xz, vec2(0.37, 0.71));
  float wave = sin(reach * 3.2 - windTime * (4.0 + 3.0 * w) + phase) * 0.6 + sin(reach * 6.1 - windTime * (6.5 + 2.0 * w) + phase * 1.7) * 0.25;
  float amount = reach * (1.0 - 0.8 * windStiffness);
  vec3 push = vec3(f.x, 0.0, f.y);
  vec3 d = axis * (wave * (0.05 + 0.08 * w) * amount + dot(push, axis) * 0.3 * amount) + push * 0.08 * amount * reach;
  float m = length(d), cap = min(0.6 * reach, 1.2);
  return m > cap ? d * (cap / m) : d;
#else
  float h = max(0.0, wp.y - groundSample(wp.xz).x);
  float flex = 1.0 - 0.9 * windStiffness;
  float bend = WIND_KIND == 2 ? 0.22 * h : 0.035 * h * sqrt(h);
  vec2 d = f * bend * flex;
  float m = length(d), cap = min(0.4 * h, 1.5);
  d *= m > cap ? cap / m : 1.0;
  vec3 offset = vec3(d.x, -dot(d, d) / (2.0 * max(h, 0.25)), d.y);
#if WIND_KIND == 1
  float amount = 0.03 * flex * length(f) * smoothstep(0.1, 1.0, h);
  offset += vec3(sin(windTime * 5.3 + dot(wp, vec3(1.7, 1.1, 1.3))), 0.6 * sin(windTime * 4.1 + dot(wp, vec3(-1.2, 1.9, 0.8))), sin(windTime * 4.7 + dot(wp, vec3(0.9, -1.4, 1.6)))) * amount;
#endif
  return offset;
#endif
}`
const projectGLSL = /* glsl */`
vec4 windWorld = vec4( transformed, 1.0 );
mat3 windBasis = mat3( modelMatrix );
#ifdef USE_BATCHING
windWorld = batchingMatrix * windWorld;
windBasis = windBasis * mat3( batchingMatrix );
#endif
#ifdef USE_INSTANCING
windWorld = instanceMatrix * windWorld;
windBasis = windBasis * mat3( instanceMatrix );
#endif
windWorld = modelMatrix * windWorld;
vec3 windDelta = windDisplace( windWorld.xyz, transformed, windBasis );
vec4 mvPosition = viewMatrix * vec4( windWorld.xyz + windDelta, 1.0 );
gl_Position = projectionMatrix * mvPosition;`
const worldGLSL = /* glsl */`
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
worldPosition.xyz += windDelta;
#endif`

/** Injects the wind into any built-in material whose vertex shader uses the standard begin/project chunks. */
function patchVertex(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>, kind: WindKind) {
  Object.assign(shader.uniforms, uniforms)
  shader.defines = { ...shader.defines, WIND_KIND: KIND_CODE[kind] }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WIND_GLSL}\n${displaceGLSL}`)
    .replace('#include <project_vertex>', projectGLSL)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${worldGLSL}`)
}

/** Shared uniforms (time, direction, strength, player, ground field) for every wind-driven material, grass and water. */
export function createWind(): WindSystem {
  const uniforms: Record<string, THREE.IUniform> = { ...groundUniforms(), windTime: { value: 0 }, windDirection: { value: new THREE.Vector2(...windDirection(0)) }, windStrength: { value: 0.6 }, windPlayer: { value: new THREE.Vector4(0, -1e4, 0, 0) } }
  let field: GroundField | null = null
  return {
    uniforms,
    setGround(next) { field = next; setGroundUniforms(uniforms, next) },
    setStrength(wind) { uniforms.windStrength.value = THREE.MathUtils.clamp(Number.isFinite(wind) ? wind : 0, 0, 2) },
    update(seconds, player) {
      // Float32 sines lose precision after hours; the jump happens once every ~67 minutes.
      const time = seconds % 4000
      uniforms.windTime.value = time
      ;(uniforms.windDirection.value as THREE.Vector2).set(...windDirection(time))
      ;(uniforms.windPlayer.value as THREE.Vector4).set(player?.x ?? 0, player?.y ?? -1e4, player?.z ?? 0, player ? 1 : 0)
    },
    vector(target = new THREE.Vector3()) {
      const direction = uniforms.windDirection.value as THREE.Vector2, strength = uniforms.windStrength.value as number
      return target.set(direction.x * strength, 0, direction.y * strength)
    },
    dispose() { field = null; setGroundUniforms(uniforms, field) },
  }
}

export interface WindShadow { depth: THREE.MeshDepthMaterial; distance: THREE.MeshDistanceMaterial }
/**
 * Patches a material (assumed exclusive to this wind variant) in place. Previous onBeforeCompile hooks (terrain layers) run first.
 * Shadow casters need the matching depth/distance materials from `windShadowMaterials`.
 */
export function applyWind(material: THREE.Material, wind: WindSystem, kind: WindKind, stiffness: number): void {
  const own = { windStiffness: { value: THREE.MathUtils.clamp(stiffness, 0, 1) } }
  const previous = material.userData.windPatched ? material.userData.windBase as typeof material.onBeforeCompile : material.onBeforeCompile
  const previousKey = material.userData.windPatched ? material.userData.windBaseKey as () => string : material.customProgramCacheKey.bind(material)
  material.userData.windPatched = true
  material.userData.windBase = previous
  material.userData.windBaseKey = previousKey
  material.userData.wind = { kind, stiffness: own.windStiffness.value }
  material.onBeforeCompile = (shader, renderer) => { previous.call(material, shader, renderer); patchVertex(shader, { ...wind.uniforms, ...own }, kind) }
  material.customProgramCacheKey = () => `${previousKey()}|wind-v1:${kind}`
  const shadowFor = <T extends THREE.Material>(target: T): T => {
    target.onBeforeCompile = (shader) => patchVertex(shader, { ...wind.uniforms, ...own }, kind)
    target.customProgramCacheKey = () => `wind-shadow-v1:${kind}`
    return target
  }
  ;(material.userData.windShadow as WindShadow | undefined)?.depth.dispose()
  ;(material.userData.windShadow as WindShadow | undefined)?.distance.dispose()
  material.userData.windShadow = { depth: shadowFor(new THREE.MeshDepthMaterial()), distance: shadowFor(new THREE.MeshDistanceMaterial()) } satisfies WindShadow
  material.needsUpdate = true
}
/** Depth/distance materials matching `applyWind`; assign them to `mesh.customDepthMaterial` / `customDistanceMaterial`. */
export function windShadowMaterials(material: THREE.Material): WindShadow | null { return (material.userData.windShadow as WindShadow | undefined) ?? null }
/** Sets the shadow materials on every mesh whose material went through `applyWind`. */
export function attachWindShadows(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const shadow = windShadowMaterials(mesh.material)
    if (shadow) { mesh.customDepthMaterial = shadow.depth; mesh.customDistanceMaterial = shadow.distance }
  })
}
export function disposeWind(material: THREE.Material): void {
  const shadow = windShadowMaterials(material)
  shadow?.depth.dispose(); shadow?.distance.dispose()
}

const FLAG_PREFABS: Record<string, { parts: (part: string) => boolean; anchor: 'top' | 'side' }> = {
  banner: { parts: (part) => part === 'flag' || part.startsWith('emblem'), anchor: 'top' },
  checkpoint: { parts: (part) => part === 'flag', anchor: 'side' },
  castleTower: { parts: (part) => part === 'pennantCloth' || part === 'flagCloth', anchor: 'side' },
}
const leafy = (node: SceneNode) => ['leaves', 'foliage', 'needles', 'grass'].includes(node.material.texture ?? 'none')
/**
 * Who sways and how much. `root` is the nearest ancestor (or the node) carrying `asset`, otherwise the top-level ancestor.
 * Stiffness belongs to the whole plant so trunk, branches and crown share the main bend and never separate.
 */
export function windKind(node: SceneNode, root: SceneNode | undefined): WindSpec | null {
  if (!hasSurface(node.kind) || node.kind === 'text' || node.kind === 'terrain') return null
  const type = root?.asset?.type, part = node.assetPart ?? ''
  if (type && (characterPrefabs as readonly string[]).includes(type)) return null
  if (type === 'tree' || type === 'pine') return { kind: part.startsWith('foliage') ? 'foliage' : 'tree', stiffness: type === 'pine' ? 0.7 : 0.55 }
  if (type === 'palm') return { kind: part.startsWith('frond') ? 'foliage' : 'tree', stiffness: 0.45 }
  if (type === 'bush') return { kind: 'foliage', stiffness: 0.3 }
  if (type === 'flowerBed') return part.startsWith('flower') ? { kind: 'grass', stiffness: 0.55 } : null
  if (type === 'seaweed') return { kind: 'grass', stiffness: 0.5 }
  if (type && FLAG_PREFABS[type]) return FLAG_PREFABS[type].parts(part) ? { kind: 'flag', stiffness: 0.2, anchor: FLAG_PREFABS[type].anchor } : null
  if (type) return null
  if (node.material.texture === 'fabric' && node.collidable === false && Math.min(...node.dimensions) <= 0.06 && node.parentId) {
    const [x, y] = node.position, [w, h] = node.dimensions
    if (Math.abs(y + h / 2) <= 0.05 * h + 0.01) return { kind: 'flag', stiffness: 0.25, anchor: 'top' }
    if (Math.abs(x - w / 2) <= 0.05 * w + 0.01) return { kind: 'flag', stiffness: 0.25, anchor: 'side' }
  }
  if (node.role === 'vegetation' || root?.role === 'vegetation') return { kind: leafy(node) ? 'foliage' : 'tree', stiffness: 0.55 }
  return null
}
/** Wind specs for every swaying node of the document, keyed by node id. */
export function windKinds(doc: ThreeSceneDocument): Map<string, WindSpec> {
  const byId = new Map(doc.nodes.map((node) => [node.id, node])), result = new Map<string, WindSpec>()
  const rootOf = (node: SceneNode): SceneNode => {
    for (let current: SceneNode | undefined = node; current; current = current.parentId ? byId.get(current.parentId) : undefined) if (current.asset) return current
    let top = node
    while (top.parentId && byId.has(top.parentId)) top = byId.get(top.parentId)!
    return top
  }
  for (const node of doc.nodes) { const spec = windKind(node, rootOf(node)); if (spec) result.set(node.id, spec) }
  return result
}
/** Stable cache key for a material/geometry variant. */
export const windKey = (spec: WindSpec) => `${spec.kind}:${spec.stiffness.toFixed(2)}:${spec.anchor ?? ''}`

/**
 * Tessellated cloth for flag nodes (unit-normalised like buildNodeGeometry) with `clothReach` (metres from the anchor of the parent group)
 * and `clothAxis` (the parent's Z axis in unit-local coordinates), so emblems sewn onto a flag ripple with it.
 */
export function clothGeometry(node: SceneNode, spec: WindSpec): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry
  const top = spec.anchor !== 'side'
  if (node.kind === 'box' || node.kind === 'roundedBox') geometry = new THREE.BoxGeometry(1, 1, 1, top ? 6 : 14, top ? 14 : 6, 1)
  else if (node.kind === 'extrude' && node.geometry.profile.length >= 3) geometry = extrudedCloth(node.geometry.profile, top)
  else geometry = buildNodeGeometry(node)
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]))
  const inverse = rotation.clone().invert(), axis = new THREE.Vector3(0, 0, 1).applyMatrix4(inverse).divide(new THREE.Vector3(...node.dimensions)).normalize()
  const position = geometry.getAttribute('position'), reach = new Float32Array(position.count), axes = new Float32Array(position.count * 3), point = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).multiply(new THREE.Vector3(...node.dimensions)).applyMatrix4(rotation).add(new THREE.Vector3(...node.position))
    reach[i] = Math.max(0, top ? -point.y : point.x)
    axes.set([axis.x, axis.y, axis.z], i * 3)
  }
  geometry.setAttribute('clothReach', new THREE.BufferAttribute(reach, 1))
  geometry.setAttribute('clothAxis', new THREE.BufferAttribute(axes, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
/** Front and back grids spanning a profile that is y-monotone per column (pennants, swallowtail banners). */
function extrudedCloth(profile: [number, number][], top: boolean): THREE.BufferGeometry {
  const xs = profile.map((p) => p[0]), ys = profile.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), w = maxX - minX || 1, h = maxY - minY || 1
  const columns = top ? 6 : 14, rows = top ? 14 : 6, positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = []
  const extent = (x: number): [number, number] => {
    const hits: number[] = []
    for (let i = 0; i < profile.length; i++) {
      const [ax, ay] = profile[i], [bx, by] = profile[(i + 1) % profile.length]
      if ((x >= Math.min(ax, bx) && x <= Math.max(ax, bx)) && Math.abs(bx - ax) > 1e-9) hits.push(ay + (by - ay) * (x - ax) / (bx - ax))
    }
    return hits.length ? [Math.min(...hits), Math.max(...hits)] : [minY, maxY]
  }
  for (const side of [1, -1]) {
    const base = positions.length / 3
    for (let c = 0; c <= columns; c++) {
      const x = minX + w * c / columns, [y0, y1] = extent(minX + w * (0.0005 + 0.999 * c / columns))
      for (let r = 0; r <= rows; r++) {
        const y = y0 + (y1 - y0) * r / rows
        positions.push((x - (minX + maxX) / 2) / w, (y - (minY + maxY) / 2) / h, side * 0.5)
        normals.push(0, 0, side)
        uvs.push(x, y)
      }
    }
    for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) {
      const a = base + c * (rows + 1) + r, b = a + rows + 1
      if (side > 0) indices.push(a, b, a + 1, a + 1, b, b + 1)
      else indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}
