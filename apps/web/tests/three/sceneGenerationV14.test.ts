import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEmptyScene, createNode, parseScene, type SceneNode, type ThreeSceneDocument } from '../../src/three/sceneDocument.ts'
import { applySceneEdit, expandSceneRecipe, generateThreeScene, sceneEditSchema, sceneRecipeSchema } from '../../src/three/sceneGeneration.ts'
import { SanitizeLog } from '../../src/three/sceneRecipeSanitize.ts'
import type { LLMProvider } from '../../../../packages/agent/src/provider.ts'

type Schema = { type?: unknown; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: unknown; items?: Schema; anyOf?: Schema[]; maxLength?: number }
const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', columns: 1, jitter: 0, seed: 1, onto: null }
const prefab = (type: string, extra: Record<string, unknown> = {}) => ({ type, size: 1, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: true, building: null, character: null, ...extra })
const character = (extra: Record<string, unknown> = {}) => ({ age: 'adult', build: 'average', height: 1, style: 'stylized', skin: null, hair: null, hairStyle: 'auto', beard: 'auto', ...extra })
const npc = (routine: unknown, extra: Record<string, unknown> = {}) => ({ type: 'npc', speed: 1, range: 6, damage: 0, routine, reaction: 'greet', ...extra })
function template(id: string, position: number[], extra: Record<string, unknown> = {}) {
  const node = createNode(extra.kind === 'box' ? 'box' : 'group')
  return { ...node, id, name: id, position, color: '#cccccc', metalness: 0, roughness: 0.6, repeat: single, ...extra }
}
const recipe = (nodes: Record<string, unknown>[], environment: Record<string, unknown> = {}) => ({ name: 'Vila 1.4', background: '#ccd6e0', exposure: 1, lightIntensity: 1.4, duration: 20, environment, nodes })
const unwrap = (schema: Schema): Schema => schema.anyOf?.find((option) => option.type !== 'null') ?? schema
const field = (schema: Schema, ...path: string[]) => path.reduce((current, key) => { const next = unwrap(current); return unwrap(next.items && key === '[]' ? next.items : next.properties![key]) }, schema)

/** Every object of the schema; `partial` objects (geometry, surface, edit patches) are reported apart. */
function objects(schema: Schema, path = '$', out: { path: string; schema: Schema }[] = []) {
  if (schema.properties) out.push({ path, schema })
  for (const [key, child] of Object.entries(schema.properties ?? {})) objects(child, `${path}.${key}`, out)
  if (schema.items) objects(schema.items, `${path}[]`, out)
  for (const option of schema.anyOf ?? []) objects(option, path, out)
  return out
}

test('the recipe schema is strict: every object closes its properties and requires all of them, new 1.4 fields included', () => {
  const all = objects(sceneRecipeSchema as Schema)
  assert.ok(all.every(({ schema }) => schema.additionalProperties === false), 'additionalProperties: false everywhere')
  const open = all.filter(({ schema }) => JSON.stringify([...schema.required ?? []].sort()) !== JSON.stringify(Object.keys(schema.properties!).sort())).map(({ path }) => path)
  assert.deepEqual([...new Set(open)], ['$.nodes[].geometry', '$.nodes[].surface'], 'only the legacy free-form geometry/surface patches are partial')
  const node = field(sceneRecipeSchema as Schema, 'nodes', '[]')
  for (const key of ['emitter', 'behavior', 'prefab']) assert.ok(node.required!.includes(key), key)
  assert.deepEqual(field(node, 'prefab', 'character').required, ['age', 'build', 'height', 'style', 'skin', 'hair', 'hairStyle', 'beard'])
  assert.ok(field(node, 'behavior').required!.includes('routine') && field(node, 'behavior').required!.includes('reaction'))
  assert.deepEqual(field(node, 'behavior', 'routine', '[]').required, ['activity', 'target', 'from', 'to'])
  assert.deepEqual(field(node, 'emitter').required, ['preset', 'rate', 'spread'])
  const environment = field(sceneRecipeSchema as Schema, 'environment')
  for (const key of ['motion', 'dayCycle', 'premise']) assert.ok(environment.required!.includes(key), key)
  assert.deepEqual(field(environment, 'motion').required, ['wind', 'grass', 'fauna'])
  assert.deepEqual(field(environment, 'dayCycle').required, ['enabled', 'duration', 'start'])
  assert.equal(field(environment, 'premise').maxLength, 240)
  const changes = field(sceneEditSchema as Schema, 'updates', '[]', 'changes')
  assert.ok(changes.properties!.emitter && field(changes, 'behavior').properties!.routine && field(changes, 'behavior').properties!.reaction)
  assert.ok(field(sceneEditSchema as Schema, 'rebuilds', '[]', 'prefab').properties!.character)
  for (const key of ['motion', 'dayCycle', 'premise']) assert.ok(field(sceneEditSchema as Schema, 'environment').properties![key], key)
  assert.ok(objects(sceneEditSchema as Schema).every(({ schema }) => schema.additionalProperties === false))
  assert.ok(JSON.stringify(sceneRecipeSchema).length < 20000, `recipe schema stays compact (${JSON.stringify(sceneRecipeSchema).length} chars)`)
})

function village() {
  return recipe([
    template('stall', [0, 0, 0], { prefab: prefab('marketStall'), repeat: { ...single, count: 3, offset: [6, 0, 0] } }),
    template('seller', [0, 0, 3], { prefab: prefab('villager', { seed: 4, character: character({ age: 'elder', build: 'heavy', height: 0.92, hair: '#d9d6d0', hairStyle: 'bun', beard: 'none' }) }),
      behavior: npc([{ activity: 'work', target: 'stall', from: 7, to: 18 }, { activity: 'chat', target: 'well', from: 18, to: 21 }, { activity: 'sleep', target: null, from: 21, to: 7 }]),
      repeat: { ...single, count: 3, offset: [6, 0, 0] } }),
    template('well', [0, 0, 14], { prefab: prefab('well') }),
    template('row', [-20, 0, 0], { repeat: { ...single, count: 2, offset: [0, 0, 8] } }),
    template('bench', [0, 0, 0], { parentId: 'row', prefab: prefab('bench', { seed: 3 }) }),
    template('reader', [2, 0, 0], { parentId: 'row', prefab: prefab('villager', { seed: 9, character: character({ age: 'young', build: 'slim', skin: '#9a6440', hairStyle: 'braids' }) }),
      behavior: npc([{ activity: 'sit', target: 'bench', from: 8, to: 20 }], { reaction: 'flee' }) }),
    template('guard', [10, 0, 14], { prefab: prefab('knight', { seed: 2, character: character({ build: 'athletic', height: 1.08, beard: 'short' }) }),
      behavior: npc([{ activity: 'patrol', target: 'well', from: 6, to: 22 }, { activity: 'guard', target: null, from: 22, to: 6 }], { reaction: 'alert' }) }),
    template('chimney', [-10, 4, 14], { kind: 'box', dimensions: [0.6, 1.5, 0.6], emitter: { preset: 'smoke', rate: 1.2, spread: 0.4 } }),
    template('forge', [14, 0.5, 6], { kind: 'box', emitter: { preset: 'sparks', rate: 2, spread: 0.3 } }),
  ], { sky: 'day', motion: { wind: 0.9, grass: 'dense', fauna: 'rich' }, dayCycle: { enabled: true, duration: 600, start: 7 }, premise: 'A feira de Valemar abre ao nascer do sol; alguém roubou a chave do baú.' })
}

test('strict expansion keeps archetypes, emitters and 1.4 environment, and resolves routine places inside repetitions', () => {
  const doc = expandSceneRecipe(village())
  assert.equal(doc.version, '1.4')
  assert.equal(JSON.stringify(parseScene(JSON.stringify(doc))), JSON.stringify(doc), 'the expanded document round-trips through the 1.4 validator')
  const byId = new Map(doc.nodes.map((node) => [node.id, node]))
  assert.equal(byId.get('seller')!.asset!.character!.age, 'elder')
  assert.equal(byId.get('seller')!.asset!.character!.hairStyle, 'bun')
  assert.equal(byId.get('guard')!.asset!.character!.height, 1.08)
  assert.deepEqual(['seller', 'seller~2', 'seller~3'].map((id) => byId.get(id)!.behavior!.routine![0].target), ['stall', 'stall~2', 'stall~3'], 'each seller works at the stall of the same copy')
  assert.equal(byId.get('seller~3')!.behavior!.routine![1].target, 'well', 'a single landmark is shared by every copy')
  assert.equal(byId.get('seller')!.behavior!.reaction, 'greet')
  const readers = doc.nodes.filter((node) => node.asset?.type === 'villager' && node.id.startsWith('reader'))
  assert.deepEqual(readers.map((node) => [node.id, node.behavior!.routine![0].target]), [['reader', 'bench'], ['reader@2', 'bench@2']], 'nested repetitions keep the bench of their own row')
  for (const reader of readers) assert.equal(byId.get(reader.behavior!.routine![0].target!)!.asset!.type, 'bench')
  assert.equal(byId.get('guard')!.behavior!.reaction, 'alert')
  assert.deepEqual(byId.get('chimney')!.emitter, { preset: 'smoke', rate: 1.2, spread: 0.4 })
  assert.equal(byId.get('forge')!.emitter!.preset, 'sparks')
  assert.deepEqual(doc.environment.motion, { wind: 0.9, grass: 'dense', fauna: 'rich' })
  assert.deepEqual(doc.environment.dayCycle, { enabled: true, duration: 600, start: 7 })
  assert.match(doc.environment.premise!, /Valemar/)
})

test('strict expansion rejects invalid 1.4 data instead of guessing', () => {
  const base = village()
  const patched = (id: string, patch: Record<string, unknown>) => ({ ...base, nodes: base.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) })
  assert.throws(() => expandSceneRecipe(patched('chimney', { behavior: { type: 'enemy', speed: 1, range: 5, damage: 5, routine: [{ activity: 'work', target: null, from: 0, to: 24 }] } })), /NPCs/)
  assert.throws(() => expandSceneRecipe(patched('guard', { behavior: npc([{ activity: 'dance', target: null, from: 0, to: 24 }]) })), /Atividade/)
  assert.throws(() => expandSceneRecipe(patched('guard', { behavior: npc([{ activity: 'guard', target: null, from: 0, to: 30 }]) })), /período/)
  assert.throws(() => expandSceneRecipe(patched('guard', { behavior: npc([{ activity: 'guard', target: 'castle', from: 0, to: 24 }]) })), /local inexistente/)
  assert.throws(() => expandSceneRecipe(patched('forge', { emitter: { preset: 'lava', rate: 1, spread: 1 } })), /Partícula/)
  assert.throws(() => expandSceneRecipe(patched('well', { prefab: prefab('well', { character: character() }) })), /arquétipo/)
  assert.throws(() => expandSceneRecipe(patched('guard', { prefab: prefab('knight', { character: character({ height: 1.6 }) }) })), /altura/)
  assert.throws(() => expandSceneRecipe({ ...base, environment: { motion: { wind: 3, grass: 'auto', fauna: 'auto' } } }), /Vento/)
  assert.throws(() => expandSceneRecipe({ ...base, environment: { dayCycle: { enabled: true, duration: 10, start: 6 } } }), /Duração do dia/)
})

test('lenient expansion repairs AI output for every 1.4 field and records each fix', () => {
  const base = village(), log = new SanitizeLog()
  const nodes = base.nodes.map((node) => {
    if (node.id === 'guard') return { ...node, prefab: prefab('knight', { character: character({ height: 1.6, age: 'ancient', skin: 'pálida' }) }),
      behavior: npc([{ activity: 'dance', target: 'castle', from: -3, to: 30 }, { activity: 'patrol', target: 'well', from: 6, to: 22 }, ...Array.from({ length: 6 }, () => ({ activity: 'wander', target: null, from: 0, to: 24 }))], { reaction: 'panic' }) }
    if (node.id === 'chimney') return { ...node, emitter: { preset: 'lava', rate: 1, spread: 1 }, behavior: { type: 'hazard', speed: 0, range: 2, damage: 5, routine: [{ activity: 'work', target: null, from: 0, to: 24 }], reaction: 'greet' } }
    if (node.id === 'forge') return { ...node, emitter: { preset: 'sparks', rate: 9, spread: -1 } }
    if (node.id === 'well') return { ...node, prefab: prefab('well', { character: character() }) }
    if (node.id === 'reader') return { ...node, behavior: npc([{ activity: 'sit', target: 'reader', from: 8, to: 20 }]) }
    return node
  })
  const doc = expandSceneRecipe({ ...base, nodes, environment: { motion: { wind: 5, grass: 'tall', fauna: 'rich' }, dayCycle: { enabled: true, duration: 20, start: 30 }, premise: `  ${'Uma história longa. '.repeat(20)}` } },
    () => {}, [], { lenient: true, log })
  const byId = new Map(doc.nodes.map((node) => [node.id, node])), summary = [...log.counts.keys(), ...log.notes].join(' ')
  const guard = byId.get('guard')!
  assert.equal(guard.behavior!.routine!.length, 6, 'routines keep at most six periods')
  assert.deepEqual(guard.behavior!.routine![0], { activity: 'wander', target: null, from: 0, to: 24 }, 'unknown activity → wander, missing place dropped, hours clamped')
  assert.equal(guard.behavior!.routine![1].target, 'well')
  assert.equal(guard.behavior!.reaction, 'greet')
  assert.equal(guard.asset!.character!.height, 1.15)
  assert.equal(guard.asset!.character!.age, 'adult')
  assert.equal(guard.asset!.character!.skin, null)
  assert.equal(byId.get('chimney')!.emitter, undefined, 'unknown emitter preset removed')
  assert.equal(byId.get('chimney')!.behavior!.routine, undefined, 'routine on a non-NPC removed')
  assert.equal(byId.get('chimney')!.behavior!.reaction, undefined)
  assert.deepEqual(byId.get('forge')!.emitter, { preset: 'sparks', rate: 4, spread: 0 })
  assert.equal(byId.get('well')!.asset!.character, undefined, 'archetypes belong to characters only')
  assert.deepEqual(['reader', 'reader@2'].map((id) => byId.get(id)!.behavior!.routine![0].target), [null, null], 'an NPC cannot use itself as a place')
  assert.deepEqual(doc.environment.motion, { wind: 2, grass: 'auto', fauna: 'rich' })
  assert.deepEqual(doc.environment.dayCycle, { enabled: true, duration: 60, start: 24 })
  assert.ok(doc.environment.premise!.length <= 240 && doc.environment.premise!.length > 230)
  assert.equal(doc.environment.premise, doc.environment.premise!.trim())
  for (const expected of ['Atividade de rotina', 'Horário de rotina', 'Períodos de rotina além de 6', 'Reação de NPC', 'Locais de rotina inexistentes', 'Taxa de partículas', 'Raio das partículas',
    'Pré-fabricado: altura do personagem', 'Pré-fabricado: idade do personagem', 'Pré-fabricado: tom de pele', 'Pré-fabricado: arquétipo de personagem', 'Vento', 'Grama', 'Duração do dia', 'Hora inicial', 'Reação fora de NPC', 'Premissa'])
    assert.ok(summary.includes(expected), expected)
  assert.match(summary, /emissor de partículas desconhecido/)
  assert.match(summary, /Rotinas só valem para NPCs/)
})

function town(): ThreeSceneDocument {
  return expandSceneRecipe(village())
}

test('edits can add emitters and routines, rebuild archetypes and forget removed places', () => {
  const doc = town(), log = new SanitizeLog()
  const edited = applySceneEdit(doc, { updates: [
    { id: 'well', changes: { emitter: { preset: 'fountain', rate: 1, spread: 0.5 } } },
    { id: 'guard', changes: { behavior: { routine: [{ activity: 'guard', target: 'stall~2', from: 0, to: 24 }], reaction: 'ignore' } } },
    { id: 'forge', changes: { emitter: null } },
  ], additions: [], removals: [], rebuilds: [{ id: 'seller', prefab: prefab('villager', { seed: 5, character: character({ age: 'child' }) }) }],
  environment: { motion: { wind: 1.8, grass: 'none', fauna: 'none' }, dayCycle: null, premise: 'Uma tempestade se aproxima de Valemar.' } })
  const byId = new Map(edited.nodes.map((node) => [node.id, node]))
  assert.equal(byId.get('well')!.emitter!.preset, 'fountain')
  assert.equal(byId.get('forge')!.emitter, undefined)
  assert.deepEqual(byId.get('guard')!.behavior!.routine, [{ activity: 'guard', target: 'stall~2', from: 0, to: 24 }])
  assert.equal(byId.get('guard')!.behavior!.reaction, 'ignore')
  assert.equal(byId.get('seller')!.asset!.character!.age, 'child')
  assert.equal(byId.get('seller')!.behavior!.routine![0].target, 'stall', 'a rebuilt NPC keeps its routine')
  assert.deepEqual(edited.environment.motion, { wind: 1.8, grass: 'none', fauna: 'none' })
  assert.equal(edited.environment.dayCycle, undefined)
  assert.equal(edited.environment.premise, 'Uma tempestade se aproxima de Valemar.')

  const removed = applySceneEdit(doc, { updates: [], additions: [], removals: ['well'] })
  assert.equal(removed.nodes.find((node) => node.id === 'guard')!.behavior!.routine![0].target, null, 'removing a place clears it from routines')
  assert.equal(removed.nodes.find((node) => node.id === 'seller')!.behavior!.routine![0].target, 'stall')

  assert.throws(() => applySceneEdit(doc, { updates: [{ id: 'guard', changes: { behavior: { routine: [{ activity: 'guard', target: 'castle', from: 0, to: 24 }] } } }], additions: [] }), /local inexistente/)
  const lenient = applySceneEdit(doc, { updates: [{ id: 'guard', changes: { behavior: { routine: [{ activity: 'nap', target: 'castle', from: 0, to: 26 }] }, emitter: { preset: 'plasma', rate: 1, spread: 1 } } },
    { id: 'chimney', changes: { behavior: { type: 'hazard', speed: 0, range: 1, damage: 1, routine: [{ activity: 'work', target: null, from: 0, to: 24 }] } } }], additions: [] }, log)
  const guard = lenient.nodes.find((node) => node.id === 'guard')!
  assert.deepEqual(guard.behavior!.routine, [{ activity: 'wander', target: null, from: 0, to: 24 }])
  assert.equal(guard.emitter, undefined)
  assert.equal(lenient.nodes.find((node) => node.id === 'chimney')!.behavior!.routine, undefined)
  assert.match(log.summary().join(' '), /Locais de rotina inexistentes/)
})

test('a generation turns AI data into a 1.4 scene and the request can switch on the day cycle and strong wind', async () => {
  const provider = { generateStructured: async <T,>() => structuredClone(village()) as T } as unknown as LLMProvider
  const scene = await generateThreeScene(provider, 'Crie uma vila medieval com feira, aldeões e ciclo de dia e noite durante uma ventania', new AbortController().signal)
  assert.equal(scene.version, '1.4')
  assert.equal(scene.environment.dayCycle?.enabled, true)
  assert.ok(scene.environment.motion!.wind >= 1.5)
  assert.ok(scene.nodes.some((node: SceneNode) => node.behavior?.routine?.some((step) => step.target?.startsWith('stall'))))
  assert.ok(scene.nodes.some((node) => node.asset?.character?.age === 'elder'))
  assert.ok(scene.nodes.some((node) => node.emitter?.preset === 'sparks'))
  assert.match(scene.environment.premise ?? '', /Valemar/)
  assert.equal(createEmptyScene().version, '1.4')
})
