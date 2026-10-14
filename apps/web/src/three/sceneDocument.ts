import { insertionPosition } from './scenePlacement.ts'
import { defaultGeometry, estimateTriangles, MAX_SCENE_TRIANGLES, validateGeometry, type GeometrySpec } from './sceneGeometrySpec.ts'
export type Vector3Tuple = [number, number, number]
export type NodeKind = 'group' | 'box' | 'sphere' | 'cylinder' | 'torus' | 'roundedBox' | 'cone' | 'torusKnot' | 'extrude' | 'lathe' | 'tube' | 'mesh'
export interface SceneMaterial { color: string; metalness: number; roughness: number; clearcoat?: number; transmission?: number; emissive?: string; emissiveIntensity?: number; texture?: 'none' | 'metal' | 'concrete' | 'wood' | 'solar' | 'tiles'; textureScale?: number; textureImage?: string; opacity?: number; transparent?: boolean; doubleSided?: boolean; alphaTest?: number }
export interface SceneAnimation { kind: 'none' | 'spin' | 'float' | 'orbit'; axis: 'x' | 'y' | 'z'; duration: number; amplitude: number; phase: number }
export const defaultAnimation = (): SceneAnimation => ({ kind: 'none', axis: 'y', duration: 6, amplitude: 0.5, phase: 0 })
export interface SceneNode {
  id: string
  parentId: string | null
  name: string
  kind: NodeKind
  visible: boolean
  position: Vector3Tuple
  rotation: Vector3Tuple
  scale: Vector3Tuple
  dimensions: Vector3Tuple
  material: SceneMaterial
  animation: SceneAnimation
  geometry: GeometrySpec
  overlapWith: string[]
}
export interface ThreeSceneDocument {
  version: '1.1'
  name: string
  timeline: { duration: number }
  nodes: SceneNode[]
  environment: { background: string; exposure: number; lightIntensity: number; grid: boolean; wireframe: boolean; shadows?: boolean; reflections?: boolean }
}
export const MAX_SCENE_NODES = 500
export const MAX_SCENE_BYTES = 32 * 1024 * 1024
export const SCENE_STORAGE_KEY = 'modeler:three-scene:v1'
export const nodeLabels: Record<NodeKind, string> = { group: 'Grupo', box: 'Caixa', sphere: 'Esfera', cylinder: 'Cilindro', torus: 'Toro', roundedBox: 'Caixa arredondada', cone: 'Cone', torusKnot: 'Nó toroidal', extrude: 'Perfil extrudado', lathe: 'Perfil de revolução', tube: 'Tubo por curva', mesh: 'Malha triangular' }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Esperado um objeto JSON.')
  return value as Record<string, unknown>
}
function text(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field}: texto obrigatório de até ${max} caracteres.`)
  return value
}
function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field}: use um número entre ${min} e ${max}.`)
  return value
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field}: esperado verdadeiro ou falso.`)
  return value
}
function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Cor inválida. Use #RRGGBB.')
  return value
}
function vector(value: unknown, field: string, min: number, max: number): Vector3Tuple {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${field}: esperado vetor XYZ.`)
  return Array.from(value, (v) => number(v, field, min, max)) as Vector3Tuple
}

export function validateAnimation(value: unknown): SceneAnimation {
  if (value === undefined) return defaultAnimation()
  const animation = record(value)
  if (!['none', 'spin', 'float', 'orbit'].includes(animation.kind as string)) throw new Error('Tipo de animação desconhecido.')
  if (!['x', 'y', 'z'].includes(animation.axis as string)) throw new Error('Eixo de animação inválido.')
  return { kind: animation.kind as SceneAnimation['kind'], axis: animation.axis as SceneAnimation['axis'],
    duration: number(animation.duration, 'Período', 1, 120), amplitude: number(animation.amplitude, 'Amplitude', 0, 100), phase: number(animation.phase, 'Fase', 0, 360) }
}

export function validateMaterial(value: unknown): SceneMaterial {
  const material = record(value)
  const texture = material.texture ?? 'none'
  if (!['none', 'metal', 'concrete', 'wood', 'solar', 'tiles'].includes(texture as string)) throw new Error('Textura procedural desconhecida.')
  const image = material.textureImage ?? ''
  if (typeof image !== 'string' || image.length > 3_000_000 || (image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image))) throw new Error('Imagem de material inválida ou maior que 2 MB.')
  return { color: color(material.color), metalness: number(material.metalness, 'Metalicidade', 0, 1), roughness: number(material.roughness, 'Rugosidade', 0, 1),
    clearcoat: number(material.clearcoat ?? 0, 'Verniz', 0, 1), transmission: number(material.transmission ?? 0, 'Transmissão', 0, 1),
    emissive: color(material.emissive ?? '#000000'), emissiveIntensity: number(material.emissiveIntensity ?? 0, 'Emissão', 0, 10),
    opacity: number(material.opacity ?? 1, 'Opacidade', 0, 1), transparent: boolean(material.transparent ?? false, 'Transparência'), doubleSided: boolean(material.doubleSided ?? false, 'Dupla face'), alphaTest: number(material.alphaTest ?? 0, 'Recorte alpha', 0, 1),
    texture: texture as SceneMaterial['texture'], textureScale: number(material.textureScale ?? 1, 'Repetição de textura', 0.1, 32), textureImage: image }
}

/** Returns only declared data; never deserializes Three.js objects or executable code. */
export function validateScene(value: unknown): ThreeSceneDocument {
  const doc = record(value)
  if (doc.version !== '1.0' && doc.version !== '1.1') throw new Error('Versão de projeto incompatível. Esperado ThreeSceneDocument 1.0/1.1.')
  if (!Array.isArray(doc.nodes) || doc.nodes.length > MAX_SCENE_NODES) throw new Error(`A cena aceita até ${MAX_SCENE_NODES} nós.`)
  const nodes: SceneNode[] = doc.nodes.map((value) => {
    const node = record(value), material = record(node.material)
    if (typeof node.kind !== 'string' || !Object.hasOwn(nodeLabels, node.kind)) throw new Error('Tipo de objeto desconhecido.')
    if (node.parentId !== null && typeof node.parentId !== 'string') throw new Error('Referência de grupo inválida.')
    return {
      id: text(node.id, 'ID'), parentId: node.parentId as string | null, name: text(node.name, 'Nome'), kind: node.kind as NodeKind,
      visible: boolean(node.visible, 'Visibilidade'), position: vector(node.position, 'Posição', -10000, 10000),
      rotation: vector(node.rotation, 'Rotação', -360, 360), scale: vector(node.scale, 'Escala', 0.01, 100),
      dimensions: vector(node.dimensions, 'Dimensões', 0.01, 1000),
      animation: validateAnimation(node.animation),
      geometry: validateGeometry(node.geometry, node.kind),
      overlapWith: node.overlapWith === undefined ? [] : (() => { if (!Array.isArray(node.overlapWith) || node.overlapWith.length > 32) throw new Error('Até 32 contatos intencionais por objeto.'); return Array.from(new Set(node.overlapWith.map((v) => text(v, 'Contato')))) })(),
      material: validateMaterial(material),
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('IDs duplicados na cena.')
  if (nodes.reduce((sum, node) => sum + estimateTriangles(node.kind, node.geometry), 0) > MAX_SCENE_TRIANGLES) throw new Error('A cena excede o orçamento de 2 milhões de triângulos. Reduza a tesselação ou a quantidade de objetos.')
  for (const node of nodes) {
    if (node.overlapWith.some((id) => id === node.id || !byId.has(id))) throw new Error('Contato intencional referencia ID inválido.')
    const seen = new Set([node.id])
    let parentId = node.parentId
    while (parentId !== null) {
      if (seen.has(parentId)) throw new Error('A hierarquia não pode conter ciclos.')
      seen.add(parentId)
      if (seen.size > 12) throw new Error('A hierarquia aceita até 12 níveis.')
      const parent = byId.get(parentId)
      if (!parent || parent.kind !== 'group') throw new Error('O pai precisa ser um grupo existente.')
      parentId = parent.parentId
    }
  }
  const env = record(doc.environment)
  return { version: '1.1', name: text(doc.name, 'Nome do projeto'), nodes,
    timeline: { duration: doc.timeline === undefined ? 20 : number(record(doc.timeline).duration, 'Duração da timeline', 1, 120) },
    environment: { background: color(env.background), exposure: number(env.exposure, 'Exposição', 0.1, 3),
      lightIntensity: number(env.lightIntensity, 'Luz', 0, 5), grid: boolean(env.grid, 'Grade'), wireframe: boolean(env.wireframe, 'Wireframe'), shadows: env.shadows === undefined ? true : boolean(env.shadows, 'Sombras'), reflections: env.reflections === undefined ? true : boolean(env.reflections, 'Reflexões') } }
}
export function parseScene(source: string): ThreeSceneDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_SCENE_BYTES) throw new Error('O projeto excede o limite de 32 MB.')
  return validateScene(JSON.parse(source))
}
export function createNode(kind: NodeKind, parentId: string | null = null): SceneNode {
  return { id: crypto.randomUUID(), parentId, name: nodeLabels[kind], kind, visible: true,
    position: [0, kind === 'group' ? 0 : 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
    animation: defaultAnimation(), geometry: defaultGeometry(kind), overlapWith: [],
    material: validateMaterial({ color: '#348c96', metalness: 0.2, roughness: 0.45 }) }
}
export function createEmptyScene(): ThreeSceneDocument {
  return { version: '1.1', name: 'Nova cena', nodes: [], timeline: { duration: 20 },
    environment: { background: '#e8eef3', exposure: 1.2, lightIntensity: 1.5, grid: true, wireframe: false, shadows: true, reflections: true } }
}
export function subtreeIds(nodes: SceneNode[], id: string): Set<string> {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true }
  }
  return ids
}
export function duplicateSubtree(doc: ThreeSceneDocument, id: string): { document: ThreeSceneDocument; selectedId: string } {
  const root = doc.nodes.find((node) => node.id === id)
  if (!root) throw new Error('Objeto não encontrado.')
  const ids = subtreeIds(doc.nodes, id)
  const replacements = new Map([...ids].map((key) => [key, crypto.randomUUID()]))
  const copies = doc.nodes.filter((node) => ids.has(node.id)).map((node): SceneNode => ({ ...structuredClone(node),
    id: replacements.get(node.id)!, overlapWith: node.overlapWith.map((key) => replacements.get(key) ?? key), parentId: replacements.get(node.parentId ?? '') ?? node.parentId,
    name: node.id === id ? `${node.name.slice(0, 110)} (cópia)` : node.name,
    position: node.id === id ? insertionPosition(doc, root, doc.nodes.filter((item) => ids.has(item.id))) : [...node.position] }))
  return { document: validateScene({ ...doc, nodes: [...doc.nodes, ...copies] }), selectedId: replacements.get(id)! }
}
export interface SceneHistory { past: ThreeSceneDocument[]; present: ThreeSceneDocument; future: ThreeSceneDocument[] }
export function commitScene(history: SceneHistory, document: ThreeSceneDocument): SceneHistory {
  const validated = validateScene(document)
  if (JSON.stringify(validated) === JSON.stringify(history.present)) return history
  return { past: [...history.past.slice(-49), history.present], present: validated, future: [] }
}
export function undoScene(history: SceneHistory): SceneHistory {
  if (!history.past.length) return history
  return { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] }
}
export function redoScene(history: SceneHistory): SceneHistory {
  if (!history.future.length) return history
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) }
}
