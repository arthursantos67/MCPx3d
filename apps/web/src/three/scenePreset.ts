import { createEmptyScene, createNode, validateScene, type NodeKind, type SceneMaterial, type SceneNode, type Vector3Tuple } from './sceneDocument.ts'
import { hashNoise, terrainHeightAt, terrainHeights } from './sceneGeometrySpec.ts'

/** Fully local and deterministic example: no network assets or generated scripts. */
export function createPavilionScene() {
  const doc = createEmptyScene()
  doc.name = 'Pavilhão Aurora'
  doc.environment.grid = false
  const nodes: SceneNode[] = []
  const add = (name: string, kind: NodeKind, parentId: string | null, position: Vector3Tuple, dimensions: Vector3Tuple,
    color: string, metalness = 0.1, roughness = 0.65) => {
    const node = { ...createNode(kind, parentId), id: `pavilion-${nodes.length}`, name, position, dimensions,
      material: { color, metalness, roughness } }
    nodes.push(node)
    return node.id
  }
  const architecture = add('Arquitetura', 'group', null, [0, 0, 0], [1, 1, 1], '#ffffff')
  add('Plataforma', 'box', architecture, [0, -0.2, 0], [16, 0.4, 12], '#d4cec2')
  add('Piso elevado', 'box', architecture, [0, 0.15, 0], [10, 0.3, 7], '#e3ddd1')
  add('Degrau de entrada', 'box', architecture, [0, 0.05, 4], [6, 0.1, 1], '#bbb4a5')
  for (const z of [-3.5, 3.5]) add(`Borda da cobertura ${z}`, 'box', architecture, [0, 3.9, z], [11, 0.25, 1], '#dcd8cb')
  for (const x of [-5, 5]) add(`Lateral da cobertura ${x}`, 'box', architecture, [x, 3.9, 0], [1, 0.25, 6], '#dcd8cb')
  const columns = add('Estrutura e lâminas', 'group', architecture, [0, 0, 0], [1, 1, 1], '#ffffff')
  for (const x of [-4.4, 4.4]) for (const z of [-2.8, 2.8]) {
    add(`Coluna ${x} / ${z}`, 'cylinder', columns, [x, 2, z], [0.2, 3.5, 0.2], '#47616a', 0.7, 0.32)
  }
  for (let i = 0; i < 27; i++) add(`Lâmina ${i + 1}`, 'box', columns, [-4.8 + i * 0.37, 3.55, 0], [0.09, 0.45, 7.4], '#ab8052')
  for (let i = 0; i < 19; i++) add(`Painel posterior ${i + 1}`, 'box', columns, [-3.6 + i * 0.4, 1.85, -2.9], [0.16, 3, 0.16], '#ab8052')
  const interior = add('Galeria', 'group', architecture, [0, 0, 0], [1, 1, 1], '#ffffff')
  for (const x of [-2.6, 0, 2.6]) {
    add(`Pedestal ${x}`, 'cylinder', interior, [x, 0.85, -0.6], [0.85, 1.1, 0.85], '#8b9692')
    const sculpture = add(`Escultura ${x}`, 'torus', interior, [x, 2, -0.6], [1.15, 1.15, 0.35], '#b79056', 0.85, 0.23)
    const animated = nodes.find((node) => node.id === sculpture)!
    animated.rotation = [0, x * 12, 0]
    animated.animation = { kind: 'spin', axis: 'y', duration: 8, amplitude: 0, phase: 0 }
    add(`Luminária ${x}`, 'sphere', interior, [x, 3.25, -0.6], [0.2, 0.2, 0.2], '#fff2c9', 0.1, 0.25)
  }
  const landscape = add('Paisagismo', 'group', null, [0, 0, 0], [1, 1, 1], '#ffffff')
  for (const x of [-6.4, 6.4]) for (const z of [-3.6, 0, 3.6]) {
    add(`Vaso ${x} / ${z}`, 'cylinder', landscape, [x, 0.35, z], [1.1, 0.7, 1.1], '#8c7663')
    add(`Tronco ${x} / ${z}`, 'cylinder', landscape, [x, 1.1, z], [0.12, 1.2, 0.12], '#73614a')
    add(`Copa ${x} / ${z}`, 'sphere', landscape, [x, 1.9, z], [1.45, 1.9, 1.45], '#65836b')
  }
  for (let i = 0; i < 7; i++) add(`Passarela ${i + 1}`, 'box', landscape, [-2.1 + i * 0.7, 0.025, 5.1], [0.6, 0.05, 1.1], '#9faaa4')
  return validateScene({ ...doc, nodes })
}

/** A procedural reference scene using profiles, swept tubes, bevels and physical finishes. */
export function createOrbitalScene() {
  const doc = createEmptyScene()
  doc.name = 'Observatório Helix'
  doc.environment = { ...doc.environment, background: '#101d30', grid: false, lightIntensity: 2, exposure: 1.05 }
  doc.timeline.duration = 24
  const nodes: SceneNode[] = []
  const add = (name: string, kind: NodeKind, parentId: string | null, position: Vector3Tuple, dimensions: Vector3Tuple, color: string) => {
    const node = { ...createNode(kind, parentId), id: `helix-${nodes.length}`, name, position, dimensions,
      material: { ...createNode(kind).material, color, metalness: 0.75, roughness: 0.28, clearcoat: 0.35 } }
    nodes.push(node)
    return node
  }
  const core = add('Corpo de revolução', 'lathe', null, [0, 3, 0], [3.5, 6, 3.5], '#a6b5c7')
  core.geometry.profile = [[0, -0.5], [0.18, -0.5], [0.22, -0.42], [0.22, -0.28], [0.4, -0.22], [0.48, -0.1], [0.48, 0.12], [0.36, 0.18], [0.3, 0.32], [0.16, 0.38], [0.14, 0.48], [0, 0.5]]
  core.material.texture = 'metal'
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4
    const pipe = add(`Conduto curvo ${i + 1}`, 'tube', null, [2.15 * Math.cos(angle), 3, 2.15 * Math.sin(angle)], [0.5, 3.6, 0.4], '#cba76b')
    pipe.geometry.points = [[-0.15, -0.5, 0], [-0.4, -0.35, 0], [0.4, 0.2, 0], [0.15, 0.5, 0]]
    pipe.geometry.radius = 0.035
    pipe.rotation = [0, -i * 45, 0]
    pipe.overlapWith = [core.id]
  }
  const rotor = add('Rotor orbital completo', 'group', null, [0, 3.2, 0], [1, 1, 1], '#ffffff')
  rotor.animation = { kind: 'spin', axis: 'y', duration: 24, amplitude: 0, phase: 0 }
  const ring = add('Anel estrutural', 'torus', rotor.id, [0, 0, 0], [13, 13, 0.26], '#6b839a')
  ring.rotation = [90, 0, 0]
  ring.geometry.radius = 0.012
  for (const y of [-0.22, 0.22]) {
    const strip = add(`Trilho emissivo ${y}`, 'torus', rotor.id, [0, y, 0], [12.95, 12.95, 0.035], '#b6eef7')
    strip.rotation = [90, 0, 0]
    strip.geometry.radius = 0.002
    strip.material.emissive = '#3bd9fa'; strip.material.emissiveIntensity = 1.8
  }
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6
    const module = add(`Módulo chanfrado ${i + 1}`, 'extrude', rotor.id, [6.25 * Math.cos(angle), 0.6, 6.25 * Math.sin(angle)], [0.9, 0.65, 1.2], i % 2 ? '#b8c6d2' : '#c49a61')
    module.geometry.profile = [[-0.5, -0.2], [-0.3, -0.5], [0.3, -0.5], [0.5, -0.2], [0.5, 0.3], [0.25, 0.5], [-0.25, 0.5], [-0.5, 0.3]]
    module.geometry.bevel = 0.055
    module.rotation = [0, -i * 30, 0]
    const mount = add(`Suporte do módulo ${i + 1}`, 'roundedBox', rotor.id, [6.25 * Math.cos(angle), 0.14, 6.25 * Math.sin(angle)], [0.15, 0.3, 0.15], '#475768')
    mount.overlapWith = [ring.id, module.id]
    const port = add(`Visor ${i + 1}`, 'roundedBox', rotor.id, [6.25 * Math.cos(angle), 0.96, 6.25 * Math.sin(angle)], [0.5, 0.06, 0.65], '#1d718e')
    port.rotation = [0, -i * 30, 0]
    port.material.transmission = 0.35; port.material.clearcoat = 1
    for (const offset of [-0.22, 0.22]) {
      const bolt = add(`Fixador ${i + 1}/${offset}`, 'cylinder', rotor.id, [6.25 * Math.cos(angle) + offset * Math.cos(-angle), 1.01, 6.25 * Math.sin(angle) + offset * Math.sin(angle)], [0.055, 0.045, 0.055], '#e2d5a9')
      bolt.overlapWith = [port.id]
    }
  }
  for (const side of [-1, 1]) {
    const wing = add(`Asa solar ${side}`, 'group', null, [side * 10.5, 0.8, 0], [1, 1, 1], '#ffffff')
    const support = add(`Longarina ${side}`, 'roundedBox', null, [side * 5.3, 0.65, 0], [9.2, 0.24, 0.24], '#9cabb9')
    support.overlapWith = [core.id]
    for (let panelIndex = 0; panelIndex < 3; panelIndex++) {
      const panel = add(`Painel solar ${side}/${panelIndex + 1}`, 'roundedBox', wing.id, [-1.6 + panelIndex * 1.6, 0, 0], [1.45, 0.1, 5.6], '#ffffff')
      panel.overlapWith = [support.id]
      panel.material.texture = 'solar'; panel.material.textureScale = 3; panel.material.clearcoat = 0.8; panel.material.metalness = 0.35
      for (let rib = 0; rib < 9; rib++) {
        const frame = add(`Nervura ${side}/${panelIndex}/${rib}`, 'roundedBox', wing.id, [-1.6 + panelIndex * 1.6, 0.08, -2.6 + rib * 0.65], [1.46, 0.04, 0.035], '#d1bf98')
        frame.overlapWith = [panel.id]
      }
    }
  }
  const beacon = add('Coroa do observatório', 'torusKnot', null, [0, 6.9, 0], [1.6, 1.4, 1.6], '#dbb971')
  beacon.animation = { kind: 'spin', axis: 'y', duration: 8, amplitude: 0, phase: 0 }
  beacon.material.clearcoat = 1
  const field = add('Baliza de energia', 'sphere', null, [0, 8, 0], [0.12, 0.12, 0.12], '#b6f0fa')
  field.material.emissive = '#33bddb'; field.material.emissiveIntensity = 2
  return validateScene({ ...doc, nodes })
}

/** Playable reference: terrain, practical lights, an interactive door, collectibles and scattered detail. */
export function createIslandScene() {
  const doc = createEmptyScene()
  doc.name = 'Ilha do Farol'
  doc.timeline.duration = 24
  doc.environment = { ...doc.environment, sky: 'sunset', sunElevation: 9, sunAzimuth: 60, fog: 0.0018, bloom: 0.45, exposure: 1, lightIntensity: 1.6, grid: false, toneMapping: 'aces' }
  const nodes: SceneNode[] = []
  const add = (name: string, kind: NodeKind, parentId: string | null, position: Vector3Tuple, dimensions: Vector3Tuple, material: Partial<SceneMaterial> = {}, extra: Partial<SceneNode> = {}) => {
    const base = createNode(kind, parentId)
    const node: SceneNode = { ...base, id: `island-${nodes.length}`, name, position, dimensions, material: { ...base.material, color: '#d8d2c4', metalness: 0, roughness: 0.8, texture: 'none', textureScale: 1, ...material }, ...extra }
    nodes.push(node)
    return node
  }
  const spin = (duration: number, phase = 0) => ({ kind: 'spin' as const, axis: 'y' as const, duration, amplitude: 0, phase, start: 'auto' as const, easing: 'smooth' as const, keys: [] })
  const sea = add('Mar', 'plane', null, [0, 0, 0], [400, 0.01, 400], { color: '#8fc3cf', texture: 'water', textureScale: 64, roughness: 0.45, metalness: 0, clearcoat: 0, normalStrength: 0.8 }, { collidable: false })
  const terrain = add('Ilha', 'terrain', null, [0, 2.2, 0], [96, 6.5, 96], { color: '#c9d6a0', texture: 'grass', textureScale: 28, roughness: 0.95 }, { overlapWith: [sea.id] })
  terrain.geometry = { ...terrain.geometry, segments: 96, detail: 4, seed: 11, closed: true }
  const heights = terrainHeights(terrain.geometry)
  const ground = (x: number, z: number) => terrain.position[1] + terrainHeightAt(terrain.geometry, x / 96, z / 96, heights) * 6.5
  const occupied: [number, number, number][] = []
  const free = (x: number, z: number, r: number) => occupied.every(([ox, oz, or]) => Math.hypot(x - ox, z - oz) >= r + or)
  const level = (x: number, z: number, r: number) => {
    const samples = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]].map(([dx, dz]) => ground(x + dx, z + dz))
    return { min: Math.min(...samples), max: Math.max(...samples) }
  }
  const spot = (x: number, z: number, r: number, minHeight: number, maxSlope: number) => {
    for (let ring = 0; ring < 60; ring++) for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const angle = k / Math.max(1, ring * 6) * Math.PI * 2, px = x + Math.cos(angle) * ring, pz = z + Math.sin(angle) * ring, h = level(px, pz, r)
      if (h.min > minHeight && h.max - h.min < maxSlope && free(px, pz, r)) { occupied.push([px, pz, r]); return { x: px, z: pz, ...h } }
    }
    throw new Error('Exemplo jogável: não há espaço livre no terreno.')
  }
  const wood: Partial<SceneMaterial> = { color: '#e0cbb0', texture: 'wood', textureScale: 1.5, roughness: 0.75 }
  const stone: Partial<SceneMaterial> = { color: '#d6d0c6', texture: 'rock', textureScale: 2, roughness: 0.9 }
  const metal: Partial<SceneMaterial> = { color: '#2d343c', metalness: 0.85, roughness: 0.3 }

  const start = spot(4, 30, 2.5, 0.5, 1.4)
  doc.environment.player = { spawn: [start.x, start.max + 0.05, start.z], yaw: 0, speed: 4.5, jumpHeight: 1.1, mode: 'walk' }

  const sign = spot(start.x + 4, start.z - 3, 1.5, 0.4, 1.6)
  const lift = sign.max - sign.min
  const signGroup = add('Placa de boas-vindas', 'group', null, [sign.x, sign.min, sign.z], [1, 1, 1], {}, { rotation: [0, -20, 0] })
  for (const side of [-1, 1]) add(`Poste da placa ${side}`, 'cylinder', signGroup.id, [side * 1.05, (2.3 + lift) / 2 - 0.25, 0], [0.14, 2.3 + lift, 0.14], wood, { overlapWith: [terrain.id] })
  add('Tábua da placa', 'roundedBox', signGroup.id, [0, 1.75 + lift, 0.13], [2.4, 1.1, 0.1], wood)
  const label = add('Texto da placa', 'text', signGroup.id, [0, 1.75 + lift, 0.19], [2.2, 0.95, 0.01], { color: '#2b1d10', roughness: 0.6 },
    { interaction: { trigger: 'click', key: '', radius: 4, action: 'message', targetId: null, message: 'O faroleiro escondeu 8 cristais. Um deles está dentro da cabana.' } })
  label.geometry = { ...label.geometry, text: 'Ilha do Farol\nColete os 8 cristais · E abre a porta · 1 liga as lanternas' }

  const cabin = spot(-12, 4, 7.2, 0.9, 2.6)
  const cabinBase = cabin.max + 0.05, footing = cabinBase - cabin.min + 0.4
  const house = add('Cabana do faroleiro', 'group', null, [cabin.x, cabinBase, cabin.z], [1, 1, 1])
  add('Fundação de pedra', 'box', house.id, [0, -footing / 2, 1], [8.4, footing, 9.4], stone, { overlapWith: [terrain.id] })
  add('Assoalho e varanda', 'box', house.id, [0, 0.2, 1], [8, 0.4, 9], { ...wood, textureScale: 3 })
  const walls: Partial<SceneMaterial> = { color: '#f1e7d8', texture: 'plaster', textureScale: 2, roughness: 0.92 }
  add('Parede dos fundos', 'box', house.id, [0, 1.8, -3.4], [8, 2.8, 0.2], walls)
  for (const side of [-1, 1]) {
    add(`Parede lateral ${side}`, 'box', house.id, [side * 3.9, 1.8, 0], [0.2, 2.8, 6.6], walls)
    add(`Caixilho da janela ${side}`, 'box', house.id, [side * 4.04, 2, -0.5], [0.08, 1, 1.4], { color: '#6b4a2f', roughness: 0.6 })
    add(`Peitoril ${side}`, 'box', house.id, [side * 4.125, 1.45, -0.5], [0.25, 0.08, 1.6], stone)
    add(`Segmento frontal ${side}`, 'box', house.id, [side * 2.35, 1.8, 3.4], [3.3, 2.8, 0.2], walls)
  }
  add('Verga da porta', 'box', house.id, [0, 2.9, 3.4], [1.4, 0.6, 0.2], { color: '#6b4a2f', texture: 'wood', textureScale: 1 })
  const roof = add('Telhado', 'extrude', house.id, [0, 4.3, 0], [9.2, 2.2, 7.8], { color: '#c7735a', texture: 'tiles', textureScale: 4, roughness: 0.7 })
  roof.geometry = { ...roof.geometry, profile: [[-4.6, 0], [4.6, 0], [0, 2.2]], bevel: 0 }
  add('Chaminé', 'box', house.id, [2.4, 4.7, -1.5], [0.6, 1.6, 0.6], { color: '#d9b8a8', texture: 'brick', textureScale: 1 }, { overlapWith: [roof.id] })
  const hinge = add('Porta (dobradiça)', 'group', house.id, [-0.6, 0.4, 3.45], [1, 1, 1], {}, {
    animation: { kind: 'keyframes', axis: 'y', duration: 1.1, amplitude: 0, phase: 0, start: 'trigger', easing: 'smooth', keys: [{ at: 0, move: [0, 0, 0], turn: [0, 0, 0], scale: [1, 1, 1] }, { at: 1, move: [0, 0, 0], turn: [0, -105, 0], scale: [1, 1, 1] }] } })
  add('Porta de madeira', 'roundedBox', hinge.id, [0.6, 1.08, 0], [1.2, 2.15, 0.08], { ...wood, color: '#b98a5e' },
    { interaction: { trigger: 'click', key: '', radius: 3.5, action: 'toggleAnimation', targetId: hinge.id, message: '' } })
  add('Mesa', 'box', house.id, [-1.8, 1.17, -1.9], [1.4, 0.06, 0.8], wood)
  for (const [dx, dz] of [[-0.6, -0.32], [0.6, -0.32], [-0.6, 0.32], [0.6, 0.32]]) add(`Perna da mesa ${dx}/${dz}`, 'cylinder', house.id, [-1.8 + dx, 0.77, -1.9 + dz], [0.06, 0.74, 0.06], wood)
  add('Cama', 'roundedBox', house.id, [2.4, 0.7, -2.1], [1.6, 0.6, 2.2], { color: '#c8d0e0', texture: 'fabric', textureScale: 3, sheen: 0.6 })
  add('Tapete', 'plane', house.id, [0.2, 0.405, 0.4], [2.4, 0.01, 1.6], { color: '#d88a6a', texture: 'fabric', textureScale: 4 }, { collidable: false })
  add('Cúpula do abajur', 'lathe', house.id, [-2.25, 1.38, -2.05], [0.36, 0.3, 0.36], { color: '#f6e4c0', emissive: '#ffcf8a', emissiveIntensity: 1.6 })
  add('Luz do abajur', 'light', house.id, [-2.25, 1.9, -2.05], [0.2, 0.2, 0.2], {}, { light: { type: 'point', color: '#ffc985', intensity: 6, distance: 9, angle: 35, penumbra: 0.4, castShadow: false } })

  const gemMaterial: Partial<SceneMaterial> = { color: '#9ff3ff', emissive: '#2fd6ff', emissiveIntensity: 3, metalness: 0.1, roughness: 0.08, clearcoat: 1, flatShading: true }
  const gem = (name: string, parentId: string | null, position: Vector3Tuple, phase: number) => {
    const node = add(name, 'polyhedron', parentId, position, [0.42, 0.66, 0.42], gemMaterial,
      { collidable: false, animation: spin(3, phase), interaction: { trigger: 'proximity', key: '', radius: 1.4, action: 'collect', targetId: null, message: '' } })
    node.geometry = { ...node.geometry, variant: 'octahedron' }
  }
  gem('Cristal da cabana', house.id, [-1.4, 1.6, -1.8], 0)

  const tower = spot(18, -14, 4.6, 1.2, 3)
  const towerBase = tower.max + 0.05, plinth = towerBase - tower.min + 0.6
  const lighthouse = add('Farol', 'group', null, [tower.x, towerBase, tower.z], [1, 1, 1])
  add('Base do farol', 'cylinder', lighthouse.id, [0, 0.3 - plinth / 2, 0], [7, plinth, 7], stone, { overlapWith: [terrain.id] })
  const shaft = add('Torre', 'lathe', lighthouse.id, [0, 6.3, 0], [3.2, 12, 3.2], { color: '#fbf6ee', texture: 'plaster', textureScale: 3, roughness: 0.85 })
  shaft.geometry = { ...shaft.geometry, segments: 64, profile: [[0, 0], [1.6, 0], [1.55, 0.15], [1.2, 0.97], [1.25, 1], [0, 1]] }
  for (const [index, y] of [3.6, 8.2].entries()) add(`Faixa vermelha ${index + 1}`, 'cylinder', lighthouse.id, [0, y, 0], [y < 5 ? 3.2 : 2.85, 1.2, y < 5 ? 3.2 : 2.85], { color: '#c43d32', roughness: 0.5, clearcoat: 0.6 }, { overlapWith: [shaft.id] })
  add('Porta do farol', 'roundedBox', lighthouse.id, [0, 1.3, 1.52], [0.9, 1.9, 0.12], { color: '#4b5d70', metalness: 0.6, roughness: 0.4 }, { overlapWith: [shaft.id] })
  const deck = add('Galeria', 'cylinder', lighthouse.id, [0, 12.4, 0], [3.8, 0.2, 3.8], { color: '#3d4650', metalness: 0.8, roughness: 0.35 }, { overlapWith: [shaft.id] })
  const rail = add('Guarda-corpo', 'torus', lighthouse.id, [0, 13.2, 0], [3.7, 3.7, 0.06], metal, { rotation: [90, 0, 0] })
  rail.geometry = { ...rail.geometry, radius: 0.01, segments: 64 }
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2
    add(`Balaústre ${i + 1}`, 'cylinder', lighthouse.id, [Math.cos(angle) * 1.825, 12.85, Math.sin(angle) * 1.825], [0.05, 0.7, 0.05], metal, { overlapWith: [rail.id, deck.id] })
  }
  const glass = add('Sala da lanterna', 'cylinder', lighthouse.id, [0, 13.3, 0], [2.2, 1.6, 2.2], { color: '#e8f6ff', transmission: 0.92, roughness: 0.04, ior: 1.5, thickness: 0.05, metalness: 0 })
  add('Cúpula', 'cone', lighthouse.id, [0, 14.7, 0], [2.6, 1.2, 2.6], { color: '#c43d32', metalness: 0.5, roughness: 0.35, clearcoat: 0.8 })
  add('Pináculo', 'sphere', lighthouse.id, [0, 15.45, 0], [0.3, 0.3, 0.3], { color: '#d8b65c', metalness: 1, roughness: 0.25 })
  const rotor = add('Lanterna giratória', 'group', lighthouse.id, [0, 13.4, 0], [1, 1, 1], {}, { animation: spin(8) })
  add('Lâmpada do farol', 'sphere', rotor.id, [0, 0, 0], [0.5, 0.5, 0.5], { color: '#fff6d6', emissive: '#ffe7a3', emissiveIntensity: 5 }, { collidable: false, overlapWith: [glass.id] })
  for (const side of [1, -1]) {
    add(`Holofote ${side}`, 'light', rotor.id, [0, 0, 0], [0.25, 0.25, 0.25], {}, { rotation: [0, 0, side * 90], light: { type: 'spot', color: '#fff0c8', intensity: 600, distance: 140, angle: 9, penumbra: 0.5, castShadow: false } })
    add(`Feixe ${side}`, 'cone', rotor.id, [side * 5, 0, 0], [1.5, 9, 1.5], { color: '#fff3c4', emissive: '#fff0c0', emissiveIntensity: 1.4, opacity: 0.1, transparent: true, roughness: 1 },
      { rotation: [0, 0, side * 90], collidable: false, overlapWith: [glass.id] })
  }

  const fire = spot(cabin.x + 7, cabin.z + 10, 1.6, 0.6, 1)
  const camp = add('Fogueira', 'group', null, [fire.x, fire.max, fire.z], [1, 1, 1])
  for (let i = 0; i < 6; i++) {
    const angle = i / 6 * Math.PI * 2
    const pebble = add(`Pedra da fogueira ${i + 1}`, 'polyhedron', camp.id, [Math.cos(angle) * 0.75, 0.02, Math.sin(angle) * 0.75], [0.32, 0.26, 0.3], { ...stone, flatShading: true }, { overlapWith: [terrain.id], rotation: [0, i * 37, 0] })
    pebble.geometry = { ...pebble.geometry, variant: 'dodecahedron', bevel: 0.12, seed: i }
  }
  const logA = add('Lenha A', 'cylinder', camp.id, [0, 0.1, 0], [0.16, 1, 0.16], wood, { rotation: [0, 30, 82], overlapWith: [terrain.id] })
  const logB = add('Lenha B', 'cylinder', camp.id, [0, 0.25, 0], [0.16, 1, 0.16], wood, { rotation: [0, -40, 82], overlapWith: [terrain.id, logA.id] })
  add('Chama', 'cone', camp.id, [0, 0.75, 0], [0.5, 0.8, 0.5], { color: '#ffb347', emissive: '#ff7a1a', emissiveIntensity: 2.5, opacity: 0.85, transparent: true },
    { collidable: false, overlapWith: [logA.id, logB.id], animation: { kind: 'pulse', axis: 'y', duration: 0.6, amplitude: 0.12, phase: 0, start: 'auto', easing: 'smooth', keys: [] } })
  add('Luz da fogueira', 'light', camp.id, [0, 1.4, 0], [0.2, 0.2, 0.2], {}, { light: { type: 'point', color: '#ff9a4a', intensity: 6, distance: 10, angle: 35, penumbra: 0.4, castShadow: true } })

  const lamps = add('Luzes das lanternas', 'group', null, [0, 0, 0], [1, 1, 1], {}, { interaction: { trigger: 'key', key: '1', radius: 3, action: 'toggleVisibility', targetId: null, message: 'Lanternas alternadas.' } })
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6, side = i % 2 ? 1 : -1
    const px = start.x + (cabin.x - start.x) * t + side * 1.8, pz = start.z + (cabin.z + 7 - start.z) * t
    if (!free(px, pz, 0.5)) continue
    occupied.push([px, pz, 0.5])
    const h = level(px, pz, 0.1)
    add(`Poste da lanterna ${i + 1}`, 'cylinder', null, [px, h.min + 1.05, pz], [0.12, 2.3, 0.12], { color: '#2f3338', metalness: 0.8, roughness: 0.45 }, { overlapWith: [terrain.id] })
    add(`Lanterna ${i + 1}`, 'roundedBox', null, [px, h.min + 2.4, pz], [0.32, 0.4, 0.32], { color: '#ffe2a8', emissive: '#ffb64d', emissiveIntensity: 2.2 })
    add(`Luz da lanterna ${i + 1}`, 'light', lamps.id, [px, h.min + 2.4, pz], [0.15, 0.15, 0.15], {}, { light: { type: 'point', color: '#ffc477', intensity: 4, distance: 9, angle: 35, penumbra: 0.4, castShadow: false } })
  }

  const scatter = (count: number, radius: number, minHeight: number, seed: number, place: (x: number, z: number, h: { min: number; max: number }, index: number) => void) => {
    let placed = 0
    for (let attempt = 0; attempt < count * 30 && placed < count; attempt++) {
      const x = (hashNoise(attempt, 1, seed) - 0.5) * 80, z = (hashNoise(attempt, 2, seed) - 0.5) * 80, h = level(x, z, radius * 0.5)
      if (h.min < minHeight || h.max - h.min > radius * 0.9 || !free(x, z, radius)) continue
      occupied.push([x, z, radius])
      place(x, z, h, placed++)
    }
  }
  scatter(7, 0.9, 0.8, 21, (x, z, h, index) => gem(`Cristal ${index + 1}`, null, [x, h.max + 1.1, z], index * 40))
  scatter(28, 2.1, 0.9, 31, (x, z, h, index) => {
    const trunk = add(`Tronco ${index + 1}`, 'cylinder', null, [x, h.min + 1.35, z], [0.34, 3, 0.34], { color: '#d2b494', texture: 'wood', textureScale: 0.6, roughness: 0.9 }, { overlapWith: [terrain.id] })
    const crown = add(`Copa ${index + 1}`, 'polyhedron', null, [x, h.min + 3.9, z], [2.6, 3, 2.6], { color: '#c9e0b0', texture: 'leaves', textureScale: 1.5, flatShading: true, roughness: 0.85 }, { collidable: false, overlapWith: [trunk.id], rotation: [0, index * 47 % 360 - 180, 0] })
    crown.geometry = { ...crown.geometry, detail: 1, bevel: 0.12, seed: 4 }
    const top = add(`Copa alta ${index + 1}`, 'polyhedron', null, [x, h.min + 5.4, z], [1.7, 2, 1.7], { color: '#d6ebc0', texture: 'leaves', textureScale: 1.2, flatShading: true, roughness: 0.85 }, { collidable: false, overlapWith: [crown.id], rotation: [0, index * 71 % 360 - 180, 0] })
    top.geometry = { ...top.geometry, detail: 1, bevel: 0.12, seed: 9 }
  })
  scatter(16, 1.2, 0.2, 41, (x, z, h, index) => {
    const size = 0.7 + hashNoise(index, 3, 41) * 0.9
    const rock = add(`Rocha ${index + 1}`, 'polyhedron', null, [x, h.min + size * 0.25, z], [size * 1.3, size, size * 1.1], { ...stone, flatShading: true }, { overlapWith: [terrain.id], rotation: [0, index * 53 % 360 - 180, 0] })
    rock.geometry = { ...rock.geometry, variant: 'dodecahedron', detail: 1, bevel: 0.16, seed: 3 + index % 3 }
  })
  scatter(150, 0.38, 0.5, 51, (x, z, h, index) => add(`Tufo de grama ${index + 1}`, 'cone', null, [x, h.min + 0.18, z], [0.3, 0.5, 0.3], { color: '#7fa64a', roughness: 0.9 }, { collidable: false, overlapWith: [terrain.id], rotation: [0, index * 29 % 360 - 180, 0] }))
  return validateScene({ ...doc, nodes })
}
