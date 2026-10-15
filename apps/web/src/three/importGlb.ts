import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createNode, MAX_SCENE_BYTES, validateScene, type SceneMaterial, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from './sceneDocument.ts'
import { insertionPosition } from './scenePlacement.ts'

export interface GlbImportResult { document: ThreeSceneDocument; selectedId: string; warnings: string[] }
function inspectHeader(data: ArrayBuffer) {
  if (data.byteLength > 16 * 1024 * 1024) throw new Error('GLB: o limite por arquivo é 16 MB.')
  const view = new DataView(data)
  if (data.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Arquivo GLB 2.0 inválido.')
  const length = view.getUint32(12, true)
  if (20 + length > data.byteLength) throw new Error('Cabeçalho GLB truncado.')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, length)))
  if (json.skins?.length || json.animations?.length) throw new Error('Importe um GLB estático. Skins e clipes nativos ainda não são editáveis neste estúdio.')
  if (json.extensionsRequired?.some((name: string) => /draco|meshopt|basisu/i.test(name))) throw new Error('Este GLB precisa de descompressão. Exporte um GLB sem Draco/Meshopt/KTX2 para importar localmente.')
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some((item: { uri?: string }) => item.uri && !item.uri.startsWith('data:'))) throw new Error('O GLB deve incluir seus buffers e imagens no arquivo; referências externas não são carregadas.')
}
function imageUri(texture: THREE.Texture): string {
  const source = texture.image as CanvasImageSource & { width: number; height: number }
  if (!source?.width || !source?.height || source.width > 4096 || source.height > 4096) throw new Error('A textura GLB é inválida ou excede 4096 pixels.')
  const canvas = document.createElement('canvas')
  const ratio = Math.min(1, 2048 / Math.max(source.width, source.height))
  canvas.width = Math.max(1, Math.round(source.width * ratio)); canvas.height = Math.max(1, Math.round(source.height * ratio))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  const uri = canvas.toDataURL('image/png')
  if (uri.length > 3_000_000) throw new Error('A textura convertida excede 2 MB. Reduza a imagem do GLB.')
  return uri
}
export async function importGlb(data: ArrayBuffer, name: string, doc: ThreeSceneDocument): Promise<GlbImportResult> {
  inspectHeader(data)
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('Referência externa não permitida no GLB.'); return url })
  const gltf = await new GLTFLoader(manager).parseAsync(data, '')
  const warnings = new Set<string>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), images = new Map<THREE.Texture, string>()
  const root = { ...createNode('group'), name: name.replace(/\.glb$/i, '').slice(0, 100) || 'Modelo GLB' }
  const nodes: SceneNode[] = [root]
  gltf.scene.updateMatrixWorld(true)
  try {
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Light || object instanceof THREE.Camera) warnings.add('Luzes e câmeras do GLB não substituem o ambiente e a câmera do editor.')
      if (!(object instanceof THREE.Mesh)) return
      if (object instanceof THREE.SkinnedMesh || object.morphTargetInfluences?.length) throw new Error('O GLB possui deformações não suportadas. Exporte uma malha estática.')
      const geometry = object.geometry
      geometries.add(geometry)
      const materialArray = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materialArray) { materials.add(material); for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value) }
      const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv')
      if (!position) return
      const sourceIndices: number[] = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : Array.from({ length: position.count }, (_, i) => i)
      const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: sourceIndices.length, materialIndex: 0 }]
      for (const group of groups) {
        const sourceMaterial = materialArray[group.materialIndex ?? 0] as THREE.MeshPhysicalMaterial
        if (!sourceMaterial?.color) throw new Error('O GLB usa um material não suportado.')
        if (sourceMaterial.normalMap || sourceMaterial.metalnessMap || sourceMaterial.roughnessMap || sourceMaterial.emissiveMap) warnings.add('Mapas de normal, metalicidade, rugosidade e emissão foram convertidos para os valores escalares do material; o mapa de cor é preservado.')
        const remap = new Map<number, number>(), vertices: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = []
        for (const oldIndex of sourceIndices.slice(group.start, group.start + group.count)) {
          if (!remap.has(oldIndex)) {
            remap.set(oldIndex, vertices.length / 3)
            vertices.push(position.getX(oldIndex), position.getY(oldIndex), position.getZ(oldIndex))
            if (normal) normals.push(normal.getX(oldIndex), normal.getY(oldIndex), normal.getZ(oldIndex))
            if (uv) uvs.push(uv.getX(oldIndex), uv.getY(oldIndex))
          }
          indices.push(remap.get(oldIndex)!)
        }
        const bounds = new THREE.Box3().setFromArray(vertices), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
        const dimensions: Vector3Tuple = [Math.max(0.01, size.x), Math.max(0.01, size.y), Math.max(0.01, size.z)]
        for (let i = 0; i < vertices.length; i += 3) {
          for (let axis = 0; axis < 3; axis++) vertices[i + axis] = (vertices[i + axis] - center.getComponent(axis)) / dimensions[axis]
          if (normals.length) { const n = new THREE.Vector3(normals[i] * dimensions[0], normals[i + 1] * dimensions[1], normals[i + 2] * dimensions[2]).normalize(); normals.splice(i, 3, n.x, n.y, n.z) }
        }
        const world = object.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(center.x, center.y, center.z))
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3()
        world.decompose(pos, quat, scale)
        if (Math.min(scale.x, scale.y, scale.z) <= 0) throw new Error('O GLB contém escala espelhada/degenerada. Aplique as transformações antes de exportar.')
        const reconstructed = new THREE.Matrix4().compose(pos, quat, scale)
        if (world.elements.some((value, index) => Math.abs(value - reconstructed.elements[index]) > 1e-5)) throw new Error('O GLB contém cisalhamento. Aplique as transformações na malha antes de exportar.')
        const rotation = new THREE.Euler().setFromQuaternion(quat)
        const material: SceneMaterial = { color: `#${sourceMaterial.color.getHexString()}`, metalness: sourceMaterial.metalness ?? 0, roughness: sourceMaterial.roughness ?? 0.6,
          opacity: sourceMaterial.opacity ?? 1, transparent: sourceMaterial.transparent, alphaTest: sourceMaterial.alphaTest, doubleSided: sourceMaterial.side === THREE.DoubleSide,
          clearcoat: sourceMaterial.clearcoat ?? 0, transmission: sourceMaterial.transmission ?? 0, emissive: `#${sourceMaterial.emissive?.getHexString() ?? '000000'}`, emissiveIntensity: sourceMaterial.emissiveIntensity ?? 0 }
        if (sourceMaterial.type !== 'MeshStandardMaterial' && sourceMaterial.type !== 'MeshPhysicalMaterial') warnings.add('Materiais não físicos foram convertidos para o material físico do estúdio.')
        if (sourceMaterial.map) {
          const imageSize = sourceMaterial.map.image as { width: number; height: number }
          if (imageSize.width > 2048 || imageSize.height > 2048) warnings.add('Imagens maiores que 2048 px foram reduzidas para limitar memória e tamanho do projeto.')
          if (!images.has(sourceMaterial.map)) images.set(sourceMaterial.map, imageUri(sourceMaterial.map))
          material.textureImage = images.get(sourceMaterial.map)
          const map = sourceMaterial.map
          if (map.channel !== 0 || map.rotation || map.offset.lengthSq() || map.repeat.x !== 1 || map.repeat.y !== 1) warnings.add('Transformações especiais e canais UV alternativos do mapa de cor não foram importados.')
        }
        const node = { ...createNode('mesh', root.id), name: (object.name || 'Malha GLB').slice(0, 120), position: pos.toArray() as Vector3Tuple,
          rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) as Vector3Tuple, dimensions: dimensions.map((value, axis) => Math.max(0.01, value * scale.getComponent(axis))) as Vector3Tuple, material,
          geometry: { ...createNode('mesh').geometry, vertices, indices, normals, uvs } }
        nodes.push(node)
      }
    })
    if (nodes.length === 1) throw new Error('O GLB não contém malhas triangulares importáveis.')
    // Node scale is folded into dimensions; files authored in millimetres or kilometres are rescaled uniformly into the studio limits.
    const largest = Math.max(...nodes.slice(1).flatMap((node) => [...node.dimensions, ...node.position.map(Math.abs).map((value) => value / 10)]))
    if (largest > 1000) {
      const factor = 1000 / largest
      for (const node of nodes.slice(1)) { node.dimensions = node.dimensions.map((value) => Math.max(0.01, value * factor)) as Vector3Tuple; node.position = node.position.map((value) => value * factor) as Vector3Tuple }
      gltf.scene.scale.multiplyScalar(factor); gltf.scene.updateMatrixWorld(true)
      warnings.add(`O modelo excedia 1.000 m e foi reduzido uniformemente (fator ${factor.toPrecision(3)}).`)
    }
    const bounds = new THREE.Box3().setFromObject(gltf.scene)
    root.position = [0, -bounds.min.y, 0]
    root.position = insertionPosition(doc, root, nodes)
    const document = validateScene({ ...doc, nodes: [...doc.nodes, ...nodes] })
    if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_SCENE_BYTES) throw new Error('O projeto convertido excede 32 MB. Reduza a malha/texturas.')
    return { document, selectedId: root.id, warnings: [...warnings] }
  } finally {
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    for (const texture of textures) { texture.dispose(); const image = texture.image as { close?: () => void }; image?.close?.() }
  }
}
