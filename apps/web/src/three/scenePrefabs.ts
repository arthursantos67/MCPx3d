import { buildVegetation } from './sceneVegetation.ts'
import { buildHouse, type BuildingSpec } from './sceneArchitecture.ts'
import type { NodeKind, SceneAnimation, SceneBehavior, SceneInteraction, SceneLight, SceneMaterial, SceneSound, Vector3Tuple } from './sceneDocument.ts'
import { hashNoise, type GeometrySpec } from './sceneGeometrySpec.ts'
import { buildCharacter, characterBehavior, characterLabels, characterTypes, isCharacterType } from './sceneCharacters.ts'
import { buildWorldPrefab, worldNaturalPrefabs, worldPrefabBehavior, worldPrefabLabels, worldPrefabTypes, worldStructurePrefabs, type WorldPrefabType } from './scenePrefabsWorld.ts'

const basePrefabTypes = ['house', 'tree', 'pine', 'bush', 'rock', 'lampPost', 'torch', 'fence', 'bench', 'table', 'chair', 'barrel', 'crate', 'well', 'tower', 'campfire', 'sign',
  'bridge', 'windmill', 'coin', 'gem', 'flowerBed', 'ladder', 'enemy', 'sentinel', 'crawler', 'spikes', 'checkpoint', 'portal',
  'planet', 'asteroid', 'spaceship', 'satellite', 'spaceStation', 'rocket', 'mushroom', 'log', 'stump', 'palm', 'cactus', 'coral', 'seaweed', 'crystalCluster',
  'column', 'tent', 'car', 'boat', 'skyscraper'] as const
export const prefabTypes = [...basePrefabTypes, ...characterTypes, ...worldPrefabTypes] as const
export type PrefabType = typeof prefabTypes[number]
const isWorldPrefab = (type: string): type is WorldPrefabType => (worldPrefabTypes as readonly string[]).includes(type)
export const prefabLabels: Record<PrefabType, string> = { ...characterLabels, ...worldPrefabLabels, house: 'Casa', tree: 'Árvore', pine: 'Pinheiro', bush: 'Arbusto', rock: 'Rochas', lampPost: 'Poste de luz', torch: 'Tocha',
  fence: 'Cerca (4 m)', bench: 'Banco', table: 'Mesa', chair: 'Cadeira', barrel: 'Barril', crate: 'Caixote', well: 'Poço', tower: 'Torre de vigia', campfire: 'Fogueira',
  sign: 'Placa', bridge: 'Ponte (6 m)', windmill: 'Moinho', coin: 'Moeda coletável', gem: 'Cristal coletável', flowerBed: 'Canteiro', ladder: 'Escada de mão (4 m)',
  enemy: 'Inimigo (slime)', sentinel:'Sentinela robótica',crawler:'Criatura rastejante', spikes: 'Espinhos', checkpoint: 'Ponto de controle', portal: 'Portal de chegada',
  planet: 'Planeta', asteroid: 'Asteroide', spaceship: 'Nave espacial', satellite: 'Satélite', spaceStation: 'Estação espacial', rocket: 'Foguete', mushroom: 'Cogumelos',
  log: 'Tronco caído', stump: 'Toco', palm: 'Palmeira', cactus: 'Cacto', coral: 'Coral', seaweed: 'Algas', crystalCluster: 'Formação de cristais', column: 'Coluna',
  tent: 'Barraca', car: 'Carro', boat: 'Barco', skyscraper: 'Arranha-céu' }
/** Natural or small props rest on uneven ground as they are; structures flatten the terrain under their footprint. */
export const naturalPrefabs: readonly PrefabType[] = ['tree', 'pine', 'bush', 'rock', 'coin', 'gem', 'torch', 'lampPost', 'sign', 'fence', 'flowerBed', 'mushroom', 'log', 'stump', 'palm', 'cactus', 'coral', 'seaweed', 'crystalCluster', 'asteroid',
  ...characterTypes, ...worldNaturalPrefabs]
export const characterPrefabs: readonly PrefabType[] = characterTypes
export const vegetationPrefabs: readonly PrefabType[] = ['tree', 'pine', 'bush', 'flowerBed', 'mushroom', 'log', 'stump', 'palm', 'cactus', 'coral', 'seaweed']
export const structurePrefabs: readonly PrefabType[] = ['house', 'windmill', 'tower', 'bridge', 'well', 'portal', 'spaceStation', 'rocket', 'skyscraper', 'column', 'tent', ...worldStructurePrefabs]
export interface PrefabSpec { building?: BuildingSpec; type: PrefabType; size: number; seed: number; primary: string | null; secondary: string | null; text: string; lit: boolean; interactive: boolean }
/** One part relative to the prefab origin, which sits on the ground at the footprint center. */
export interface PrefabPart {
  id: string; parentId: string | null; name: string; kind: NodeKind; position: Vector3Tuple; rotation?: Vector3Tuple; dimensions: Vector3Tuple
  material?: Partial<SceneMaterial>; geometry?: Partial<GeometrySpec>; animation?: Partial<SceneAnimation>; interaction?: SceneInteraction; light?: SceneLight
  collidable?: boolean; overlapWith?: string[]; behavior?: SceneBehavior; sound?: SceneSound
}
/** Behavior applied to the prefab root group (enemies move as a whole; hazards, checkpoints and goals react to touch). */
export function prefabRootBehavior(spec: PrefabSpec): SceneBehavior | null {
  if (isCharacterType(spec.type)) return characterBehavior(spec.type, spec.size)
  if (isWorldPrefab(spec.type)) return worldPrefabBehavior(spec)
  if (spec.type === 'enemy') return { type: 'enemy', speed: 2.6, range: 12 * spec.size, damage: 20 }
  if (spec.type === 'sentinel') return { type:'enemy',speed:2,range:15*spec.size,damage:25 }
  if (spec.type === 'crawler') return { type:'enemy',speed:3.3,range:10*spec.size,damage:15 }
  if (spec.type === 'spikes') return { type: 'hazard', speed: 0, range: 1, damage: 25 }
  if (spec.type === 'checkpoint') return { type: 'checkpoint', speed: 0, range: 1.5, damage: 0 }
  if (spec.type === 'portal') return { type: 'goal', speed: 0, range: 1.5, damage: 0 }
  return null
}
const climb: SceneBehavior = { type: 'climbable', speed: 0, range: 1, damage: 0 }

const wood: Partial<SceneMaterial> = { color: '#d9c2a2', texture: 'wood', textureScale: 1, roughness: 0.75, metalness: 0 }
const stone: Partial<SceneMaterial> = { color: '#cfc8bc', texture: 'rock', textureScale: 1.5, roughness: 0.9, metalness: 0 }
const iron: Partial<SceneMaterial> = { color: '#2f3338', metalness: 0.8, roughness: 0.4 }
const leaves = (color: string): Partial<SceneMaterial> => ({ color, texture: 'leaves', textureScale: 1.8, normalStrength: 0.35, roughness: 0.85, metalness: 0, flatShading: false })
const glow = (color: string, intensity: number): Partial<SceneMaterial> => ({ color: '#fff3d6', emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 })
const spin = (duration: number, axis: 'x' | 'y' | 'z' = 'y', phase = 0): Partial<SceneAnimation> => ({ kind: 'spin', axis, duration, amplitude: 0, phase, start: 'auto', easing: 'smooth', keys: [] })
const point = (color: string, intensity: number, distance: number): SceneLight => ({ type: 'point', color, intensity, distance, angle: 35, penumbra: 0.4, castShadow: false })
const collect = (): SceneInteraction => ({ trigger: 'proximity', key: '', radius: 1.4, action: 'collect', targetId: null, message: '' })
const sway = (duration: number, amplitude: number, phase: number, axis: 'x' | 'z' = 'z'): Partial<SceneAnimation> => ({ kind: 'swing', axis, duration, amplitude, phase, start: 'auto', easing: 'smooth', keys: [] })
const hullMetal = (color: string): Partial<SceneMaterial> => ({ color, texture: 'metal', textureScale: 1.5, metalness: 0.65, roughness: 0.35 })
const glass: Partial<SceneMaterial> = { color: '#9fd3ff', metalness: 0, roughness: 0.05, transmission: 0.6, ior: 1.45, thickness: 0.2, opacity: 0.65, transparent: true }

function build(spec: PrefabSpec): PrefabPart[] {
  const random = (k: number) => hashNoise(spec.seed, k, 977)
  const vary = (k: number, amount = 0.15) => 1 + (random(k) - 0.5) * 2 * amount
  const primary = spec.primary, secondary = spec.secondary
  const parts: PrefabPart[] = []
  const add = (part: PrefabPart) => { parts.push(part); return part.id }
  const legs = (prefix: string, x: number, z: number, height: number, width: number, material = wood) => {
    for (const [i, [dx, dz]] of [[-x, -z], [x, -z], [-x, z], [x, z]].entries()) add({ id: `${prefix}${i}`, parentId: null, name: `Perna ${i + 1}`, kind: 'box', position: [dx, height / 2, dz], dimensions: [width, height, width], material })
  }
  if (isCharacterType(spec.type)) return buildCharacter(spec)
  if (isWorldPrefab(spec.type)) return buildWorldPrefab(spec)
  switch (spec.type) {
    case 'house': return buildHouse(spec)
    case 'tree': return buildVegetation(spec)
    case 'pine': return buildVegetation(spec,true)
    case 'bush':
      add({ id: 'a', parentId: null, name: 'Folhagem', kind: 'polyhedron', position: [0, 0.45, 0], dimensions: [1.3 * vary(1), 0.95, 1.2], material: leaves(primary ?? '#a9c98c'), geometry: { detail: 1, bevel: 0.15, seed: spec.seed % 10 }, collidable: false })
      add({ id: 'b', parentId: null, name: 'Folhagem', kind: 'polyhedron', position: [0.45, 0.35, 0.25], dimensions: [0.9, 0.7, 0.9], material: leaves(secondary ?? '#bcd8a0'), geometry: { detail: 1, bevel: 0.15, seed: (spec.seed + 1) % 10 }, collidable: false })
      break
    case 'rock':
      add({ id: 'big', parentId: null, name: 'Rocha', kind: 'polyhedron', position: [0, 0.38, 0], rotation: [0, random(1) * 360 - 180, 0], dimensions: [1.4 * vary(2), 0.95, 1.2], material: { ...stone, color: primary ?? '#cfc8bc', flatShading: true }, geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.16, seed: spec.seed % 10 } })
      add({ id: 'small', parentId: null, name: 'Pedra', kind: 'polyhedron', position: [0.85, 0.2, 0.35], dimensions: [0.6, 0.45, 0.55], material: { ...stone, color: primary ?? '#cfc8bc', flatShading: true }, geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.16, seed: (spec.seed + 5) % 10 } })
      break
    case 'lampPost':
      add({ id: 'base', parentId: null, name: 'Base', kind: 'cylinder', position: [0, 0.1, 0], dimensions: [0.32, 0.2, 0.32], material: iron })
      add({ id: 'pole', parentId: null, name: 'Haste', kind: 'cylinder', position: [0, 1.6, 0], dimensions: [0.12, 2.8, 0.12], material: iron })
      add({ id: 'lantern', parentId: null, name: 'Lanterna', kind: 'roundedBox', position: [0, 3.2, 0], dimensions: [0.32, 0.42, 0.32], material: spec.lit ? glow(secondary ?? '#ffb64d', 2.2) : { color: '#e8e2d2', roughness: 0.3, metalness: 0 } })
      add({ id: 'cap', parentId: null, name: 'Chapéu', kind: 'cone', position: [0, 3.55, 0], dimensions: [0.46, 0.28, 0.46], material: iron, geometry: { segments: 8 } })
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Luz do poste', kind: 'light', position: [0, 3.2, 0], dimensions: [0.15, 0.15, 0.15], light: point(secondary ?? '#ffc477', 4, 10) })
      break
    case 'torch':
      add({ id: 'pole', parentId: null, name: 'Haste', kind: 'cylinder', position: [0, 0.7, 0], dimensions: [0.08, 1.4, 0.08], material: wood })
      add({ id: 'flame', parentId: null, name: 'Chama', kind: 'cone', position: [0, 1.66, 0], dimensions: [0.22, 0.35, 0.22], material: { color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 2.5, opacity: 0.9, transparent: true },
        animation: { kind: 'pulse', axis: 'y', duration: 0.5 + random(1) * 0.3, amplitude: 0.15, phase: random(2) * 360, start: 'auto', easing: 'smooth', keys: [] }, collidable: false })
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Luz da tocha', kind: 'light', position: [0, 1.85, 0], dimensions: [0.12, 0.12, 0.12], light: point('#ff9a4a', 3, 7) })
      break
    case 'fence':
      for (const x of [-2, 0, 2]) add({ id: `post${x}`, parentId: null, name: 'Mourão', kind: 'box', position: [x, 0.55, 0], dimensions: [0.12, 1.1, 0.12], material: { ...wood, color: primary ?? '#d9c2a2' } })
      for (const y of [0.45, 0.88]) add({ id: `rail${y}`, parentId: null, name: 'Travessa', kind: 'box', position: [0, y, 0.09], dimensions: [4.1, 0.09, 0.05], material: { ...wood, color: primary ?? '#d9c2a2' } })
      break
    case 'bench':
      add({ id: 'seat', parentId: null, name: 'Assento', kind: 'box', position: [0, 0.46, 0], dimensions: [1.6, 0.07, 0.45], material: { ...wood, color: primary ?? '#d9c2a2' } })
      add({ id: 'back', parentId: null, name: 'Encosto', kind: 'box', position: [0, 0.78, -0.2], dimensions: [1.6, 0.4, 0.06], material: { ...wood, color: primary ?? '#d9c2a2' } })
      legs('leg', 0.7, 0.18, 0.43, 0.07, iron)
      break
    case 'table':
      add({ id: 'top', parentId: null, name: 'Tampo', kind: 'box', position: [0, 0.75, 0], dimensions: [1.4, 0.06, 0.8], material: { ...wood, color: primary ?? '#d9c2a2' } })
      legs('leg', 0.6, 0.32, 0.72, 0.07)
      break
    case 'chair':
      add({ id: 'seat', parentId: null, name: 'Assento', kind: 'box', position: [0, 0.45, 0], dimensions: [0.45, 0.05, 0.45], material: { ...wood, color: primary ?? '#d9c2a2' } })
      add({ id: 'back', parentId: null, name: 'Encosto', kind: 'box', position: [0, 0.73, -0.2], dimensions: [0.45, 0.5, 0.05], material: { ...wood, color: primary ?? '#d9c2a2' } })
      legs('leg', 0.19, 0.19, 0.43, 0.05)
      break
    case 'barrel':
      add({ id: 'body', parentId: null, name: 'Barril', kind: 'lathe', position: [0, 0.45, 0], dimensions: [0.62, 0.9, 0.62], material: { ...wood, color: primary ?? '#d9b48f' },
        geometry: { profile: [[0, 0], [0.26, 0], [0.31, 0.25], [0.32, 0.5], [0.31, 0.75], [0.26, 1], [0, 1]], segments: 24 } })
      for (const y of [0.18, 0.72]) add({ id: `hoop${y}`, parentId: null, name: 'Aro', kind: 'torus', position: [0, y, 0], rotation: [90, 0, 0], dimensions: [0.63, 0.63, 0.04], material: iron, geometry: { radius: 0.03, segments: 24 } })
      break
    case 'crate':
      add({ id: 'box', parentId: null, name: 'Caixote', kind: 'roundedBox', position: [0, 0.4, 0], dimensions: [0.8, 0.8, 0.8], material: { ...wood, color: primary ?? '#e0c9a6', textureScale: 0.8 }, geometry: { bevel: 0.03 } })
      for (const side of [-1, 1]) add({ id: `slat${side}`, parentId: null, name: 'Ripa', kind: 'box', position: [0, 0.4, side * 0.41], rotation: [0, 0, 45], dimensions: [1.05, 0.08, 0.03], material: { ...wood, color: '#a57d58' } })
      break
    case 'well':
      add({ id: 'ring', parentId: null, name: 'Bocal de pedra', kind: 'lathe', position: [0, 0.45, 0], dimensions: [1.7, 0.9, 1.7], material: stone, geometry: { profile: [[0.85, 0], [0.85, 0.9], [0.65, 0.9], [0.65, 0]], closed: true, segments: 32 } })
      add({ id: 'water', parentId: null, name: 'Água', kind: 'cylinder', position: [0, 0.55, 0], dimensions: [1.28, 0.04, 1.28], material: { color: '#6fb7c9', texture: 'water', textureScale: 1, roughness: 0.1, metalness: 0 }, collidable: false })
      for (const side of [-1, 1]) add({ id: `post${side}`, parentId: null, name: 'Esteio', kind: 'box', position: [side * 0.95, 1.4, 0], dimensions: [0.14, 1.9, 0.14], material: wood })
      add({ id: 'roof', parentId: null, name: 'Telhadinho', kind: 'extrude', position: [0, 2.75, 0], rotation: [0, 90, 0], dimensions: [1.6, 0.8, 2.3], material: { color: secondary ?? '#c0654a', texture: 'tiles', textureScale: 2, roughness: 0.7, metalness: 0 }, geometry: { profile: [[-1, 0], [1, 0], [0, 1]], bevel: 0 } })
      add({ id: 'bucket', parentId: null, name: 'Balde', kind: 'cylinder', position: [0, 1.5, 0], dimensions: [0.26, 0.3, 0.26], material: { ...wood, color: '#a57d58' } })
      break
    case 'tower': {
      legs('leg', 1.2, 1.2, 5, 0.25)
      add({ id: 'deck', parentId: null, name: 'Plataforma', kind: 'box', position: [0, 5.12, 0], dimensions: [3.1, 0.25, 3.1], material: wood })
      // The front rail leaves an opening above the ladder so the player can step onto the deck.
      for (const [i, [x, z, w, dd]] of [[0, -1.5, 3.1, 0.08], [-1.05, 1.5, 1, 0.08], [1.05, 1.5, 1, 0.08], [-1.5, 0, 0.08, 2.92], [1.5, 0, 0.08, 2.92]].entries())
        add({ id: `rail${i}`, parentId: null, name: 'Guarda-corpo', kind: 'box', position: [x, 6.05, z], dimensions: [w, 0.08, dd], material: wood })
      for (const [i, [x, z]] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].entries()) add({ id: `pillar${i}`, parentId: null, name: 'Pilar', kind: 'box', position: [x, 5.95, z], dimensions: [0.12, 1.4, 0.12], material: wood })
      add({ id: 'roof', parentId: null, name: 'Cobertura', kind: 'cone', position: [0, 7.35, 0], dimensions: [3.8, 1.5, 3.8], material: { color: secondary ?? '#a5523a', texture: 'tiles', textureScale: 2, roughness: 0.7, metalness: 0 }, geometry: { segments: 8 } })
      for (const side of [-1, 1]) add({ id: `ladder${side}`, parentId: null, name: 'Montante da escada', kind: 'box', position: [side * 0.25, 2.75, 1.62], dimensions: [0.06, 5.5, 0.06], material: wood, behavior: climb })
      for (let i = 0; i < 10; i++) add({ id: `rung${i}`, parentId: null, name: 'Degrau', kind: 'box', position: [0, 0.4 + i * 0.55, 1.62], dimensions: [0.56, 0.05, 0.05], material: wood, behavior: climb })
      if (spec.interactive) add({ id: 'bell', parentId: null, name: 'Sino', kind: 'lathe', position: [0, 6.2, 0], dimensions: [0.5, 0.55, 0.5], material: { color: '#c79a52', metalness: 1, roughness: 0.3 },
        geometry: { profile: [[0, 1], [0.12, 1], [0.18, 0.7], [0.3, 0.1], [0.36, 0], [0, 0]] }, animation: { kind: 'swing', axis: 'z', duration: 2.4, amplitude: 18, phase: 0, start: 'trigger', easing: 'smooth', keys: [] },
        interaction: { trigger: 'click', key: '', radius: 4, action: 'toggleAnimation', targetId: null, message: spec.text || 'O sino ecoa pela ilha.' } })
      break
    }
    case 'campfire': {
      for (let i = 0; i < 7; i++) {
        const angle = i / 7 * Math.PI * 2
        add({ id: `stone${i}`, parentId: null, name: 'Pedra', kind: 'polyhedron', position: [Math.cos(angle) * 0.72, 0.1, Math.sin(angle) * 0.72], rotation: [0, i * 41, 0], dimensions: [0.32, 0.24, 0.28], material: { ...stone, flatShading: true }, geometry: { variant: 'dodecahedron', bevel: 0.12, seed: i } })
      }
      add({ id: 'logA', parentId: null, name: 'Lenha', kind: 'cylinder', position: [0, 0.1, 0], rotation: [0, 30, 82], dimensions: [0.15, 1, 0.15], material: wood })
      add({ id: 'logB', parentId: null, name: 'Lenha', kind: 'cylinder', position: [0, 0.24, 0], rotation: [0, -40, 82], dimensions: [0.15, 1, 0.15], material: wood })
      add({ id: 'flame', parentId: null, name: 'Chama', kind: 'cone', position: [0, 0.72, 0], dimensions: [0.5, 0.8, 0.5], material: { color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 2.5, opacity: 0.85, transparent: true },
        animation: { kind: 'pulse', axis: 'y', duration: 0.6, amplitude: 0.12, phase: 0, start: 'auto', easing: 'smooth', keys: [] }, collidable: false, overlapWith: ['logA', 'logB'] })
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Luz da fogueira', kind: 'light', position: [0, 1.3, 0], dimensions: [0.2, 0.2, 0.2], light: { ...point('#ff9a4a', 6, 10), castShadow: true } })
      break
    }
    case 'sign': {
      for (const side of [-1, 1]) add({ id: `post${side}`, parentId: null, name: 'Poste', kind: 'cylinder', position: [side * 1.05, 0.95, 0], dimensions: [0.13, 1.9, 0.13], material: wood })
      add({ id: 'board', parentId: null, name: 'Tábua', kind: 'roundedBox', position: [0, 1.6, 0.11], dimensions: [2.4, 1.1, 0.1], material: { ...wood, color: primary ?? '#d9c2a2' } })
      add({ id: 'label', parentId: null, name: 'Texto', kind: 'text', position: [0, 1.6, 0.2], dimensions: [2.2, 0.95, 0.01], material: { color: secondary ?? '#2b1d10', roughness: 0.6, metalness: 0 },
        geometry: { text: spec.text || 'Bem-vindo' }, interaction: spec.interactive ? { trigger: 'click', key: '', radius: 4, action: 'message', targetId: null, message: (spec.text || 'Bem-vindo').slice(0, 160) } : undefined })
      break
    }
    case 'bridge':
      add({ id: 'deck', parentId: null, name: 'Tabuleiro', kind: 'box', position: [0, 0.35, 0], dimensions: [6, 0.15, 1.8], material: { ...wood, color: primary ?? '#d9c2a2', textureScale: 2 } })
      for (const side of [-1, 1]) {
        for (const x of [-2.9, -1, 1, 2.9]) add({ id: `post${side}${x}`, parentId: null, name: 'Balaústre', kind: 'box', position: [x, 0.95, side * 0.85], dimensions: [0.1, 1.05, 0.1], material: wood })
        add({ id: `rail${side}`, parentId: null, name: 'Corrimão', kind: 'box', position: [0, 1.42, side * 0.85], dimensions: [6, 0.08, 0.13], material: wood })
      }
      for (const x of [-2.6, 2.6]) for (const side of [-1, 1]) add({ id: `pile${x}${side}`, parentId: null, name: 'Pilar', kind: 'cylinder', position: [x, -0.6, side * 0.7], dimensions: [0.22, 1.8, 0.22], material: wood })
      break
    case 'windmill': {
      add({ id: 'tower', parentId: null, name: 'Torre', kind: 'lathe', position: [0, 4, 0], dimensions: [3.2, 8, 3.2], material: { color: primary ?? '#f1e7d8', texture: 'plaster', textureScale: 2, roughness: 0.9, metalness: 0 },
        geometry: { profile: [[0, 0], [1.6, 0], [1, 1], [0, 1]], segments: 32 } })
      add({ id: 'cap', parentId: null, name: 'Capota', kind: 'cone', position: [0, 8.65, 0], dimensions: [2.4, 1.3, 2.4], material: { color: secondary ?? '#a5523a', texture: 'tiles', textureScale: 2, roughness: 0.7, metalness: 0 } })
      add({ id: 'hub', parentId: null, name: 'Eixo', kind: 'cylinder', position: [0, 7.6, 1.25], rotation: [90, 0, 0], dimensions: [0.35, 0.9, 0.35], material: wood })
      const rotor = add({ id: 'rotor', parentId: null, name: 'Rotor', kind: 'group', position: [0, 7.6, 1.85], dimensions: [1, 1, 1], animation: spin(6, 'z') })
      for (let i = 0; i < 4; i++) {
        const angle = i * 90, radians = angle * Math.PI / 180
        add({ id: `blade${i}`, parentId: rotor, name: 'Pá', kind: 'box', position: [-Math.sin(radians) * 1.75, Math.cos(radians) * 1.75, 0], rotation: [0, 0, angle], dimensions: [0.6, 3, 0.06], material: { ...wood, color: '#efe2c8' } })
      }
      break
    }
    case 'coin':
      add({ id: 'coin', parentId: null, name: 'Moeda', kind: 'cylinder', position: [0, 1, 0], rotation: [90, 0, 0], dimensions: [0.6, 0.08, 0.6], material: { color: primary ?? '#ffd257', metalness: 1, roughness: 0.25, emissive: '#7a5200', emissiveIntensity: 0.6 },
        animation: spin(2.4, 'y', random(1) * 360), interaction: collect(), collidable: false })
      break
    case 'gem':
      add({ id: 'gem', parentId: null, name: 'Cristal', kind: 'polyhedron', position: [0, 1.1, 0], dimensions: [0.42, 0.66, 0.42], material: { color: '#bff6ff', emissive: primary ?? '#2fd6ff', emissiveIntensity: 3, roughness: 0.08, metalness: 0.1, clearcoat: 1, flatShading: true },
        geometry: { variant: 'octahedron' }, animation: spin(3, 'y', random(1) * 360), interaction: collect(), collidable: false })
      break
    case 'ladder': {
      for (const side of [-1, 1]) add({ id: `rail${side}`, parentId: null, name: 'Montante', kind: 'box', position: [side * 0.25, 2, 0], dimensions: [0.07, 4, 0.07], material: wood, behavior: climb })
      for (let i = 0; i < 7; i++) add({ id: `rung${i}`, parentId: null, name: 'Degrau', kind: 'box', position: [0, 0.35 + i * 0.55, 0], dimensions: [0.56, 0.05, 0.05], material: wood, behavior: climb })
      break
    }
    case 'sentinel': {
      const armor:Partial<SceneMaterial>={color:primary??'#687b8f',texture:'metal',metalness:0.7,roughness:0.4},joint:Partial<SceneMaterial>={color:'#222a33',metalness:0.5,roughness:0.7}
      add({id:'torso',parentId:null,name:'Armadura da sentinela',kind:'roundedBox',position:[0,1.12,0],dimensions:[0.78,0.72,0.48],material:armor})
      add({id:'head',parentId:null,name:'Cabeça blindada',kind:'roundedBox',position:[0,1.68,0],dimensions:[0.55,0.36,0.44],material:armor})
      add({id:'visor',parentId:null,name:'Sensor óptico',kind:'box',position:[0,1.7,0.235],dimensions:[0.4,0.075,0.03],material:{color:secondary??'#ff775a',emissive:secondary??'#ff3f22',emissiveIntensity:1.4,metalness:0.3,roughness:0.25},collidable:false})
      add({id:'waist',parentId:null,name:'Articulação central',kind:'cylinder',position:[0,0.7,0],dimensions:[0.38,0.2,0.38],material:joint})
      for(const side of [-1,1]) {
        const hip=add({id:`hip${side}`,parentId:null,name:'Quadril articulado',kind:'group',position:[side*0.22,0.75,0],dimensions:[1,1,1],animation:{kind:'swing',axis:'x',duration:1.4,amplitude:10,phase:side<0?180:0}})
        add({id:`leg${side}`,parentId:hip,name:'Perna mecânica',kind:'roundedBox',position:[0,-0.31,0],dimensions:[0.24,0.56,0.25],material:armor,overlapWith:['waist']})
        add({id:`foot${side}`,parentId:hip,name:'Apoio mecânico',kind:'roundedBox',position:[0,-0.6,0.08],dimensions:[0.3,0.18,0.43],material:joint})
        add({id:`shoulder${side}`,parentId:null,name:'Junta do ombro',kind:'sphere',position:[side*0.49,1.35,0],dimensions:[0.23,0.23,0.23],geometry:{segments:16},material:joint})
        add({id:`arm${side}`,parentId:null,name:'Braço blindado',kind:'capsule',position:[side*0.52,1.01,0.08],dimensions:[0.2,0.52,0.22],material:armor})
      }
      break
    }
    case 'crawler': {
      const shell:Partial<SceneMaterial>={color:primary??'#705b89',texture:'rock',roughness:0.6,metalness:0.15,clearcoat:0.4}
      add({id:'shell',parentId:null,name:'Carapaça da criatura',kind:'sphere',position:[0,0.48,0],dimensions:[0.9,0.62,1.15],geometry:{segments:24},material:shell})
      add({id:'head',parentId:null,name:'Cabeça da criatura',kind:'sphere',position:[0,0.4,0.6],dimensions:[0.55,0.38,0.48],geometry:{segments:20},material:shell})
      for(const side of [-1,1]) {
        add({id:`eye${side}`,parentId:null,name:'Olho luminoso',kind:'sphere',position:[side*0.16,0.48,0.8],dimensions:[0.11,0.1,0.07],geometry:{segments:12},material:{color:'#ffe3a0',emissive:secondary??'#ffb543',emissiveIntensity:1.4,roughness:0.4,metalness:0},collidable:false})
        for(let i=0;i<3;i++) add({id:`leg${side}-${i}`,parentId:null,name:'Pata articulada',kind:'tube',position:[side*0.61,0.24,(i-1)*0.36],dimensions:[0.7,0.48,0.35],geometry:{segments:8,radius:0.06,points:[[side* -0.35,0.15,-0.1],[side*0.2,0.3,0],[side*0.35,-0.15,0.15]]},material:{color:'#382e43',roughness:0.7,metalness:0.2}})
      }
      break
    }
    case 'enemy': {
      const body = primary ?? '#6fd16a'
      const bob = add({ id: 'bob', parentId: null, name: 'Corpo saltitante', kind: 'group', position: [0, 0, 0], dimensions: [1, 1, 1], animation: { kind: 'bounce', axis: 'y', duration: 0.9 + random(1) * 0.3, amplitude: 0.18, phase: random(2) * 360, start: 'auto', easing: 'smooth', keys: [] } })
      add({ id: 'body', parentId: bob, name: 'Slime', kind: 'sphere', position: [0, 0.45, 0], dimensions: [1.1, 0.85, 1.1], material: { color: body, roughness: 0.25, metalness: 0, clearcoat: 1, emissive: body, emissiveIntensity: 0.25 } })
      for (const side of [-1, 1]) {
        add({ id: `eye${side}`, parentId: bob, name: 'Olho', kind: 'sphere', position: [side * 0.2, 0.62, 0.42], dimensions: [0.2, 0.24, 0.12], material: { color: '#ffffff', roughness: 0.3, metalness: 0 }, geometry: { segments: 12 } })
        add({ id: `pupil${side}`, parentId: bob, name: 'Pupila', kind: 'sphere', position: [side * 0.2, 0.62, 0.49], dimensions: [0.09, 0.11, 0.04], material: { color: '#1b1b1b', roughness: 0.3, metalness: 0 }, geometry: { segments: 12 } })
      }
      break
    }
    case 'spikes': {
      add({ id: 'plate', parentId: null, name: 'Base dos espinhos', kind: 'box', position: [0, 0.05, 0], dimensions: [1.6, 0.1, 1.6], material: iron })
      for (let i = 0; i < 9; i++) add({ id: `spike${i}`, parentId: null, name: 'Espinho', kind: 'cone', position: [-0.5 + (i % 3) * 0.5, 0.4, -0.5 + Math.floor(i / 3) * 0.5], dimensions: [0.26, 0.6, 0.26], material: { color: secondary ?? '#c9ccd1', metalness: 0.9, roughness: 0.3 }, geometry: { segments: 8 } })
      break
    }
    case 'checkpoint': {
      add({ id: 'stone', parentId: null, name: 'Base', kind: 'polyhedron', position: [0, 0.18, 0], dimensions: [0.7, 0.36, 0.7], material: { ...stone, flatShading: true }, geometry: { variant: 'dodecahedron', bevel: 0.08, seed: 2 } })
      add({ id: 'pole', parentId: null, name: 'Mastro', kind: 'cylinder', position: [0, 1.55, 0], dimensions: [0.08, 2.5, 0.08], material: iron })
      const hinge = add({ id: 'hinge', parentId: null, name: 'Bandeira (articulação)', kind: 'group', position: [0.05, 2.5, 0], dimensions: [1, 1, 1], animation: { kind: 'swing', axis: 'y', duration: 2.2, amplitude: 12, phase: random(1) * 360, start: 'auto', easing: 'smooth', keys: [] } })
      add({ id: 'flag', parentId: hinge, name: 'Bandeira', kind: 'box', position: [0.42, 0, 0], dimensions: [0.8, 0.5, 0.03], material: { color: primary ?? '#e04f3a', roughness: 0.8, metalness: 0, sheen: 0.5 }, collidable: false })
      break
    }
    case 'portal': {
      add({ id: 'base', parentId: null, name: 'Plataforma do portal', kind: 'cylinder', position: [0, 0.12, 0], dimensions: [3.2, 0.24, 3.2], material: stone })
      add({ id: 'ring', parentId: null, name: 'Arco do portal', kind: 'torus', position: [0, 1.75, 0], dimensions: [2.8, 2.8, 0.3], material: { color: '#1f2a44', metalness: 0.8, roughness: 0.3, emissive: primary ?? '#4fd8ff', emissiveIntensity: 1.2 }, geometry: { radius: 0.06, segments: 48 } })
      const swirl = add({ id: 'swirl', parentId: null, name: 'Vórtice', kind: 'group', position: [0, 1.75, 0], dimensions: [1, 1, 1], animation: spin(4, 'z') })
      add({ id: 'disc', parentId: swirl, name: 'Energia', kind: 'cylinder', position: [0, 0, 0], rotation: [90, 0, 0], dimensions: [2.3, 0.04, 2.3], material: { color: '#b9f3ff', emissive: primary ?? '#4fd8ff', emissiveIntensity: 2.4, opacity: 0.55, transparent: true, roughness: 0.2, metalness: 0 }, collidable: false })
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Luz do portal', kind: 'light', position: [0, 1.75, 1], dimensions: [0.2, 0.2, 0.2], light: point(primary ?? '#4fd8ff', 8, 12) })
      break
    }
    case 'flowerBed': {
      add({ id: 'border', parentId: null, name: 'Borda', kind: 'box', position: [0, 0.12, 0], dimensions: [1.6, 0.24, 0.8], material: { ...wood, color: '#b38b63' } })
      add({ id: 'soil', parentId: null, name: 'Terra', kind: 'box', position: [0, 0.25, 0], dimensions: [1.45, 0.04, 0.65], material: { color: '#6b4b33', roughness: 1, metalness: 0 }, collidable: false })
      const colors = [primary ?? '#ff6b8a', secondary ?? '#ffd25a', '#b48bff']
      for (let i = 0; i < 8; i++) add({ id: `flower${i}`, parentId: null, name: 'Flor', kind: 'sphere', position: [-0.55 + (i % 4) * 0.37, 0.4, i < 4 ? -0.15 : 0.15], dimensions: [0.16, 0.16, 0.16],
        material: { color: colors[i % 3], emissive: colors[i % 3], emissiveIntensity: 0.2, roughness: 0.6, metalness: 0 }, geometry: { segments: 12 }, collidable: false })
      break
    }
    case 'planet': {
      const tilt = add({ id: 'axis', parentId: null, name: 'Eixo inclinado', kind: 'group', position: [0, 3.6, 0], rotation: [0, 0, 8 + random(1) * 20], dimensions: [1, 1, 1] })
      const body = add({ id: 'spin', parentId: tilt, name: 'Rotação do planeta', kind: 'group', position: [0, 0, 0], dimensions: [1, 1, 1], animation: spin(50 + random(2) * 40) })
      add({ id: 'globe', parentId: body, name: 'Superfície planetária', kind: 'sphere', position: [0, 0, 0], dimensions: [6, 6, 6], geometry: { segments: 64 },
        material: { color: primary ?? '#c98a5a', texture: spec.seed % 3 === 0 ? 'rock' : 'marble', textureScale: 2, normalStrength: 0.8, roughness: 0.85, metalness: 0 } })
      add({ id: 'atmosphere', parentId: body, name: 'Atmosfera', kind: 'sphere', position: [0, 0, 0], dimensions: [6.35, 6.35, 6.35], geometry: { segments: 64 }, collidable: false,
        material: { color: secondary ?? '#9cc8ff', emissive: secondary ?? '#5f9cff', emissiveIntensity: 0.35, opacity: 0.16, transparent: true, roughness: 1, metalness: 0 } })
      if (spec.seed % 2 === 1) add({ id: 'rings', parentId: tilt, name: 'Anéis', kind: 'lathe', position: [0, 0, 0], dimensions: [12.5, 0.08, 12.5], collidable: false,
        geometry: { profile: [[0.3, 0], [0.5, 0], [0.5, 0.02], [0.3, 0.02]], closed: true, segments: 96 },
        material: { color: secondary ?? '#d9c7a3', texture: 'sand', textureScale: 4, opacity: 0.7, transparent: true, doubleSided: true, roughness: 0.9, metalness: 0 } })
      break
    }
    case 'asteroid': {
      const tumble = add({ id: 'tumble', parentId: null, name: 'Rotação do asteroide', kind: 'group', position: [0, 1.1, 0], dimensions: [1, 1, 1], animation: spin(18 + random(1) * 24, random(2) > 0.5 ? 'x' : 'z') })
      const rock: Partial<SceneMaterial> = { color: primary ?? '#8f8a84', texture: 'rock', textureScale: 1.5, normalStrength: 1.4, roughness: 0.95, metalness: 0.05, flatShading: true }
      add({ id: 'core', parentId: tumble, name: 'Núcleo rochoso', kind: 'polyhedron', position: [0, 0, 0], rotation: [random(3) * 90, random(4) * 180, 0], dimensions: [2.4 * vary(5), 1.8 * vary(6), 2.1 * vary(7)], geometry: { variant: 'icosahedron', detail: 2, bevel: 0.2, seed: spec.seed % 100 }, material: rock })
      add({ id: 'chunk', parentId: tumble, name: 'Fragmento', kind: 'polyhedron', position: [1.05, 0.35, 0.3], dimensions: [0.8, 0.6, 0.7], geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.18, seed: (spec.seed + 3) % 100 }, material: rock })
      break
    }
    case 'spaceship': {
      const hull = hullMetal(primary ?? '#d6dbe2'), accent: Partial<SceneMaterial> = { color: secondary ?? '#e2553d', metalness: 0.4, roughness: 0.4 }
      add({ id: 'hull', parentId: null, name: 'Fuselagem', kind: 'capsule', position: [0, 1.6, 0], rotation: [90, 0, 0], dimensions: [1.6, 7, 1.4], geometry: { segments: 24 }, material: hull })
      add({ id: 'cockpit', parentId: null, name: 'Cabine', kind: 'sphere', position: [0, 2.15, 1.7], dimensions: [1, 0.7, 1.7], geometry: { segments: 24 }, material: glass })
      for (const side of [-1, 1]) {
        add({ id: `wing${side}`, parentId: null, name: 'Asa', kind: 'roundedBox', position: [side * 2.1, 1.45, -0.7], rotation: [0, side * 12, side * -6], dimensions: [3.2, 0.14, 2.2], geometry: { bevel: 0.05 }, material: hull })
        add({ id: `tip${side}`, parentId: null, name: 'Luz de navegação', kind: 'sphere', position: [side * 3.7, 1.3, -0.9], dimensions: [0.18, 0.18, 0.18], geometry: { segments: 12 }, collidable: false,
          material: { color: '#ffffff', emissive: side < 0 ? '#ff3b30' : '#34ff6a', emissiveIntensity: 3, roughness: 0.4, metalness: 0 } })
        add({ id: `engine${side}`, parentId: null, name: 'Motor', kind: 'cylinder', position: [side * 0.9, 1.45, -2.6], rotation: [90, 0, 0], dimensions: [0.72, 2, 0.72], geometry: { segments: 20 }, material: { ...hull, color: '#5b6169' } })
        add({ id: `glow${side}`, parentId: null, name: 'Exaustão', kind: 'cylinder', position: [side * 0.9, 1.45, -3.62], rotation: [90, 0, 0], dimensions: [0.56, 0.06, 0.56], geometry: { segments: 20 }, collidable: false,
          material: { color: '#bdf3ff', emissive: secondary ?? '#38c8ff', emissiveIntensity: 5, roughness: 0.3, metalness: 0 }, animation: { kind: 'pulse', axis: 'y', duration: 0.4, amplitude: 0.08, phase: side > 0 ? 90 : 0, start: 'auto', easing: 'smooth', keys: [] } })
      }
      add({ id: 'fin', parentId: null, name: 'Estabilizador', kind: 'roundedBox', position: [0, 2.55, -2.3], rotation: [-15, 0, 0], dimensions: [0.14, 1.3, 1.6], geometry: { bevel: 0.05 }, material: accent })
      add({ id: 'stripe', parentId: null, name: 'Faixa da fuselagem', kind: 'box', position: [0, 1.6, 0.4], dimensions: [1.62, 0.18, 1.2], material: accent })
      for (const [i, [x, z]] of [[0, 2.2], [-0.8, -1.6], [0.8, -1.6]].entries()) add({ id: `gear${i}`, parentId: null, name: 'Trem de pouso', kind: 'cylinder', position: [x, 0.47, z], dimensions: [0.14, 0.94, 0.14], material: iron })
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Brilho dos motores', kind: 'light', position: [0, 1.45, -4.4], dimensions: [0.2, 0.2, 0.2], light: point(secondary ?? '#38c8ff', 6, 8) })
      break
    }
    case 'satellite': {
      const drift = add({ id: 'drift', parentId: null, name: 'Rotação do satélite', kind: 'group', position: [0, 1.6, 0], dimensions: [1, 1, 1], animation: spin(30 + random(1) * 20) })
      add({ id: 'body', parentId: drift, name: 'Corpo do satélite', kind: 'box', position: [0, 0, 0], dimensions: [1.2, 1.2, 1.6], material: { color: primary ?? '#d8b64c', metalness: 0.9, roughness: 0.3, texture: 'metal', textureScale: 0.8 } })
      add({ id: 'arm', parentId: drift, name: 'Braço dos painéis', kind: 'cylinder', position: [0, 0, 0], rotation: [0, 0, 90], dimensions: [0.1, 1.7, 0.1], material: iron })
      for (const side of [-1, 1]) add({ id: `panel${side}`, parentId: drift, name: 'Painel solar', kind: 'box', position: [side * 2.3, 0, 0], dimensions: [3, 0.05, 1.2], material: { color: '#c9d6ff', texture: 'solar', textureScale: 1, metalness: 0.5, roughness: 0.25 } })
      add({ id: 'mast', parentId: drift, name: 'Mastro da antena', kind: 'cylinder', position: [0, 0.8, 0], dimensions: [0.08, 0.5, 0.08], material: iron })
      add({ id: 'dish', parentId: drift, name: 'Antena parabólica', kind: 'lathe', position: [0, 1.18, 0], dimensions: [1.1, 0.32, 1.1], geometry: { profile: [[0.02, 0], [0.3, 0.12], [0.5, 0.32], [0.48, 0.34], [0.28, 0.15], [0, 0.03]], closed: true, segments: 32 }, material: { color: '#eef0f2', metalness: 0.3, roughness: 0.4 } })
      add({ id: 'beacon', parentId: drift, name: 'Sinalizador', kind: 'sphere', position: [0, -0.68, 0.6], dimensions: [0.14, 0.14, 0.14], geometry: { segments: 12 }, collidable: false, material: glow(secondary ?? '#ff4040', 3) })
      break
    }
    case 'spaceStation': {
      const station = hullMetal(primary ?? '#dfe3e8')
      const wheel = add({ id: 'wheel', parentId: null, name: 'Estrutura giratória', kind: 'group', position: [0, 6, 0], dimensions: [1, 1, 1], animation: spin(60) })
      add({ id: 'hub', parentId: wheel, name: 'Módulo central', kind: 'cylinder', position: [0, 0, 0], dimensions: [3, 5, 3], geometry: { segments: 32 }, material: station })
      add({ id: 'ring', parentId: wheel, name: 'Anel habitacional', kind: 'torus', position: [0, 0, 0], rotation: [90, 0, 0], dimensions: [16, 16, 1.6], geometry: { radius: 0.06, segments: 48 }, material: station })
      add({ id: 'spokeX', parentId: wheel, name: 'Raio estrutural', kind: 'cylinder', position: [0, 0, 0], rotation: [0, 0, 90], dimensions: [0.4, 12.6, 0.4], material: { ...station, color: '#9aa3ad' } })
      add({ id: 'spokeZ', parentId: wheel, name: 'Raio estrutural', kind: 'cylinder', position: [0, 0.6, 0], rotation: [90, 0, 0], dimensions: [0.4, 12.6, 0.4], material: { ...station, color: '#9aa3ad' } })
      add({ id: 'mast', parentId: wheel, name: 'Mastro', kind: 'cylinder', position: [0, 4.4, 0], dimensions: [0.3, 4, 0.3], material: iron })
      for (const side of [-1, 1]) add({ id: `panel${side}`, parentId: wheel, name: 'Painel solar', kind: 'box', position: [side * 3.4, 5.9, 0], dimensions: [6, 0.06, 2], material: { color: '#c9d6ff', texture: 'solar', textureScale: 2, metalness: 0.5, roughness: 0.25 } })
      add({ id: 'dock', parentId: wheel, name: 'Doca', kind: 'cylinder', position: [0, -3.2, 0], dimensions: [1.6, 1.4, 1.6], geometry: { segments: 24 }, material: { ...station, color: '#8a939d' } })
      add({ id: 'beacon', parentId: wheel, name: 'Farol', kind: 'sphere', position: [0, 6.55, 0], dimensions: [0.4, 0.4, 0.4], geometry: { segments: 16 }, collidable: false, material: glow(secondary ?? '#5ff2ff', 4) })
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Luz da estação', kind: 'light', position: [0, 13.2, 0], dimensions: [0.2, 0.2, 0.2], light: point(secondary ?? '#9fe9ff', 30, 30) })
      break
    }
    case 'rocket': {
      const body: Partial<SceneMaterial> = { color: primary ?? '#eef0f3', metalness: 0.3, roughness: 0.35 }
      add({ id: 'body', parentId: null, name: 'Corpo do foguete', kind: 'lathe', position: [0, 4.95, 0], dimensions: [1.6, 7.5, 1.6], geometry: { profile: [[0, 0], [0.45, 0], [0.5, 0.1], [0.5, 0.68], [0.42, 0.84], [0.2, 0.97], [0, 1]], segments: 40 }, material: body })
      add({ id: 'nozzle', parentId: null, name: 'Bocal', kind: 'cone', position: [0, 0.95, 0], rotation: [180, 0, 0], dimensions: [1.1, 0.9, 1.1], geometry: { segments: 24 }, material: { ...iron, color: '#3a3f46' } })
      for (let i = 0; i < 3; i++) {
        const angle = i * 120, radians = angle * Math.PI / 180
        add({ id: `fin${i}`, parentId: null, name: 'Aleta', kind: 'box', position: [Math.sin(radians) * 1.05, 1.1, Math.cos(radians) * 1.05], rotation: [0, angle, 0], dimensions: [0.1, 2.2, 1.1], material: { color: secondary ?? '#d7402f', metalness: 0.3, roughness: 0.4 } })
      }
      add({ id: 'window', parentId: null, name: 'Escotilha', kind: 'sphere', position: [0, 6.2, 0.74], dimensions: [0.5, 0.5, 0.16], geometry: { segments: 16 }, material: glass })
      add({ id: 'band', parentId: null, name: 'Faixa', kind: 'cylinder', position: [0, 3.2, 0], dimensions: [1.62, 0.3, 1.62], geometry: { segments: 40 }, material: { color: secondary ?? '#d7402f', metalness: 0.3, roughness: 0.4 } })
      break
    }
    case 'mushroom': {
      const cap: Partial<SceneMaterial> = spec.lit ? { color: primary ?? '#7ee8ff', emissive: secondary ?? '#3fd6ff', emissiveIntensity: 1.6, roughness: 0.5, metalness: 0 } : { color: primary ?? '#c0392b', roughness: 0.6, metalness: 0, clearcoat: 0.3 }
      const giant = spec.size >= 2
      for (const [i, [x, z, k]] of [[0, 0, 1], [0.55, 0.3, 0.6], [-0.4, 0.45, 0.45]].entries()) {
        add({ id: `stem${i}`, parentId: null, name: 'Haste', kind: 'cylinder', position: [x, 0.3 * k, z], dimensions: [0.2 * k, 0.6 * k, 0.2 * k], geometry: { segments: 12 }, material: { color: '#efe6d2', roughness: 0.8, metalness: 0 }, collidable: giant && i === 0 })
        add({ id: `cap${i}`, parentId: null, name: 'Chapéu', kind: 'lathe', position: [x, 0.7 * k, z], dimensions: [0.8 * k, 0.36 * k, 0.8 * k], geometry: { profile: [[0, 0], [0.5, 0], [0.46, 0.3], [0.3, 0.46], [0, 0.5]], segments: 24 }, material: cap, collidable: giant && i === 0 })
      }
      if (!spec.lit) for (let i = 0; i < 4; i++) add({ id: `spot${i}`, parentId: null, name: 'Pinta', kind: 'sphere', position: [Math.cos(i * 1.7) * 0.2, 0.86, Math.sin(i * 1.7) * 0.2], dimensions: [0.09, 0.04, 0.09], geometry: { segments: 8 }, collidable: false, material: { color: '#ffffff', roughness: 0.7, metalness: 0 } })
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Brilho bioluminescente', kind: 'light', position: [0, 1.1, 0], dimensions: [0.1, 0.1, 0.1], light: point(secondary ?? '#3fd6ff', 2, 5) })
      break
    }
    case 'log': {
      const bark: Partial<SceneMaterial> = { ...wood, color: primary ?? '#8a6a4c', textureScale: 0.6, roughness: 0.95 }
      add({ id: 'trunk', parentId: null, name: 'Tronco caído', kind: 'cylinder', position: [0, 0.28, 0], rotation: [0, 0, 90], dimensions: [0.56, 4, 0.56], geometry: { segments: 14 }, material: bark })
      add({ id: 'branch', parentId: null, name: 'Galho quebrado', kind: 'cylinder', position: [0.6, 0.62, 0.05], rotation: [0, 0, -30], dimensions: [0.14, 0.7, 0.14], geometry: { segments: 8 }, material: bark })
      add({ id: 'moss', parentId: null, name: 'Musgo', kind: 'sphere', position: [-0.5, 0.52, 0], dimensions: [1.3, 0.16, 0.42], geometry: { segments: 12 }, collidable: false, material: { color: secondary ?? '#6f8f3a', texture: 'grass', textureScale: 2, roughness: 1, metalness: 0 } })
      break
    }
    case 'stump': {
      add({ id: 'trunk', parentId: null, name: 'Toco', kind: 'cylinder', position: [0, 0.32, 0], dimensions: [0.8, 0.64, 0.8], geometry: { segments: 16 }, material: { ...wood, color: primary ?? '#8a6a4c', textureScale: 0.6 } })
      add({ id: 'cut', parentId: null, name: 'Corte', kind: 'cylinder', position: [0, 0.645, 0], dimensions: [0.7, 0.04, 0.7], geometry: { segments: 16 }, material: { color: '#d8b98c', roughness: 0.8, metalness: 0 } })
      for (let i = 0; i < 4; i++) add({ id: `root${i}`, parentId: null, name: 'Raiz', kind: 'polyhedron', position: [Math.cos(i * 1.57 + 0.4) * 0.42, 0.08, Math.sin(i * 1.57 + 0.4) * 0.42], rotation: [0, -(i * 90 + 23), 0], dimensions: [0.45, 0.18, 0.26], geometry: { variant: 'icosahedron', detail: 1, bevel: 0.1, seed: i }, material: { ...wood, color: primary ?? '#7a5a3e' } })
      break
    }
    case 'palm': {
      const lean = 1.2 + random(1) * 0.6
      add({ id: 'trunk', parentId: null, name: 'Tronco da palmeira', kind: 'tube', position: [lean / 2, 3.1, 0], dimensions: [lean + 0.34, 6.2, 0.34], geometry: { points: [[0, 0, 0], [0.04, 0.35, 0], [0.12, 0.7, 0], [0.25, 1, 0]], radius: 0.03, segments: 16 }, material: { ...wood, color: '#b49a74', textureScale: 0.4 } })
      const crown = add({ id: 'crown', parentId: null, name: 'Copa', kind: 'group', position: [lean, 6.2, 0], dimensions: [1, 1, 1], animation: sway(5 + random(2) * 2, 3, random(3) * 360, 'x') })
      for (let i = 0; i < 7; i++) {
        const yaw = add({ id: `frondRoot${i}`, parentId: crown, name: 'Folha', kind: 'group', position: [0, 0, 0], rotation: [0, i * 360 / 7 + random(i + 4) * 20, 0], dimensions: [1, 1, 1] })
        add({ id: `frond${i}`, parentId: yaw, name: 'Folha da palmeira', kind: 'box', position: [0, -0.5, 1.25], rotation: [24, 0, 0], dimensions: [0.55, 0.03, 2.7], collidable: false,
          material: { color: primary ?? '#cfe0a2', texture: 'foliage', textureScale: 1, alphaTest: 0.45, doubleSided: true, roughness: 0.85, metalness: 0 } })
      }
      for (let i = 0; i < 3; i++) add({ id: `coconut${i}`, parentId: crown, name: 'Coco', kind: 'sphere', position: [Math.cos(i * 2.1) * 0.22, -0.25, Math.sin(i * 2.1) * 0.22], dimensions: [0.24, 0.26, 0.24], geometry: { segments: 12 }, collidable: false, material: { color: '#5d4630', roughness: 0.8, metalness: 0 } })
      break
    }
    case 'cactus': {
      const skin: Partial<SceneMaterial> = { color: primary ?? '#5f8f4e', roughness: 0.75, metalness: 0, normalStrength: 0.6 }
      add({ id: 'main', parentId: null, name: 'Caule', kind: 'capsule', position: [0, 1.6, 0], dimensions: [0.56, 3.2, 0.56], geometry: { segments: 16 }, material: skin })
      for (const [side, height] of [[1, 1.3], [-1, 1.8]] as const) {
        add({ id: `elbow${side}`, parentId: null, name: 'Braço', kind: 'capsule', position: [side * 0.45, height, 0], rotation: [0, 0, 90], dimensions: [0.36, 0.8, 0.36], geometry: { segments: 12 }, material: skin })
        add({ id: `arm${side}`, parentId: null, name: 'Braço', kind: 'capsule', position: [side * 0.75, height + 0.45, 0], dimensions: [0.34, 1.05, 0.34], geometry: { segments: 12 }, material: skin })
      }
      if (spec.seed % 2) add({ id: 'flower', parentId: null, name: 'Flor', kind: 'sphere', position: [0, 3.2, 0], dimensions: [0.22, 0.12, 0.22], geometry: { segments: 10 }, collidable: false, material: { color: secondary ?? '#ff6fa5', roughness: 0.6, metalness: 0 } })
      break
    }
    case 'coral': {
      const tint = primary ?? '#ff7f6e'
      add({ id: 'brain', parentId: null, name: 'Coral cérebro', kind: 'sphere', position: [0, 0.3, 0], dimensions: [1, 0.6, 0.9], geometry: { segments: 20 }, material: { color: tint, texture: 'marble', textureScale: 3, normalStrength: 1.5, roughness: 0.8, metalness: 0 } })
      for (let i = 0; i < 5; i++) {
        const angle = i * 1.256 + random(i) * 0.4
        add({ id: `branch${i}`, parentId: null, name: 'Coral ramificado', kind: 'capsule', position: [Math.cos(angle) * 0.62, 0.45 + random(i + 9) * 0.2, Math.sin(angle) * 0.62], rotation: [Math.sin(angle) * 18, 0, -Math.cos(angle) * 18], dimensions: [0.14, 0.9 + random(i + 3) * 0.4, 0.14], geometry: { segments: 10 }, collidable: false,
          material: { color: secondary ?? '#ffb36b', emissive: secondary ?? '#ff8a3d', emissiveIntensity: 0.15, roughness: 0.7, metalness: 0 } })
      }
      break
    }
    case 'seaweed':
      for (let i = 0; i < 3; i++) {
        const stalk = add({ id: `stalk${i}`, parentId: null, name: 'Haste', kind: 'group', position: [(i - 1) * 0.35, 0, random(i) * 0.3 - 0.15], dimensions: [1, 1, 1], animation: sway(3 + random(i + 4) * 2, 9, random(i + 7) * 360) })
        add({ id: `blade${i}`, parentId: stalk, name: 'Alga', kind: 'box', position: [0, 1.4 + i * 0.2, 0], rotation: [0, i * 50, 0], dimensions: [0.28, 2.8 + i * 0.4, 0.03], collidable: false,
          material: { color: primary ?? '#4f8a3a', texture: 'leaves', textureScale: 1, alphaTest: 0.3, doubleSided: true, roughness: 0.7, metalness: 0 } })
      }
      break
    case 'crystalCluster': {
      const tint = primary ?? '#9b7bff'
      add({ id: 'base', parentId: null, name: 'Base rochosa', kind: 'polyhedron', position: [0, 0.18, 0], dimensions: [1.4, 0.36, 1.2], geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.12, seed: spec.seed % 10 }, material: { ...stone, color: '#6f6a74', flatShading: true } })
      for (let i = 0; i < 5; i++) {
        const angle = i * 1.4 + random(i) * 0.5, height = i ? 0.9 + random(i + 5) * 0.7 : 1.9
        add({ id: `shard${i}`, parentId: null, name: 'Cristal', kind: 'polyhedron', position: [i ? Math.cos(angle) * 0.38 : 0, 0.3 + height * 0.42, i ? Math.sin(angle) * 0.33 : 0], rotation: [i ? Math.sin(angle) * 20 : 0, 0, i ? -Math.cos(angle) * 20 : 0], dimensions: [height * 0.24, height, height * 0.24],
          geometry: { variant: 'octahedron' }, material: { color: '#f2ecff', emissive: tint, emissiveIntensity: 1.8, roughness: 0.08, metalness: 0.1, clearcoat: 1, flatShading: true, transmission: 0.25 } })
      }
      if (spec.lit) add({ id: 'light', parentId: null, name: 'Brilho dos cristais', kind: 'light', position: [0, 1.4, 0], dimensions: [0.1, 0.1, 0.1], light: point(tint, 4, 7) })
      break
    }
    case 'column': {
      const marble: Partial<SceneMaterial> = { color: primary ?? '#e8e2d6', texture: 'marble', textureScale: 1, roughness: 0.55, metalness: 0 }, broken = spec.seed % 3 === 0
      add({ id: 'base', parentId: null, name: 'Base', kind: 'box', position: [0, 0.15, 0], dimensions: [1.2, 0.3, 1.2], material: marble })
      add({ id: 'shaft', parentId: null, name: 'Fuste', kind: 'cylinder', position: [0, broken ? 1.35 : 2.3, 0], dimensions: [0.8, broken ? 2.1 : 4, 0.8], geometry: { segments: 20 }, material: marble })
      if (!broken) add({ id: 'capital', parentId: null, name: 'Capitel', kind: 'box', position: [0, 4.45, 0], dimensions: [1.2, 0.3, 1.2], material: marble })
      else add({ id: 'rubble', parentId: null, name: 'Fragmento', kind: 'polyhedron', position: [1.2, 0.25, 0.4], dimensions: [0.9, 0.5, 0.7], geometry: { variant: 'dodecahedron', detail: 1, bevel: 0.1, seed: spec.seed % 10 }, material: { ...marble, flatShading: true } })
      break
    }
    case 'tent': {
      const canvas: Partial<SceneMaterial> = { color: primary ?? '#d9a35f', texture: 'fabric', textureScale: 2, sheen: 0.4, roughness: 0.9, metalness: 0 }
      add({ id: 'canvas', parentId: null, name: 'Lona', kind: 'extrude', position: [0, 0.8, 0], dimensions: [2.4, 1.6, 2.8], geometry: { profile: [[-1, 0], [1, 0], [0, 1]], bevel: 0 }, material: canvas })
      add({ id: 'door', parentId: null, name: 'Entrada', kind: 'extrude', position: [0, 0.45, 1.44], dimensions: [0.9, 0.9, 0.02], geometry: { profile: [[-1, 0], [1, 0], [0, 1]], bevel: 0 }, material: { color: '#3a2a1c', roughness: 1, metalness: 0 }, collidable: false })
      for (const side of [-1, 1]) {
        add({ id: `pole${side}`, parentId: null, name: 'Mastro', kind: 'cylinder', position: [0, 0.85, side * 1.48], dimensions: [0.05, 1.7, 0.05], material: wood })
        add({ id: `peg${side}`, parentId: null, name: 'Estaca', kind: 'cylinder', position: [side * 1.5, 0.08, 0], dimensions: [0.04, 0.16, 0.04], material: wood, collidable: false })
      }
      break
    }
    case 'car': {
      const paint: Partial<SceneMaterial> = { color: primary ?? '#c0392b', metalness: 0.6, roughness: 0.25, clearcoat: 1 }
      add({ id: 'body', parentId: null, name: 'Carroceria', kind: 'roundedBox', position: [0, 0.68, 0], dimensions: [1.8, 0.7, 4.2], geometry: { bevel: 0.12 }, material: paint })
      add({ id: 'cabin', parentId: null, name: 'Cabine', kind: 'roundedBox', position: [0, 1.25, -0.2], dimensions: [1.6, 0.6, 2.2], geometry: { bevel: 0.15 }, material: { color: '#1d2733', metalness: 0.2, roughness: 0.08, clearcoat: 1 } })
      for (const x of [-1, 1]) for (const z of [-1, 1]) add({ id: `wheel${x}${z}`, parentId: null, name: 'Roda', kind: 'cylinder', position: [x * 0.83, 0.33, z * 1.35], rotation: [0, 0, 90], dimensions: [0.66, 0.26, 0.66], geometry: { segments: 20 }, material: { color: '#1b1b1b', roughness: 0.9, metalness: 0 } })
      for (const x of [-1, 1]) {
        add({ id: `head${x}`, parentId: null, name: 'Farol', kind: 'sphere', position: [x * 0.6, 0.75, 2.08], dimensions: [0.3, 0.16, 0.08], geometry: { segments: 12 }, collidable: false, material: glow(spec.lit ? '#fff1c4' : '#555555', spec.lit ? 3 : 0.2) })
        add({ id: `tail${x}`, parentId: null, name: 'Lanterna', kind: 'sphere', position: [x * 0.65, 0.78, -2.08], dimensions: [0.3, 0.12, 0.08], geometry: { segments: 12 }, collidable: false, material: { color: '#ff4d4d', emissive: '#ff1a1a', emissiveIntensity: spec.lit ? 2 : 0.4, roughness: 0.4, metalness: 0 } })
      }
      break
    }
    case 'boat': {
      const hull: Partial<SceneMaterial> = { ...wood, color: primary ?? '#a0714a', textureScale: 1.2 }
      add({ id: 'hull', parentId: null, name: 'Casco', kind: 'extrude', position: [0, 0.3, 0], rotation: [0, 90, 0], dimensions: [3.6, 0.6, 1.4], geometry: { profile: [[-1.6, 0.2], [-1.2, 0], [1.2, 0], [1.8, 0.6], [-1.7, 0.6]], bevel: 0 }, material: hull })
      for (const z of [-0.6, 0.5]) add({ id: `seat${z}`, parentId: null, name: 'Banco', kind: 'box', position: [0, 0.64, z], dimensions: [1.3, 0.06, 0.3], material: { ...wood, color: secondary ?? '#d9c2a2' } })
      for (const side of [-1, 1]) add({ id: `oar${side}`, parentId: null, name: 'Remo', kind: 'cylinder', position: [side * 0.95, 0.72, 0], rotation: [70, 0, side * 20], dimensions: [0.06, 2.2, 0.06], material: wood, collidable: false })
      break
    }
    case 'skyscraper': {
      const facade: Partial<SceneMaterial> = { color: primary ?? '#8fa6bd', texture: 'tiles', textureScale: 6, metalness: 0.6, roughness: 0.18, clearcoat: 0.6 }
      const floors = 6 + Math.floor(random(1) * 4), height = floors * 3.2
      add({ id: 'lobby', parentId: null, name: 'Térreo', kind: 'box', position: [0, 2, 0], dimensions: [8.4, 4, 8.4], material: { color: '#3a4048', metalness: 0.4, roughness: 0.3 } })
      add({ id: 'tower', parentId: null, name: 'Torre', kind: 'box', position: [0, 4 + height / 2, 0], dimensions: [8, height, 8], material: facade })
      for (let i = 1; i < floors; i += 2) add({ id: `band${i}`, parentId: null, name: 'Faixa de pavimento', kind: 'box', position: [0, 4 + i * 3.2, 0], dimensions: [8.06, 0.25, 8.06], collidable: false,
        material: spec.lit ? glow(secondary ?? '#ffd27a', 1.6) : { color: secondary ?? '#c8ccd2', metalness: 0.5, roughness: 0.4 } })
      add({ id: 'roof', parentId: null, name: 'Cobertura', kind: 'box', position: [0, 4.3 + height, 0], dimensions: [6, 0.6, 6], material: { color: '#4b525b', metalness: 0.3, roughness: 0.6 } })
      add({ id: 'antenna', parentId: null, name: 'Antena', kind: 'cylinder', position: [0, 6.6 + height, 0], dimensions: [0.16, 4, 0.16], material: iron })
      add({ id: 'beacon', parentId: null, name: 'Luz de obstáculo', kind: 'sphere', position: [0, 8.7 + height, 0], dimensions: [0.3, 0.3, 0.3], geometry: { segments: 12 }, collidable: false, material: glow('#ff3030', 3),
        animation: { kind: 'pulse', axis: 'y', duration: 1.5, amplitude: 0.3, phase: 0, start: 'auto', easing: 'smooth', keys: [] } })
      break
    }
  }
  return parts
}

/** Deterministic parametric asset: parts scaled by `size`, with the origin on the ground at the footprint center. */
export function prefabParts(spec: PrefabSpec): PrefabPart[] {
  const s = spec.size
  return build(spec).map((part) => ({ ...part, position: part.position.map((value) => value * s) as Vector3Tuple, dimensions: part.dimensions.map((value) => Math.max(0.01, value * s)) as Vector3Tuple,
    ...(part.light ? { light: { ...part.light, distance: part.light.distance * s } } : {}),
    ...(part.animation?.kind === 'keyframes' ? { animation: { ...part.animation, keys: part.animation.keys!.map((key) => ({ ...key, move: key.move.map((value) => value * s) as Vector3Tuple })) } } : {}),
    ...(part.animation && ['float', 'bounce', 'orbit'].includes(part.animation.kind ?? '') ? { animation: { ...part.animation, amplitude: Math.min(100, (part.animation.amplitude ?? 0) * s) } } : {}) }))
}

/** Reads a prefab spec. Without `adjust` invalid data throws; with it, values are brought inside the contract. Unknown types return null. */
export function prefabSpec(value: unknown, adjust?: (label: string) => void): PrefabSpec | null {
  const fix = (label: string) => { if (!adjust) throw new Error(`Pré-fabricado: ${label} inválido.`); adjust(label) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) { fix('formato'); return null }
  const source = value as Record<string, unknown>
  if (!prefabTypes.includes(source.type as PrefabType)) { fix('tipo'); return null }
  const type = source.type as PrefabType
  let building: BuildingSpec | undefined
  if (source.building !== undefined && source.building !== null) {
    if (typeof source.building === 'object' && !Array.isArray(source.building)) building = readBuilding(source.building as Record<string,unknown>,fix)
    else fix('planta arquitetônica')
  }
  const number = (input: unknown, min: number, max: number, fallback: number, label: string, integer = false) => {
    if (input === undefined || input === null) return fallback
    if (typeof input !== 'number' || !Number.isFinite(input)) { fix(label); return fallback }
    const result = Math.min(max, Math.max(min, integer ? Math.round(input) : input))
    if (result !== input) fix(label)
    return result
  }
  const hex = (input: unknown, label: string) => {
    if (input === undefined || input === null) return null
    if (typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input)) return input
    fix(label); return null
  }
  const text = typeof source.text === 'string' ? source.text.slice(0, 160) : ''
  return { ...(building ? { building } : {}), type, size: number(source.size, 0.3, 5, 1, 'tamanho'), seed: number(source.seed, 0, 9999, 1, 'semente', true), primary: hex(source.primary, 'cor principal'), secondary: hex(source.secondary, 'cor secundária'),
    text, lit: typeof source.lit === 'boolean' ? source.lit : ['lampPost', 'torch', 'campfire'].includes(type), interactive: typeof source.interactive === 'boolean' ? source.interactive : true }
}

function readBuilding(source: Record<string, unknown>, fix: (label: string) => void): BuildingSpec {
  const out: BuildingSpec = {}
  if (source.style != null) {
    if (['cottage', 'townhouse', 'lodge', 'villa'].includes(String(source.style))) out.style = source.style as BuildingSpec['style']
    else fix('estilo arquitetônico')
  }
  for (const [key, low, high] of [['floors', 1, 2], ['width', 7.5, 16], ['depth', 8.5, 16]] as const) {
    const value = source[key]
    if (value == null) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) { fix(key); continue }
    const next = Math.max(low, Math.min(high, key === 'floors' ? Math.round(value) : value))
    if (next !== value) fix(key)
    out[key] = next
  }
  if (source.furnished != null) { if (typeof source.furnished === 'boolean') out.furnished = source.furnished; else fix('mobiliário') }
  return out
}
