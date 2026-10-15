import * as THREE from 'three'
import { buildNodeGeometry, geometryKey } from './sceneGeometry.ts'
import { proceduralTexture } from './sceneTextures.ts'
import { hasSurface, subtreeIds, type SceneNode, type ThreeSceneDocument } from './sceneDocument.ts'
import { createShadowScheduler } from './sceneShadows.ts'
import { prepareTerrainLayers, usesTerrainLayers } from './sceneTerrainMaterial.ts'

export const HELPER_LAYER = 1
const MIN_BATCH = 3
const unitScale = new THREE.Vector3()

export interface SceneResources {
  geometry: (node: SceneNode) => THREE.BufferGeometry
  material: (node: SceneNode, wireframe: boolean) => THREE.MeshPhysicalMaterial
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
    material(node, wireframe) {
      const aspect = node.kind === 'text' ? Math.round(node.dimensions[0] / node.dimensions[1] * 4) / 4 : 0
      const biome = node.kind === 'terrain' && !!node.geometry.biome && node.geometry.biome !== 'none'
      const layered=usesTerrainLayers(node)
      const key = JSON.stringify([node.material, wireframe, node.kind === 'text' ? [node.geometry.text, aspect] : node.kind === 'tube', biome,layered?node.geometry.biome:null])
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
      finishTerrain?.(material)
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
  updateShadows: (focus:THREE.Vector3) => void
  dispose: () => void
}
export function surfaceMatrix(holder: THREE.Object3D, node: SceneNode, target = new THREE.Matrix4()): THREE.Matrix4 {
  return target.copy(holder.matrixWorld).scale(unitScale.fromArray(node.dimensions))
}

/** Builds the render graph. Static repeated surfaces become one InstancedMesh per geometry/material. */
export function buildScene(doc: ThreeSceneDocument, resources: SceneResources, options: { instancing: boolean; helpers: boolean }): BuiltScene {
  resources.begin()
  const root = new THREE.Group(), holders = new Map<string, THREE.Object3D>(), meshes = new Map<string, THREE.Mesh>()
  const instances = new Map<string, { mesh: THREE.InstancedMesh; index: number }>(), lights = new Map<string, THREE.PointLight | THREE.SpotLight>()
  const pickables: THREE.Object3D[] = [], helperResources: { dispose: () => void }[] = [], byId = new Map(doc.nodes.map((node) => [node.id, node]))
  const dynamic = new Set<string>()
  for (const node of doc.nodes) {
    if (node.animation.kind !== 'none' || node.interaction?.action === 'collect' || node.behavior?.type === 'enemy') for (const id of subtreeIds(doc.nodes, node.id)) dynamic.add(id)
    if (node.interaction?.action === 'toggleVisibility') for (const id of subtreeIds(doc.nodes, node.interaction.targetId ?? node.id)) dynamic.add(id)
  }
  const hiddenChain = (node: SceneNode): boolean => !node.visible || (!!node.parentId && hiddenChain(byId.get(node.parentId)!))
  const batches = new Map<string, SceneNode[]>()
  if (options.instancing) for (const node of doc.nodes) {
    const transparent = node.material.transparent || (node.material.opacity ?? 1) < 1 || (node.material.transmission ?? 0) > 0
    if (!hasSurface(node.kind) || node.kind === 'text' || dynamic.has(node.id) || node.interaction || transparent || hiddenChain(node)) continue
    const key = `${geometryKey(node)}|${JSON.stringify(node.material)}`
    batches.set(key, [...batches.get(key) ?? [], node])
  }
  const batched = new Set([...batches.values()].filter((nodes) => nodes.length >= MIN_BATCH).flat().map((node) => node.id))
  const collected=new Set(doc.nodes.filter(node=>node.interaction?.action==='collect').flatMap(node=>[...subtreeIds(doc.nodes,node.id)]))
  for (const node of doc.nodes) {
    const holder = node.kind === 'group' ? new THREE.Group() : new THREE.Object3D()
    holder.position.fromArray(node.position)
    holder.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
    holder.scale.fromArray(node.scale)
    holder.visible = node.visible
    holder.name = node.name
    holder.userData.nodeId = node.id
    if (hasSurface(node.kind) && !batched.has(node.id)) {
      const mesh = new THREE.Mesh(resources.geometry(node), resources.material(node, doc.environment.wireframe))
      mesh.scale.fromArray(node.dimensions)
      mesh.castShadow = node.kind !== 'text' && !collected.has(node.id) && !(node.material.transparent && (node.material.opacity ?? 1) < 0.5)
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
  for (const nodes of batches.values()) {
    if (nodes.length < MIN_BATCH) continue
    const mesh = new THREE.InstancedMesh(resources.geometry(nodes[0]), resources.material(nodes[0], doc.environment.wireframe), nodes.length)
    mesh.castShadow = true
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
  resources.prune()
  const shadowScheduler=createShadowScheduler([...lights].filter(([id])=>byId.get(id)?.light?.castShadow).map(([id,light])=>({id,light})),
    doc.nodes.filter(node=>hasSurface(node.kind)&&node.kind!=='text'&&!collected.has(node.id)&&!(node.material.transparent&&(node.material.opacity??1)<0.5)).map(node=>({id:node.id,object:holders.get(node.id)!,dimensions:node.dimensions})))
  return { root, holders, meshes, instances, lights, pickables, dynamic, sync,updateShadows:focus=>{root.updateWorldMatrix(true,true);shadowScheduler.update(focus)},
    dispose() { shadowScheduler.dispose();for (const mesh of batchMeshes) mesh.dispose(); for (const resource of helperResources) resource.dispose(); for (const light of lights.values()) light.dispose() } }
}

export function pickNodeId(intersection: THREE.Intersection): string | null {
  const object = intersection.object
  if (object instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) return (object.userData.nodeIds as string[])[intersection.instanceId] ?? null
  return (object.userData.nodeId as string | undefined) ?? null
}
