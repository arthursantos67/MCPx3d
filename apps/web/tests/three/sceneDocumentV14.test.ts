import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, DEFAULT_MOTION, parseScene, validateScene, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { prefabSpec } from '../../src/three/scenePrefabs.ts'
import { defaultCharacterSpec } from '../../src/three/sceneCharacterArchetype.ts'

function village(): ThreeSceneDocument {
  const stall = { ...createNode('group'), id: 'stall', name: 'Barraca' }, bench = { ...createNode('box'), id: 'bench', name: 'Banco' }
  const npc = { ...createNode('group'), id: 'npc', name: 'Mercadora', behavior: { type: 'npc', speed: 1, range: 6, damage: 0, reaction: 'alert',
    routine: [{ activity: 'work', target: 'stall', from: 8, to: 18 }, { activity: 'sit', target: 'bench', from: 18, to: 22 }, { activity: 'sleep', target: null, from: 22, to: 8 }] } }
  const fire = { ...createNode('sphere'), id: 'fire', name: 'Braseiro', emitter: { preset: 'fire', rate: 1.5, spread: 0.4 } }
  const doc = createEmptyScene()
  return validateScene({ ...doc, nodes: [stall, bench, npc, fire], environment: { ...doc.environment, motion: { wind: 1.4, grass: 'dense', fauna: 'rich' },
    dayCycle: { enabled: true, duration: 900, start: 6.5 }, premise: 'A feira abre ao amanhecer e fecha quando os lampiões acendem.' } })
}

test('version 1.4 round trips routines, reactions, emitters, motion, day cycle and premise', () => {
  const doc = village()
  assert.equal(doc.version, '1.4')
  assert.deepEqual(parseScene(JSON.stringify(doc)), doc)
  const npc = doc.nodes.find((node) => node.id === 'npc')!
  assert.equal(npc.behavior!.routine!.length, 3)
  assert.equal(npc.behavior!.reaction, 'alert')
  assert.deepEqual(doc.nodes.find((node) => node.id === 'fire')!.emitter, { preset: 'fire', rate: 1.5, spread: 0.4 })
  assert.deepEqual(doc.environment.motion, { wind: 1.4, grass: 'dense', fauna: 'rich' })
  assert.deepEqual(doc.environment.dayCycle, { enabled: true, duration: 900, start: 6.5 })
})

test('1.3 projects open as 1.4 without gaining fields', () => {
  const legacy = { ...createEmptyScene(), version: '1.3', nodes: [{ ...createNode('box'), id: 'a', behavior: { type: 'npc', speed: 1, range: 6, damage: 0 } }] }
  const doc = validateScene(legacy)
  assert.equal(doc.version, '1.4')
  for (const key of ['motion', 'dayCycle', 'premise'] as const) assert.equal(key in doc.environment, false)
  assert.equal('routine' in doc.nodes[0].behavior!, false)
  assert.equal('emitter' in doc.nodes[0], false)
  assert.deepEqual(DEFAULT_MOTION, { wind: 0.6, grass: 'auto', fauna: 'auto' })
  for (const version of ['1.0', '1.1', '1.2']) assert.equal(validateScene({ ...legacy, version }).version, '1.4')
})

test('invalid 1.4 data is rejected', () => {
  const doc = village(), npc = doc.nodes.find((node) => node.id === 'npc')!
  const withRoutine = (routine: unknown, type = 'npc') => validateScene({ ...doc, nodes: doc.nodes.map((node) => node === npc ? { ...node, behavior: { ...node.behavior, type, routine } } : node) })
  assert.throws(() => withRoutine([{ activity: 'work', target: 'missing', from: 8, to: 18 }]), /local inexistente/)
  assert.throws(() => withRoutine([{ activity: 'work', target: 'npc', from: 8, to: 18 }]), /local inexistente/)
  assert.throws(() => withRoutine([{ activity: 'dance', target: null, from: 8, to: 18 }]), /Atividade/)
  assert.throws(() => withRoutine([{ activity: 'work', target: null, from: 8, to: 25 }]), /Fim do período/)
  assert.throws(() => withRoutine(Array.from({ length: 7 }, () => ({ activity: 'wander', target: null, from: 0, to: 24 }))), /até 6/)
  assert.throws(() => withRoutine([{ activity: 'guard', target: null, from: 0, to: 24 }], 'enemy'), /pertencem a NPCs/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...createNode('box'), emitter: { preset: 'lava', rate: 1, spread: 0 } }] }), /Partícula/)
  assert.throws(() => validateScene({ ...doc, nodes: [{ ...createNode('box'), emitter: { preset: 'fire', rate: 9, spread: 0 } }] }), /Taxa/)
  assert.throws(() => validateScene({ ...doc, environment: { ...doc.environment, motion: { wind: 3, grass: 'auto', fauna: 'auto' } } }), /Vento/)
  assert.throws(() => validateScene({ ...doc, environment: { ...doc.environment, dayCycle: { enabled: true, duration: 10, start: 0 } } }), /Duração do dia/)
  assert.throws(() => validateScene({ ...doc, environment: { ...doc.environment, premise: 'x'.repeat(241) } }), /Premissa/)
})

test('character archetypes are read strictly or adjusted leniently, and only for characters', () => {
  const spec = prefabSpec({ type: 'villager', size: 1, seed: 4, primary: null, secondary: null, text: '', lit: false, interactive: true,
    character: { age: 'elder', build: 'heavy', height: 0.9, style: 'realistic', skin: '#8a5a3c', hair: '#dddddd', hairStyle: 'bun', beard: 'none' } })!
  assert.deepEqual(spec.character, { age: 'elder', build: 'heavy', height: 0.9, style: 'realistic', skin: '#8a5a3c', hair: '#dddddd', hairStyle: 'bun', beard: 'none' })
  assert.equal(prefabSpec({ type: 'villager', size: 1, seed: 4 })!.character, undefined)
  assert.throws(() => prefabSpec({ type: 'villager', character: { age: 'baby' } }), /idade/)
  assert.throws(() => prefabSpec({ type: 'barrel', character: {} }), /arquétipo/)
  const notes: string[] = []
  const lenient = prefabSpec({ type: 'knight', character: { age: 'ancient', height: 3, skin: 'pink' } }, (label) => notes.push(label))!
  assert.deepEqual(lenient.character, { ...defaultCharacterSpec(), height: 1.15 })
  assert.deepEqual(notes, ['idade do personagem', 'altura do personagem', 'tom de pele'])
})
