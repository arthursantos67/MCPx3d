import * as THREE from 'three'
import { buildNodeGeometry, geometryKey } from './sceneGeometry.ts'
import { proceduralTexture } from './sceneTextures.ts'
import { isCharacterType } from './sceneCharacters.ts'
import { hasSurface, subtreeIds, type SceneNode, type ThreeSceneDocument } from './sceneDocument.ts'
import { createShadowScheduler } from './sceneShadows.ts'
import { prepareTerrainLayers, usesTerrainLayers } from './sceneTerrainMaterial.ts'
import type { CharacterSkin } from './sceneRuntimeTypes.ts'

export const HELPER_LAYER = 1
export function pickVisible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object.userData.skinProxy ? object.parent : object; current; current = current.parent) if (!current.visible) return false
  return true
}
const MIN_BATCH = 3
/** Translucent glowing surfaces (flames, energy) emit light rather than block it, and small glowing ones (fireflies, bulbs, gems) leave imperceptible shadows.
 * Letting them cast would force animated fire and fireflies to redraw a nearby light's cube shadow every frame. */
const castsShadow = (node: SceneNode, collected: Set<string>) => {
  const { transparent, opacity = 1, emissive = '#000000', emissiveIntensity = 0 } = node.material
  const glowing = emissiveIntensity >= 1 && emissive !== '#000000'
  return node.kind !== 'text' && !collected.has(node.id) && !(transparent && opacity < 0.5) && !(glowing && (transparent || Math.max(...node.dimensions) < 0.25))
}
const unitScale = new THREE.Vector3()

export interface SceneResources {
  geometry: (node: SceneNode) => THREE.BufferGeometry
  /** `variant` yields a separate cached material (e.g. wind-animated vegetation) prepared once by `prepare`. */
  material: (node: SceneNode, wireframe: boolean, variant?: string, prepare?: (material: THREE.MeshPhysicalMaterial) => void) => THREE.MeshPhysicalMaterial
  begin: () => void
  prune: () => void
  dispose: () => void
}
function textTexture(text: string, aspect: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = Math.round(THREE.MathUtils.clamp(1024 / aspect, 64, 1024))
  const context = canvas.getContext('2d')!
  let size = canvas.height, lines: string[] = []
  for (; size > 10; size = Math.floor(size * 0.9)) {
    context.font = `700 ${size}px system-ui, "Segoe UI", sans-serif`
    lines = []
    for (const paragraph of text.split('\n')) {
      let line = ''
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word
        if (context.measureText(next).width > canvas.width * 0.94 && line) { lines.push(line); line = word } else line = next
      }
      lines.push(line)
    }
    if (lines.length * size * 1.15 <= canvas.height * 0.94 && lines.every((line) => context.measureText(line).width <= canvas.width * 0.96)) break
  }
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  lines.forEach((line, index) => context.fillText(line, canvas.width / 2, canvas.height / 2 + (index - (lines.length - 1) / 2) * size * 1.15))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Reuses GPU resources by parameters and disposes the ones the last build no longer used. */
export function createResources(anisotropy = 8): SceneResources {
  const geometries = new Map<string, THREE.BufferGeometry>(), materials = new Map<string, THREE.MeshPhysicalMaterial>(), textures = new Map<string, THREE.Texture>()
  let usedGeometries = new Set<string>(), usedMaterials = new Set<string>()
  const texture = (key: string, create: () => THREE.Texture) => {
    if (!textures.has(key)) { const value = create(); value.anisotropy = Math.max(value.anisotropy, anisotropy); textures.set(key, value) }
    return textures.get(key)!
  }
  return {
    geometry(node) {
      const key = geometryKey(node)
      usedGeometries.add(key)
      if (!geometries.has(key)) geometries.set(key, buildNodeGeometry(node))
      return geometries.get(key)!
    },
    material(node, wireframe, variant, prepare) {
      const aspect = node.kind === 'text' ? Math.round(node.dimensions[0] / node.dimensions[1] * 4) / 4 : 0
      const biome = node.kind === 'terrain' && !!node.geometry.biome && node.geometry.biome !== 'none'
      const layered=usesTerrainLayers(node)
      const key = JSON.stringify([node.material, wireframe, node.kind === 'text' ? [node.geometry.text, aspect] : node.kind === 'tube', biome,layered?node.geometry.biome:null, variant ?? null])
      usedMaterials.add(key)
      if (materials.has(key)) return materials.get(key)!
      const { texture: kind, textureScale = 1, textureImage, doubleSided, normalStrength = 1, sheen = 0, ...physical } = node.material
      const parameters: THREE.MeshPhysicalMaterialParameters = { ...physical, vertexColors: biome, sheen, sheenColor: sheen ? physical.color : '#000000', wireframe,
        transparent: physical.transparent || (physical.opacity ?? 1) < 1, depthWrite: !physical.transparent && (physical.opacity ?? 1) >= 1,
        side: doubleSided || node.kind === 'tube' || node.kind === 'text' || node.kind === 'plane' || node.kind === 'terrain' ? THREE.DoubleSide : THREE.FrontSide }
      let finishTerrain:((material:THREE.MeshPhysicalMaterial)=>void)|undefined
      if(layered) finishTerrain=prepareTerrainLayers(node,parameters,(kind,channel)=>texture(`terrain:${kind}:${channel}`,()=>proceduralTexture(kind,channel)))
      else if (node.kind === 'text') Object.assign(parameters, { map: texture(`text:${node.geometry.text}:${aspect}`, () => textTexture(node.geometry.text, aspect)), transparent: true, alphaTest: Math.max(0.05, physical.alphaTest ?? 0), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
      else if (textureImage) {
        const map = texture(textureImage, () => { const loaded = new THREE.TextureLoader().load(textureImage); loaded.colorSpace = THREE.SRGBColorSpace; loaded.flipY = false; loaded.userData.dataUrl = textureImage; return loaded })
        parameters.map = map
      } else if (kind && kind !== 'none') {
        parameters.map = texture(`${kind}:${textureScale}:map`, () => proceduralTexture(kind, 'map', textureScale))
        parameters.normalMap = texture(`${kind}:${textureScale}:normal`, () => proceduralTexture(kind, 'normal', textureScale))
        parameters.roughnessMap = texture(`${kind}:${textureScale}:rough`, () => proceduralTexture(kind, 'rough', textureScale))
        parameters.normalScale = new THREE.Vector2(normalStrength, normalStrength)
      }
      const material = new THREE.MeshPhysicalMaterial(parameters)
      if (kind === 'water' && !textureImage && !layered) material.userData.water = true
      finishTerrain?.(material)
      if (variant) prepare?.(material)
      materials.set(key, material)
      return material
    },
    begin() { usedGeometries = new Set(); usedMaterials = new Set() },
    prune() {
      for (const [key, geometry] of geometries) if (!usedGeometries.has(key)) { geometry.dispose(); geometries.delete(key) }
      for (const [key, material] of materials) if (!usedMaterials.has(key)) { material.dispose(); materials.delete(key) }
      const active = new Set([...materials.values()].flatMap((material) => [material.map, material.normalMap, material.roughnessMap,...(material.userData.terrainTextures??[])].filter((value): value is THREE.Texture => !!value)))
      for (const [key, value] of textures) if (!active.has(value)) { value.dispose(); textures.delete(key) }
    },
    dispose() {
      for (const geometry of geometries.values()) geometry.dispose()
      for (const material of materials.values()) material.dispose()
      for (const value of textures.values()) value.dispose()
      geometries.clear(); materials.clear(); textures.clear()
    },
  }
}

export interface BuiltScene {
  root: THREE.Group
  holders: Map<string, THREE.Object3D>
  meshes: Map<string, THREE.Mesh>
  instances: Map<string, { mesh: THREE.InstancedMesh; index: number }>
  lights: Map<string, THREE.PointLight | THREE.SpotLight>
  pickables: THREE.Object3D[]
  /** Nodes whose transform or visibility may change in play mode, including descendants. */
  dynamic: Set<string>
  /** Recomputes instance matrices; suppressed instances collapse while a regular proxy replaces them. */
  sync: (suppressed?: Set<string>) => void
  /** Expects current world matrices. */
  updateShadows: (focus:THREE.Vector3) => void
  /** Continuous skinned bodies by character root id; their rigid proxies stay in `meshes` but are hidden. */
  skins: Map<string, CharacterSkin>
  dispose: () => void
}
export interface BuildOptions {
  instancing: boolean; helpers: boolean
  /** Material variant for a node (null = shared material) and its one-time preparation. */
  variant?: (node: SceneNode) => { key: string; prepare: (material: THREE.MeshPhysicalMaterial) => void; depth?: () => THREE.Material } | null
  /** Replaces the cached geometry of a node (e.g. tessellated water). */
  geometry?: (node: SceneNode) => THREE.BufferGeometry | null
  skins?: (doc: ThreeSceneDocument, holders: Map<string, THREE.Object3D>) => CharacterSkin[]
}
const CHUNKS_PER_AXIS = 4, MIN_CHUNK = 24, CHUNKED_TRIANGLES = 30000
const chunkPoint = new THREE.Vector3()
/** Splits a heavy batch spread over a large area into up to 4×4 cells, so the camera and the sun's shadow camera can cull the parts out of view. Light batches stay one draw call. */
function spatialChunks(nodes: SceneNode[], holders: Map<string, THREE.Object3D>, geometry: THREE.BufferGeometry): SceneNode[][] {
  if (nodes.length * (geometry.index?.count ?? geometry.attributes.position.count) / 3 < CHUNKED_TRIANGLES) return [nodes]
  const points = nodes.map((node) => holders.get(node.id)!.getWorldPosition(chunkPoint).clone())
  const min = points.reduce((a, p) => a.min(p), points[0].clone()), max = points.reduce((a, p) => a.max(p), points[0].clone())
  const cell = Math.max(MIN_CHUNK, (max.x - min.x) / CHUNKS_PER_AXIS, (max.z - min.z) / CHUNKS_PER_AXIS)
  if (max.x - min.x <= cell && max.z - min.z <= cell) return [nodes]
  const cells = new Map<string, SceneNode[]>()
  nodes.forEach((node, i) => {
    const key = `${Math.min(CHUNKS_PER_AXIS - 1, Math.floor((points[i].x - min.x) / cell))},${Math.min(CHUNKS_PER_AXIS - 1, Math.floor((points[i].z - min.z) / cell))}`
    cells.set(key, [...cells.get(key) ?? [], node])
  })
  return [...cells.values()]
}
export function surfaceMatrix(holder: THREE.Object3D, node: SceneNode, target = new THREE.Matrix4()): THREE.Matrix4 {
  return target.copy(holder.matrixWorld).scale(unitScale.fromArray(node.dimensions))
}

/** Builds the render graph. Static repeated surfaces become one InstancedMesh per geometry/material. */
export function buildScene(doc: ThreeSceneDocument, resources: SceneResources, options: BuildOptions): BuiltScene {
  const steps = buildSceneSteps(doc, resources, options)
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value
}

/**
 * The same build as `buildScene`, paused at regular points (every few nodes, before instancing and between character
 * skins) so a caller can spread a large scene over several frames. Running it to completion gives the same result.
 */
export function* buildSceneSteps(doc: ThreeSceneDocument, resources: SceneResources, options: BuildOptions): Generator<void, BuiltScene> {
  resources.begin()
  const root = new THREE.Group(), holders = new Map<string, THREE.Object3D>(), meshes = new Map<string, THREE.Mesh>()
  const instances = new Map<string, { mesh: THREE.InstancedMesh; index: number }>(), lights = new Map<string, THREE.PointLight | THREE.SpotLight>()
  const pickables: THREE.Object3D[] = [], helperResources: { dispose: () => void }[] = [], byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const dynamic = new Set<string>()
  for (const node of doc.nodes) {
    if (node.resource || node.animation.kind !== 'none' || ['collect', 'heal', 'powerup'].includes(node.interaction?.action ?? '') || node.behavior?.type === 'enemy' || node.behavior?.type === 'npc') for (const id of subtreeIds(doc.nodes, node.id)) dynamic.add(id)
    if (node.interaction?.action === 'toggleVisibility') for (const id of subtreeIds(doc.nodes, node.interaction.targetId ?? node.id)) dynamic.add(id)
  }
  const characters = new Set(doc.nodes.filter((node) => node.asset && isCharacterType(node.asset.type)).flatMap((node) => [...subtreeIds(doc.nodes, node.id)]))
  const variants = new Map(doc.nodes.map((node) => [node.id, hasSurface(node.kind) ? options.variant?.(node) ?? null : null]))
  // Instanced and regular meshes never share a material: alternating between them makes the renderer re-derive the program on every draw.
  const material = (node: SceneNode, instanced = false) => { const variant = variants.get(node.id); return resources.material(node, doc.environment.wireframe, instanced ? `${variant?.key ?? ''}#instanced` : variant?.key, variant?.prepare) }
  const geometry = (node: SceneNode) => options.geometry?.(node) ?? resources.geometry(node)
  const hiddenChain = (node: SceneNode): boolean => !node.visible || (!!node.parentId && hiddenChain(byId.get(node.parentId)!))
  const batches = new Map<string, SceneNode[]>()
  if (options.instancing) for (const node of doc.nodes) {
    const transparent = node.material.transparent || (node.material.opacity ?? 1) < 1 || (node.material.transmission ?? 0) > 0
    if (!hasSurface(node.kind) || node.kind === 'text' || dynamic.has(node.id) || characters.has(node.id) || node.interaction || transparent || hiddenChain(node) || options.geometry?.(node)) continue
    const key = `${geometryKey(node)}|${JSON.stringify(node.material)}|${variants.get(node.id)?.key ?? ''}`
    batches.set(key, [...batches.get(key) ?? [], node])
  }
  const batched = new Set([...batches.values()].filter((nodes) => nodes.length >= MIN_BATCH).flat().map((node) => node.id))
  const collected=new Set(doc.nodes.filter(node=>node.interaction?.action==='collect').flatMap(node=>[...subtreeIds(doc.nodes,node.id)]))
  yield
  let built = 0
  for (const node of doc.nodes) {
    if (++built % 24 === 0) yield
    const holder = node.kind === 'group' ? new THREE.Group() : new THREE.Object3D()
    holder.position.fromArray(node.position)
    holder.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
    holder.scale.fromArray(node.scale)
    holder.visible = node.visible
    holder.name = node.name
    holder.userData.nodeId = node.id
    if (hasSurface(node.kind) && !batched.has(node.id)) {
      const mesh = new THREE.Mesh(geometry(node), material(node))
      const depth = variants.get(node.id)?.depth?.()
      if (depth) mesh.customDepthMaterial = depth
      mesh.scale.fromArray(node.dimensions)
      mesh.castShadow = castsShadow(node, collected)
      mesh.receiveShadow = true
      mesh.userData.nodeId = node.id
      mesh.name = node.name
      holder.add(mesh)
      meshes.set(node.id, mesh)
      pickables.push(mesh)
    }
    if (node.kind === 'light' && node.light) {
      const spec = node.light
      const light = spec.type === 'spot'
        ? new THREE.SpotLight(spec.color, spec.intensity, spec.distance, THREE.MathUtils.degToRad(spec.angle), spec.penumbra, 2)
        : new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2)
      if (light instanceof THREE.SpotLight) { light.rotation.x = -Math.PI / 2; light.target.position.set(0, 0, -1); light.add(light.target) }
      light.userData.nodeId = node.id
      holder.add(light)
      lights.set(node.id, light)
      if (options.helpers) {
        const geometry = new THREE.OctahedronGeometry(0.5, 0), material = new THREE.MeshBasicMaterial({ color: spec.color, wireframe: true, fog: false })
        const helper = new THREE.Mesh(geometry, material)
        helper.scale.fromArray(node.dimensions)
        helper.layers.set(HELPER_LAYER)
        helper.userData.nodeId = node.id
        holder.add(helper)
        pickables.push(helper)
        helperResources.push(geometry, material)
      }
    }
    holders.set(node.id, holder)
  }
  for (const node of doc.nodes) (holders.get(node.parentId ?? '') ?? root).add(holders.get(node.id)!)
  const batchMeshes: THREE.InstancedMesh[] = []
  yield
  root.updateMatrixWorld(true)
  for (const nodes of [...batches.values()].filter((group) => group.length >= MIN_BATCH).flatMap((group) => spatialChunks(group, holders, resources.geometry(group[0])))) {
    const mesh = new THREE.InstancedMesh(resources.geometry(nodes[0]), material(nodes[0], true), nodes.length)
    const depth = variants.get(nodes[0].id)?.depth?.()
    if (depth) mesh.customDepthMaterial = depth
    mesh.castShadow = castsShadow(nodes[0], collected)
    mesh.receiveShadow = true
    mesh.userData.nodeIds = nodes.map((node) => node.id)
    mesh.name = `${nodes[0].name} ×${nodes.length}`
    nodes.forEach((node, index) => instances.set(node.id, { mesh, index }))
    root.add(mesh)
    batchMeshes.push(mesh)
    pickables.push(mesh)
  }
  const matrix = new THREE.Matrix4(), collapsed = new THREE.Matrix4().makeScale(0, 0, 0)
  const sync = (suppressed: Set<string> = new Set()) => {
    root.updateMatrixWorld(true)
    const inverse = root.matrixWorld.clone().invert()
    for (const [id, { mesh, index }] of instances) mesh.setMatrixAt(index, suppressed.has(id) ? collapsed : inverse.clone().multiply(surfaceMatrix(holders.get(id)!, byId.get(id)!, matrix)))
    for (const mesh of batchMeshes) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere() }
  }
  sync()
  const skins = new Map<string, CharacterSkin>()
  if (options.skins) {
    yield
    root.updateMatrixWorld(true)
    for (const skin of options.skins(doc, holders)) {
      skins.set(skin.rootId, skin)
      for (const id of skin.hidden) { const mesh = meshes.get(id); if (mesh) { mesh.visible = false; mesh.castShadow = false; mesh.userData.skinProxy = true; mesh.userData.skinRoot = skin.rootId } }
    }
  }
  // Static parts keep their local matrices, and wholly static subtrees are skipped by per-frame world updates; only what can move is recomposed.
  const fixed = (node: SceneNode) => !dynamic.has(node.id) && !characters.has(node.id)
  const children = new Map<string, SceneNode[]>()
  for (const node of doc.nodes) if (node.parentId) children.set(node.parentId, [...children.get(node.parentId) ?? [], node])
  const settled = new Map<string, boolean>()
  const frozen = (node: SceneNode): boolean => {
    if (!settled.has(node.id)) settled.set(node.id, fixed(node) && (children.get(node.id) ?? []).every(frozen))
    return settled.get(node.id)!
  }
  for (const node of doc.nodes) if (fixed(node)) {
    for (const object of [holders.get(node.id)!, meshes.get(node.id)]) if (object) { object.matrixAutoUpdate = false; object.updateMatrix() }
    if (frozen(node)) holders.get(node.id)!.matrixWorldAutoUpdate = false
  }
  root.updateMatrixWorld(true)
  resources.prune()
  const shadowScheduler=createShadowScheduler([...lights].filter(([id])=>byId.get(id)?.light?.castShadow).map(([id,light])=>({id,light})),
    doc.nodes.filter(node=>hasSurface(node.kind)&&castsShadow(node,collected)&&meshes.get(node.id)?.visible!==false).map(node=>({id:node.id,object:holders.get(node.id)!,dimensions:node.dimensions})))
  return { root, holders, meshes, instances, lights, pickables, dynamic, sync, skins,updateShadows:focus=>{shadowScheduler.update(focus)},
    dispose() { shadowScheduler.dispose();for (const skin of skins.values()) { skin.object.removeFromParent(); skin.dispose() };for (const mesh of batchMeshes) mesh.dispose(); for (const resource of helperResources) resource.dispose(); for (const light of lights.values()) light.dispose() } }
}

export function pickNodeId(intersection: THREE.Intersection): string | null {
  const object = intersection.object
  if (typeof object.userData.skinRoot === 'string') return object.userData.skinRoot
  if (object instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) return (object.userData.nodeIds as string[])[intersection.instanceId] ?? null
  return (object.userData.nodeId as string | undefined) ?? null
}
