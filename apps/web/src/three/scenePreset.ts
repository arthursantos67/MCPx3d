import { createEmptyScene, createNode, validateScene, type NodeKind, type SceneNode, type Vector3Tuple } from './sceneDocument.ts'

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
    const sculpture = add(`Escultura ${x}`, 'torus', interior, [x, 1.9, -0.6], [1.15, 1.15, 0.35], '#b79056', 0.85, 0.23)
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
  for (let i = 0; i < 7; i++) add(`Passarela ${i + 1}`, 'box', landscape, [-2.1 + i * 0.7, 0.025, 5], [0.6, 0.05, 1.1], '#9faaa4')
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
