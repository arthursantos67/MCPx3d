import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildScene, createResources, type SceneResources } from '../sceneBuild.ts'
import { createEmptyScene, createNode, defaultAnimation, validateMaterial, validateScene, type TextureKind, type ThreeSceneDocument } from '../sceneDocument.ts'
import { prefabParts, type PrefabSpec } from '../scenePrefabs.ts'
import { buildVegetation } from '../sceneVegetation.ts'
import { applyWind, windKey, windKinds, windShadowMaterials, type WindSystem } from '../sceneWind.ts'
import { INSTANCE_STRIDE, SPECIES, VEGETATION_CELL, type CellVegetation, type Species } from './worldVegetation.ts'
import { hash2 } from './worldNoise.ts'
import { createPlantInteraction, filterPlants, type PlantTarget, type PlantObstacle } from './worldPlantInteraction.ts'
import { distantVegetation } from './worldVisibility.ts'
import { distantTreeParts } from './worldTreeLod.ts'

/**
 * Vegetation of a streamed world in three tiers per species: the full prefab near the camera (with wind and shadows),
 * the same prefab at minimum tessellation further out, and lightweight volumetric silhouettes to the horizon of the
 * vegetation range. Neighbouring tiers cross-fade per instance with complementary screen-space dithering, so a plant
 * is always drawn by exactly one tier and no tier pops. Instance buffers change only when the set of cells in a tier
 * changes; distances inside a tier are resolved in the shaders.
 */
export const TIER_RANGES = { near: 80, mid: 180, far: 650 }
const FADE = 0.12
/** Camera travel that refreshes the near and mid tiers, and the slack their per-plant selection keeps for it. */
const REFRESH = VEGETATION_CELL / 16
const VARIANTS = 2
type Tier = 'near' | 'mid' | 'far'

interface PrototypePart { geometry: THREE.BufferGeometry; material: THREE.Material }
interface Prototype { parts: PrototypePart[]; height: number; width: number }
interface TierMesh { species: Species; variant: number; mesh: THREE.InstancedMesh; capacity: number }

export interface VegetationRenderer {
  readonly object: THREE.Group
  readonly materials: THREE.Material[]
  setCell(cx: number, cz: number, plants: CellVegetation | null): void
  update(camera: THREE.Vector3, renderOrigin: [number, number], frustum: THREE.Frustum): void
  readonly stats: { near: number; mid: number; far: number; rebuilds: number }
  raycast(ray: THREE.Ray, range?: number): PlantTarget | null
  obstacles(x: number, z: number): PlantObstacle[]
  removePlant(id: string): void
  resetHarvest(): void
  dispose(): void
}

const fadeRanges = (inner: number | null, outer: number) => new THREE.Vector4(inner === null ? -2 : inner * (1 - FADE), inner === null ? -1 : inner * (1 + FADE), outer * (1 - FADE), outer * (1 + FADE))

/** Interleaved gradient noise: the dither threshold both tiers of a transition compare against. */
const DITHER = 'float vegetationDither() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); }'

/** Per-instance distance fade and wind anchored at the instance base (worlds have no 1.x ground field). */
function prepareTier(material: THREE.Material, fade: THREE.Vector4, key: string) {
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.vegetationFade = { value: fade }
    shader.vertexShader = shader.vertexShader
      .replace('float h = max(0.0, wp.y - groundSample(wp.xz).x);', 'float h = max(0.0, wp.y - (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y);')
      .replace('#include <common>', '#include <common>\nvarying float vegetationDistance;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvegetationDistance = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vegetationDistance;\nuniform vec4 vegetationFade;\n${DITHER}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float vegetationKeep = smoothstep(vegetationFade.x, vegetationFade.y, vegetationDistance) * (1.0 - smoothstep(vegetationFade.z, vegetationFade.w, vegetationDistance));
if (vegetationKeep <= vegetationDither()) discard;`)
  }
  material.customProgramCacheKey = () => `${previousKey()}|vegetation-${key}-v1`
  material.needsUpdate = true
}

function prototypeDocument(species: Species, variant: number, tier: Tier): ThreeSceneDocument {
  const spec: PrefabSpec = { type: species, size: 1, seed: variant * 7 + 3, primary: null, secondary: null, text: '', lit: false, interactive: false }
  const root = { ...createNode('group'), id: 'plant', name: species, asset: spec, role: 'vegetation' as const }
  const low=tier!=='near'
  const parts = tier==='far'?distantTreeParts(spec):low && (species === 'tree' || species === 'pine') ? buildVegetation(spec, species === 'pine', true) : prefabParts(spec)
  const nodes = parts.map((part) => {
    const base = createNode(part.kind), geometry = { ...base.geometry, ...part.geometry }
    if (low) Object.assign(geometry, { segments: Math.min(geometry.segments, 8), detail: Math.min(geometry.detail, 1), bevel: 0 })
    return { ...base, id: `plant.${part.id}`, parentId: part.parentId ? `plant.${part.parentId}` : root.id, name: part.name, position: part.position, rotation: part.rotation ?? [0, 0, 0],
      dimensions: part.dimensions, collidable: false, assetPart: part.id, material: validateMaterial({ color: '#cccccc', metalness: 0, roughness: 0.6, ...part.material }), geometry,
      animation: { ...defaultAnimation(), ...part.animation } }
  })
  return validateScene({ ...createEmptyScene(), nodes: [root, ...nodes] })
}

/** Surface textures the plants of these species use, so workers can generate them before the prototypes are built. */
export function vegetationTextures(species: readonly Species[]): TextureKind[] {
  const kinds = new Set<TextureKind>()
  for (const name of species) for (let variant = 0; variant < VARIANTS; variant++) for (const node of prototypeDocument(name, variant, 'near').nodes)
    if (node.material.texture && node.material.texture !== 'none' && !node.material.textureImage) kinds.add(node.material.texture)
  return [...kinds]
}

/** Builds a plant and merges its surfaces by material, in the plant's own space, so each material is one draw. */
function buildPrototype(species: Species, variant: number, tier: Tier, resources: SceneResources, wind: WindSystem, fade: THREE.Vector4): Prototype {
  const doc = prototypeDocument(species, variant, tier), specs = windKinds(doc)
  const built = buildScene(doc, resources, { instancing: false, helpers: false, variant: (node) => {
    const spec = specs.get(node.id)
    return { key: `vegetation:${tier}:${spec ? windKey(spec) : 'still'}`, prepare: (material) => { if (spec) applyWind(material, wind, spec.kind, spec.stiffness); prepareTier(material, fade, tier) } }
  } })
  built.root.updateMatrixWorld(true)
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>(), box = new THREE.Box3()
  built.root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible || Array.isArray(mesh.material)) return
    let geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name)
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    geometry = geometry.applyMatrix4(mesh.matrixWorld)
    groups.set(mesh.material, [...groups.get(mesh.material) ?? [], geometry])
  })
  const parts: PrototypePart[] = []
  for (const [material, geometries] of groups) {
    const merged = mergeGeometries(geometries)
    for (const geometry of geometries) geometry.dispose()
    if (!merged) continue
    merged.computeBoundingBox(); box.union(merged.boundingBox!)
    parts.push({ geometry: merged, material })
  }
  built.root.removeFromParent()
  const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3())
  return { parts, height: Math.max(0.5, box.max.y), width: Math.max(0.5, size.x, size.z) }
}

export interface VegetationSetup { renderer: THREE.WebGLRenderer; wind: WindSystem; shadows: boolean; anisotropy: number; species: readonly Species[]; origin: [number, number] }

/** Builds instanced prototypes one species at a time, yielding between them so no task blocks the page. */
export async function createVegetationRenderer(setup: VegetationSetup): Promise<VegetationRenderer> {
  const resources = createResources(setup.anisotropy), object = new THREE.Group(), materials = new Set<THREE.Material>()
  object.name = 'Vegetação do mundo'
  const fades = { near: fadeRanges(null, TIER_RANGES.near), mid: fadeRanges(TIER_RANGES.near, TIER_RANGES.mid), far: fadeRanges(TIER_RANGES.mid, TIER_RANGES.far) }
  const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0))
  const tiers: Record<Tier, TierMesh[]> = { near: [], mid: [],far:[] }, shadowTiers = new Map<string, TierMesh[]>()
  const shadowOnly = (mesh: THREE.InstancedMesh) => {
    let count = 0
    mesh.userData.shadowOnly = true
    mesh.onBeforeRender = () => { count = mesh.count; mesh.count = 0 }
    mesh.onAfterRender = () => { mesh.count = count }
  }
  const prototypes = new Map<string, Prototype>()
  for (const species of setup.species) {
    for (let variant = 0; variant < VARIANTS; variant++) for (const tier of ['near', 'mid','far'] as const) {
      if(tier==='far'&&!distantVegetation.has(species))continue
      const prototype = buildPrototype(species, variant, tier, resources, setup.wind, fades[tier])
      prototypes.set(`${species}:${variant}:${tier}`, prototype)
      for (const part of prototype.parts) {
        materials.add(part.material)
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1)
        mesh.name = `${species}:${variant}:${tier}`
        mesh.count = 0
        mesh.visible = false
        mesh.frustumCulled = false
        mesh.castShadow = false
        mesh.receiveShadow = true
        const shadow = windShadowMaterials(part.material)
        if (shadow) { mesh.customDepthMaterial = shadow.depth; mesh.customDistanceMaterial = shadow.distance }
        object.add(mesh)
        tiers[tier].push({ species, variant, mesh, capacity: 1 })
      }
      await yieldFrame()
    }
    if (setup.shadows) for (let variant = 0; variant < VARIANTS; variant++) {
      const entries: TierMesh[] = []
      for (const part of prototypes.get(`${species}:${variant}:mid`)!.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, 1), shadow = windShadowMaterials(part.material)
        mesh.name = `${species}:${variant}:shadow`
        mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.castShadow = true
        if (shadow) { mesh.customDepthMaterial = shadow.depth; mesh.customDistanceMaterial = shadow.distance }
        shadowOnly(mesh)
        object.add(mesh)
        entries.push({ species, variant, mesh, capacity: 1 })
      }
      shadowTiers.set(`${species}:${variant}`, entries)
    }
  }
  type StreamedCell = { cx: number; cz: number; plants: CellVegetation; variants: Partial<Record<Species, Uint8Array>> }
  const cells = new Map<string, StreamedCell>()
  const interactions = createPlantInteraction(setup.origin)
  const stats = { near: 0, mid: 0, far: 0, rebuilds: 0 }
  let dirty = true, lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity)
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), sphere = new THREE.Sphere()
  const viewNormals = new Float64Array(18).fill(Infinity)
  const inRange = (cell: { cx: number; cz: number }, camera: THREE.Vector3, low: number, high: number, origin: [number, number]) => {
    const x0 = origin[0] + cell.cx * VEGETATION_CELL, z0 = origin[1] + cell.cz * VEGETATION_CELL
    const dx = Math.max(x0 - camera.x, 0, camera.x - x0 - VEGETATION_CELL), dz = Math.max(z0 - camera.z, 0, camera.z - z0 - VEGETATION_CELL)
    const near = Math.hypot(dx, dz), far = Math.hypot(Math.max(Math.abs(camera.x - x0), Math.abs(camera.x - x0 - VEGETATION_CELL)), Math.max(Math.abs(camera.z - z0), Math.abs(camera.z - z0 - VEGETATION_CELL)))
    return far >= low && near <= high
  }
  const variantOf = (list: Float32Array, i: number) => hash2(Math.round(list[i] * 8), Math.round(list[i + 2] * 8), 97) * VARIANTS | 0
  let scratch = new Float32Array(16 * 256), shadowScratch = new Float32Array(16 * 256)
  const upload = (entry: TierMesh, data: Float32Array, count: number) => {
    if (count > entry.capacity) {
      const capacity = 2 ** Math.ceil(Math.log2(count)), next = new THREE.InstancedMesh(entry.mesh.geometry, entry.mesh.material, capacity)
      Object.assign(next, { name: entry.mesh.name, visible: false, frustumCulled: false, castShadow: entry.mesh.castShadow, receiveShadow: entry.mesh.receiveShadow, customDepthMaterial: entry.mesh.customDepthMaterial, customDistanceMaterial: entry.mesh.customDistanceMaterial })
      if (entry.mesh.userData.shadowOnly) shadowOnly(next)
      object.add(next); entry.mesh.removeFromParent(); entry.mesh.dispose()
      entry.mesh = next; entry.capacity = capacity
    }
    ;(entry.mesh.instanceMatrix.array as Float32Array).set(data.subarray(0, count * 16))
    entry.mesh.count = count; entry.mesh.visible = count > 0
    entry.mesh.instanceMatrix.clearUpdateRanges(); entry.mesh.instanceMatrix.addUpdateRange(0, count * 16); entry.mesh.instanceMatrix.needsUpdate = true
  }
  /** Fills a tier with the plants whose distance lies in [low, high] widened by the refresh step, so plants in a tier's
   * vertex work are only those its fade can show until the next refresh. Matrices are composed once per species and
   * variant and copied into each merged part. */
  const fillTier = (tier: Tier, selected: StreamedCell[], camera: THREE.Vector3, low: number, high: number, frustum: THREE.Frustum) => {
    let total = 0
    const groups = new Map<string, TierMesh[]>()
    for (const entry of tiers[tier]) { const key = `${entry.species}:${entry.variant}`; groups.set(key, [...groups.get(key) ?? [], entry]) }
    const inner = Math.max(0, low - REFRESH) ** 2, outer = (high + REFRESH) ** 2
    for (const entries of groups.values()) {
      const { species, variant } = entries[0]
      const prototype = prototypes.get(`${species}:${variant}:${tier}`)!, shadows = tier === 'near' ? shadowTiers.get(`${species}:${variant}`) : undefined
      let index = 0, shadowIndex = 0
      for (const cell of selected) {
        const list = cell.plants[species], variants = cell.variants[species]
        if (!list || !variants) continue
        for (let i = 0, n = 0; i < list.length; i += INSTANCE_STRIDE, n++) {
          if (variants[n] !== variant) continue
          const dx = list[i] - camera.x, dy = list[i + 1] - camera.y, dz = list[i + 2] - camera.z, d = dx * dx + dy * dy + dz * dz
          if (d < inner || d > outer) continue
          sphere.center.set(list[i], list[i + 1] + prototype.height * list[i + 4] / 2, list[i + 2])
          sphere.radius = Math.hypot(prototype.width, prototype.width, prototype.height) * list[i + 4] / 2 + REFRESH + 4
          const visible = frustum.intersectsSphere(sphere)
          if (!visible && !shadows) continue
          rotation.setFromAxisAngle(up, list[i + 3])
          matrix.compose(position.set(list[i], list[i + 1], list[i + 2]), rotation, scale.setScalar(list[i + 4]))
          if (shadows) {
            if ((shadowIndex + 1) * 16 > shadowScratch.length) { const grown = new Float32Array(shadowScratch.length * 2); grown.set(shadowScratch); shadowScratch = grown }
            matrix.toArray(shadowScratch, shadowIndex++ * 16)
          }
          if (!visible) continue
          if ((index + 1) * 16 > scratch.length) { const grown = new Float32Array(scratch.length * 2); grown.set(scratch); scratch = grown }
          matrix.toArray(scratch, index++ * 16)
        }
      }
      for (const entry of entries) upload(entry, scratch, index)
      for (const entry of shadows ?? []) upload(entry, shadowScratch, shadowIndex)
      total += index
    }
    stats[tier] = total
  }
  const rawPlants = new Map<string, CellVegetation>()
  const setCell = (cx: number, cz: number, plants: CellVegetation | null) => {
      if (plants) rawPlants.set(`${cx}:${cz}`, plants); else rawPlants.delete(`${cx}:${cz}`)
      interactions.setCell(cx, cz, plants)
      if (plants) plants = filterPlants(plants, interactions.removed)
      const key = `${cx}:${cz}`
      if (plants) {
        const variants: StreamedCell['variants'] = {}
        for (const [species, list] of Object.entries(plants) as [Species, Float32Array | undefined][]) if (list) variants[species] = Uint8Array.from({ length: list.length / INSTANCE_STRIDE }, (_, n) => variantOf(list, n * INSTANCE_STRIDE))
        cells.set(key, { cx, cz, plants, variants })
      } else cells.delete(key)
      dirty = true
  }
  return {
    object, stats,
    raycast: (ray, range) => interactions.raycast(ray, range),
    obstacles: (x, z) => interactions.obstacles(x, z),
    removePlant(id) {
      interactions.removed.add(id)
      const fields = id.split(':'), x = Number(fields[2]), z = Number(fields[3])
      const cx = Math.floor((x - setup.origin[0]) / VEGETATION_CELL), cz = Math.floor((z - setup.origin[1]) / VEGETATION_CELL)
      const cell = cells.get(`${cx}:${cz}`)
      if (cell) setCell(cell.cx, cell.cz, rawPlants.get(`${cx}:${cz}`)!)
    },
    resetHarvest() {
      interactions.removed.clear()
      for (const [key, plants] of rawPlants) { const [cx, cz] = key.split(':').map(Number); setCell(cx, cz, plants) }
    },
    get materials() { return [...materials] },
    setCell,
    update(camera, renderOrigin, frustum) {
      // Instances are in world coordinates; the group cancels the render origin of its parent.
      object.position.set(-renderOrigin[0], 0, -renderOrigin[1])
      const turned = frustum.planes.some((plane, i) => Math.abs(plane.normal.x - viewNormals[i * 3]) > 0.005 || Math.abs(plane.normal.y - viewNormals[i * 3 + 1]) > 0.005 || Math.abs(plane.normal.z - viewNormals[i * 3 + 2]) > 0.005)
      if (!dirty && !turned && camera.distanceToSquared(lastCamera) < REFRESH * REFRESH) return
      lastCamera.copy(camera)
      frustum.planes.forEach((plane, i) => plane.normal.toArray(viewNormals, i * 3))
      dirty = false
      const origin = setup.origin, all = [...cells.values()]
      const pick = (low: number, high: number) => all.filter((cell) => inRange(cell, camera, low, high, origin))
      const near = pick(0, TIER_RANGES.near * (1 + FADE)), mid = pick(TIER_RANGES.near * (1 - FADE), TIER_RANGES.mid * (1 + FADE)), far = pick(TIER_RANGES.mid * (1 - FADE), TIER_RANGES.far * (1 + FADE))
      fillTier('near', near, camera, 0, TIER_RANGES.near * (1 + FADE), frustum)
      fillTier('mid', mid, camera, TIER_RANGES.near * (1 - FADE), TIER_RANGES.mid * (1 + FADE), frustum)
      fillTier('far', far, camera, TIER_RANGES.mid * (1 - FADE), TIER_RANGES.far * (1 + FADE), frustum)
      stats.rebuilds++
    },
    dispose() {
      for (const list of Object.values(tiers)) for (const entry of list) { entry.mesh.dispose(); entry.mesh.geometry.dispose() }
      for (const entries of shadowTiers.values()) for (const entry of entries) entry.mesh.dispose()
      resources.dispose()
    },
  }
}

export { SPECIES }
