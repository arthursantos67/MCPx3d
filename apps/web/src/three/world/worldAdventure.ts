import { createEmptyScene, createNode, validateScene, validateMaterial, type SceneNode, type ThreeSceneDocument, type Vector3Tuple } from '../sceneDocument.ts'
import { prefabParts, prefabRootBehavior, type PrefabSpec, type PrefabType } from '../scenePrefabs.ts'
import type { SceneGameplay } from '../sceneGameplay.ts'

function asset(type: PrefabType, id: string, position: Vector3Tuple, changes: Partial<SceneNode> = {}): SceneNode[] {
  const spec: PrefabSpec = { type, size: 1, seed: id.length * 7 + 3, primary: null, secondary: null, text: '', lit: type === 'campfire', interactive: false }
  const behavior = prefabRootBehavior(spec)
  return [{ ...createNode('group'), id, name: id, position, asset: spec, ...(behavior ? { behavior } : {}), ...changes }, ...prefabParts(spec).map(part => ({
    ...createNode(part.kind), id: `${id}.${part.id}`, parentId: part.parentId ? `${id}.${part.parentId}` : id, assetPart: part.id, name: part.name,
    position: part.position, rotation: part.rotation ?? [0, 0, 0], dimensions: part.dimensions, collidable: part.collidable ?? true,
    geometry: { ...createNode(part.kind).geometry, ...part.geometry }, material: validateMaterial({ color: '#aaa58b', metalness: 0, roughness: 0.8, ...part.material }),
    animation: { ...createNode(part.kind).animation, ...part.animation }, ...(part.light ? { light: part.light } : {}), ...(part.sound ? { sound: part.sound } : {})
  }))]
}
export function adventureLocation(kind: 'camp' | 'ruins' | 'beacon'): ThreeSceneDocument {
  const nodes: SceneNode[] = []
  if (kind === 'camp') {
    nodes.push(...asset('villager', 'mara', [0, 0, -3.2], { name: 'Mara · guardiã do posto', behavior: { type: 'npc', speed: 0, range: 2, damage: 0, reaction: 'greet' },
      interaction: { trigger: 'click', key: '', radius: 4, action: 'dialogue', targetId: null, message: 'A tempestade apagou nosso farol. Precisamos avisar os barcos antes da noite. Junte seis madeiras e três pedras aqui no posto: mire e dê golpes com E. | Abra a mochila com B. Faça um sinal de resgate com madeira, pedra e fibra dos arbustos. Leve-o às ruínas, recupere o núcleo e siga ao farol. | O núcleo está no altar das ruínas, guardado por dois lobos. Use a espada e esquive com Q. O caminho de terra liga os três postos.' } }))
    nodes.push(...asset('campfire', 'fogueira', [0, 0, 7], { name: 'Fogueira do posto', sound: { preset: 'fire', volume: 0.6, radius: 12 } }), ...asset('bench', 'banco', [4, 0, 7]), ...asset('barrel', 'barril', [-4, 0, 7]))
    for (const [i, point] of [[7, -5], [-8, -7], [12, 7]].entries()) nodes.push(...asset('tree', `arvore${i}`, [point[0], 0, point[1]], { name: 'Árvore do posto', resource: { item: 'Madeira', amount: 3, health: 4 } }))
    for (const [i, point] of [[-6, 3], [9, 0]].entries()) nodes.push(...asset('rock', `rocha${i}`, [point[0], 0, point[1]], { name: 'Rocha de pedra', resource: { item: 'Pedra', amount: 3, health: 4 } }))
    for (const [i, point] of [[4, -7], [-4, -9]].entries()) nodes.push(...asset('bush', `fibra${i}`, [point[0], 0, point[1]], { name: 'Arbusto de fibra', resource: { item: 'Fibra', amount: 2, health: 2 } }))
    nodes.push(...asset('mushroom', 'cogumelos', [4, 0, 2], { name: 'Cogumelos comestíveis', resource: { item: 'Cogumelo', amount: 2, health: 1 } }))
    nodes.push({ ...createNode('cylinder'), id: 'checkpoint', name: 'Posto seguro', position: [0, 0.05, 0], dimensions: [2, 0.1, 2], collidable: false, material: validateMaterial({ color: '#d4b56a', metalness: 0.2, roughness: 0.7 }), behavior: { type: 'checkpoint', speed: 0, range: 2, damage: 0 } })
  } else if (kind === 'ruins') {
    nodes.push(...asset('ruinArch', 'arco', [0, 0, -6], { name: 'Arco do antigo santuário' }), ...asset('statue', 'estatua', [0, 0, -12], { name: 'Guardião de pedra' }))
    nodes.push(...asset('wolf', 'lobo1', [-5, 0, 0], { name: 'Lobo das ruínas', behavior: { type: 'enemy', speed: 3.2, range: 12, damage: 10, health: 4, attack: 'melee' } }),
      ...asset('wolf', 'lobo2', [5, 0, -3], { name: 'Lobo do santuário', behavior: { type: 'enemy', speed: 3, range: 12, damage: 10, health: 4, attack: 'charge' } }))
    nodes.push({ ...createNode('polyhedron'), id: 'nucleo', name: 'Núcleo do farol', position: [0, 1.2, -8], dimensions: [0.55, 0.8, 0.55], collidable: false,
      material: validateMaterial({ color: '#68d5c6', emissive: '#259fbd', emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.3 }), animation: { ...createNode('polyhedron').animation, kind: 'float', amplitude: 0.12, duration: 3 },
      interaction: { trigger: 'click', key: '', radius: 3.5, action: 'collect', targetId: null, message: 'Núcleo recuperado. Siga a bússola até o farol.', item: 'Núcleo do farol' } })
  } else {
    nodes.push(...asset('lighthouse', 'torre', [0, 0, -6], { name: 'Farol das Garças' }))
    nodes.push({ ...createNode('group'), id: 'sinal', name: 'Sinal aceso', visible: false }, { ...createNode('sphere'), id: 'luz', parentId: 'sinal', name: 'Chama do resgate', position: [0, 11.4, -6], dimensions: [0.9, 0.9, 0.9], collidable: false,
      material: validateMaterial({ color: '#ffdf8b', emissive: '#ffc35c', emissiveIntensity: 3, metalness: 0, roughness: 0.6 }), animation: { ...createNode('sphere').animation, kind: 'pulse', amplitude: 0.12, duration: 2 } })
    nodes.push({ ...createNode('group'), id: 'facho', parentId: 'sinal', name: 'Facho giratório', position: [0, 11.4, -6], animation: { ...createNode('group').animation, kind: 'spin', axis: 'y', duration: 8 } })
    for (const [i, side] of [-1, 1].entries()) nodes.push({ ...createNode('cone'), id: `feixe${i}`, parentId: 'facho', name: 'Feixe do resgate', position: [0, 0, side * 2.2], rotation: [side * -90, 0, 0], dimensions: [1.6, 4, 1.6], collidable: false,
      material: validateMaterial({ color: '#fff6d0', emissive: '#ffe9a8', emissiveIntensity: 1.5, opacity: 0.16, doubleSided: true, metalness: 0, roughness: 1 }) })
    nodes.push({ ...createNode('box'), id: 'acionador', name: 'Acender o sinal de resgate', position: [0, 0.9, 4], dimensions: [0.7, 1.8, 0.7], material: validateMaterial({ color: '#947542', metalness: 0.5, roughness: 0.6 }),
      interaction: { trigger: 'click', key: '', radius: 3.5, action: 'toggleVisibility', targetId: 'sinal', message: 'O sinal de Aurora voltou a brilhar. Os barcos estão a salvo!', requires: 'Sinal de resgate' } })
  }
  return validateScene({ ...createEmptyScene(), name: kind === 'camp' ? 'Posto do Lírio' : kind === 'ruins' ? 'Ruínas do Guardião' : 'Farol das Garças', nodes })
}

export function auroraGameplay(): SceneGameplay {
  return { naturalResources: true, startingItems: [], recipes: [
    { id: 'sinal', name: 'Sinal de resgate', inputs: [{ item: 'Madeira', amount: 6 }, { item: 'Pedra', amount: 3 }, { item: 'Fibra', amount: 2 }], output: { item: 'Sinal de resgate', amount: 1 }, healing: 0 },
    { id: 'bandagem', name: 'Bandagem', inputs: [{ item: 'Fibra', amount: 2 }], output: { item: 'Bandagem', amount: 1 }, healing: 30 },
    { id: 'caldo', name: 'Caldo de cogumelos', inputs: [{ item: 'Cogumelo', amount: 1 }, { item: 'Madeira', amount: 1 }], output: { item: 'Caldo', amount: 1 }, healing: 20 },
  ], quests: [
    { id: 'ajudar', title: 'Uma luz para Aurora', giverId: 'lirio/mara', steps: [{ kind: 'gather', target: 'Madeira', count: 6, label: 'Extraia madeira de duas árvores' }, { kind: 'gather', target: 'Pedra', count: 3, label: 'Quebre uma rocha para obter pedra' }], rewards: [{ item: 'Bandagem', amount: 1 }] },
    { id: 'fabricar', title: 'Preparar o resgate', giverId: 'lirio/mara', steps: [{ kind: 'gather', target: 'Fibra', count: 2, label: 'Recolha fibra de um arbusto' }, { kind: 'craft', target: 'Sinal de resgate', count: 1, label: 'Abra B e fabrique o sinal de resgate' }], rewards: [] },
    { id: 'ruinas', title: 'O núcleo perdido', giverId: null, steps: [{ kind: 'defeat', target: 'ruinas/lobo1', count: 1, label: 'Derrote o lobo das ruínas' }, { kind: 'defeat', target: 'ruinas/lobo2', count: 1, label: 'Derrote o lobo do santuário' }, { kind: 'gather', target: 'Núcleo do farol', count: 1, label: 'Recupere o núcleo no altar' }], rewards: [] },
    { id: 'farol', title: 'Acender o farol', giverId: null, steps: [{ kind: 'visit', target: 'posto/acionador', count: 1, label: 'Siga até o Farol das Garças' }, { kind: 'interact', target: 'posto/acionador', count: 1, label: 'Use E no acionador para acender o sinal' }], rewards: [] },
  ] }
}
