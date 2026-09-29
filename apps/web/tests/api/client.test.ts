import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyCadEdit, cadEditPlan, createCadProject, createProject, deleteProject, inspectCadPlate, recentCadProjects,
  resumeCadProject, resumeProject,
} from '../../src/api/client.ts'
import type { CadPartSpec } from '../../../../packages/domain/ts/src/cad-part.ts'
import { initialCadBracket, initialCadComposite, initialCadFlange, initialCadRoundedPlate } from '../../src/workspace/cadPlateDraft.ts'

test('a live project is resumed after a page reload and cleared on reset', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  const calls: string[] = []
  const spec = {
    schemaVersion: '1.0', projectId: 'prj_test', revision: 1, units: 'mm',
    scene: { title: 'Table', displayScale: 0.001 }, objects: [],
  }
  globalThis.fetch = async (input, options) => {
    const url = String(input)
    calls.push(`${options?.method ?? 'GET'} ${url}`)
    if (options?.method === 'POST') return new Response(JSON.stringify(spec), { status: 201 })
    if (options?.method === 'DELETE') return new Response(null, { status: 204 })
    return new Response(JSON.stringify({
      projectId: spec.projectId, revision: spec.revision, modelSpec: spec,
      validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
      preview: { url: '/api/projects/prj_test/artifacts/html?revision=1' }, artifacts: [], timings: {},
    }), { status: 200 })
  }

  try {
    await createProject()
    const resumed = await resumeProject()
    assert.equal(resumed?.modelSpec.projectId, 'prj_test')
    assert.equal(resumed?.preview?.url.endsWith('revision=1'), true)
    await deleteProject('prj_test')
    assert.equal(await resumeProject(), null)
    assert.equal(calls.length, 3)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('CAD inspection sends a versioned millimeter feature model', async () => {
  const originalFetch = globalThis.fetch
  let received = ''
  globalThis.fetch = async (input, options) => {
    assert.match(String(input), /\/api\/cad\/parts\/inspect$/)
    received = String(options?.body)
    return new Response(JSON.stringify({
      partId: 'plate_1', solidCount: 1, volumeMm3: 100, boundsMm: [10, 10, 2], stepBytes: 2048,
    }), { status: 200 })
  }

  try {
    const result = await inspectCadPlate({
      partId: 'plate_1', width: 10, depth: 10, thickness: 2,
      holeX: 0, holeY: 0, holeDiameter: 2,
    })
    assert.equal(result.solidCount, 1)
    const body = JSON.parse(received) as Record<string, unknown>
    assert.equal(body.schemaVersion, '2.0')
    assert.equal(body.units, 'mm')
    assert.deepEqual(body.features, [{ kind: 'through_hole', x: 0, y: 0, diameter: 2 }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CAD project creation, typed edit and reload use the saved revision', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } })
  let current: Record<string, unknown> | null = null
  let editBody = ''
  globalThis.fetch = async (input, options) => {
    const url = String(input)
    if (url.endsWith('/api/cad/projects') && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)) as { spec: Record<string, unknown> }
      current = { projectId: 'cad_test', revision: 0, spec: body.spec,
        inspection: { partId: 'plate_1', solidCount: 1, volumeMm3: 100, boundsMm: [100, 80, 10], stepBytes: 2048 } }
      return new Response(JSON.stringify(current), { status: 201 })
    }
    if (url.endsWith('/cad_test/plans')) {
      editBody = String(options?.body)
      const plan = JSON.parse(editBody) as { plan: { operations: { parameter: string; value: number }[] } }
      const old = current as { spec: { base: Record<string, unknown> } }
      current = { ...old, revision: 1, spec: { ...old.spec, base: {
        ...old.spec.base, width: plan.plan.operations[0].value,
      } } }
      return new Response(JSON.stringify(current), { status: 200 })
    }
    assert.match(url, /\/api\/cad\/projects\/cad_test$/)
    return new Response(JSON.stringify(current), { status: 200 })
  }

  try {
    const input = { partId: 'plate_1', width: 100, depth: 80, thickness: 10,
      holeX: 10, holeY: 5, holeDiameter: 12 }
    const created = await createCadProject(input)
    assert.equal(values.get('ai-web3d:cad-project'), 'cad_test')
    assert.deepEqual(recentCadProjects(), [{ projectId: 'cad_test', partId: 'plate_1' }])
    const edited = await applyCadEdit(created, { ...input, width: 120 })
    const sent = JSON.parse(editBody) as { expectedRevision: number; plan: { operations: unknown[] } }
    assert.equal(sent.expectedRevision, 0)
    assert.deepEqual(sent.plan.operations, [{ op: 'set_parameter', parameter: 'width', value: 120 }])
    assert.equal(edited.revision, 1)
    assert.equal((await resumeCadProject())?.spec.base.width, 120)
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('an L bracket sends both hole directions and saves manual changes as a validated spec revision', async () => {
  const originalFetch = globalThis.fetch
  let createdBody = ''
  let replacementBody = ''
  globalThis.fetch = async (input, options) => {
    const url = String(input)
    if (url.endsWith('/api/cad/projects')) {
      createdBody = String(options?.body)
      const spec = (JSON.parse(createdBody) as { spec: CadPartSpec }).spec
      return new Response(JSON.stringify({ projectId: 'cad_bracket', revision: 0, spec,
        inspection: { partId: 'mounting_bracket', solidCount: 1, volumeMm3: 100, boundsMm: [120, 80, 70], stepBytes: 2048 } }), { status: 201 })
    }
    assert.match(url, /\/api\/cad\/projects\/cad_bracket\/spec$/)
    replacementBody = String(options?.body)
    const spec = (JSON.parse(replacementBody) as { spec: CadPartSpec }).spec
    return new Response(JSON.stringify({ projectId: 'cad_bracket', revision: 1, spec,
      inspection: { partId: 'mounting_bracket', solidCount: 1, volumeMm3: 100, boundsMm: [120, 80, 90], stepBytes: 2100 } }), { status: 200 })
  }
  try {
    const created = await createCadProject(initialCadBracket)
    const createdSpec = (JSON.parse(createdBody) as { spec: CadPartSpec }).spec
    assert.equal(createdSpec.schemaVersion, '2.2')
    assert.equal(createdSpec.upright?.holes.length, 2)
    const edited = await applyCadEdit(created, { ...initialCadBracket, upright: { ...initialCadBracket.upright!, height: 90 } })
    const replacement = JSON.parse(replacementBody) as { expectedRevision: number; spec: CadPartSpec }
    assert.equal(replacement.expectedRevision, 0)
    assert.equal(replacement.spec.upright?.height, 90)
    assert.equal(edited.revision, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('curved CAD presets send version 2.3 and keep radius or diameter edits', async () => {
  const originalFetch = globalThis.fetch
  let lastBody = ''
  globalThis.fetch = async (input, options) => {
    lastBody = String(options?.body)
    const spec = (JSON.parse(lastBody) as { spec: CadPartSpec }).spec
    return new Response(JSON.stringify({ projectId: 'cad_curved', revision: String(input).endsWith('/spec') ? 1 : 0,
      spec, inspection: { partId: spec.partId, solidCount: 1, volumeMm3: 100, boundsMm: [100, 100, 12], stepBytes: 2048 } }),
    { status: String(input).endsWith('/spec') ? 200 : 201 })
  }
  try {
    for (const input of [initialCadFlange, initialCadRoundedPlate]) {
      const created = await createCadProject(input)
      assert.equal(created.spec.schemaVersion, '2.3')
      assert.equal(created.spec.base.kind, input.baseKind)
      const edited = await applyCadEdit(created, input.baseKind === 'extruded_disc'
        ? { ...input, width: 120, depth: 120 } : { ...input, cornerRadius: 16 })
      assert.equal(edited.revision, 1)
      const sent = JSON.parse(lastBody) as { spec: CadPartSpec }
      assert.equal(sent.spec.base.width, input.baseKind === 'extruded_disc' ? 120 : 120)
      assert.equal(sent.spec.cornerRadius, input.baseKind === 'extruded_disc' ? 0 : 16)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('composite CAD preset sends fused bosses and saves manual feature edits', async () => {
  const originalFetch = globalThis.fetch
  let lastBody = ''
  globalThis.fetch = async (input, options) => {
    lastBody = String(options?.body)
    const spec = (JSON.parse(lastBody) as { spec: CadPartSpec }).spec
    return new Response(JSON.stringify({ projectId: 'cad_composite', revision: String(input).endsWith('/spec') ? 1 : 0,
      spec, inspection: { partId: spec.partId, solidCount: 1, volumeMm3: 100, boundsMm: [120, 80, 30], stepBytes: 4000 } }),
    { status: String(input).endsWith('/spec') ? 200 : 201 })
  }
  try {
    const created = await createCadProject(initialCadComposite)
    assert.equal(created.spec.schemaVersion, '2.4')
    assert.equal(created.spec.bosses?.length, 1)
    assert.equal(created.spec.features.length, 5)
    const edited = await applyCadEdit(created, { ...initialCadComposite, bosses: [
      { ...initialCadComposite.bosses![0], height: 25 },
    ] })
    assert.equal(edited.revision, 1)
    assert.equal((JSON.parse(lastBody) as { spec: CadPartSpec }).spec.bosses?.[0].height, 25)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a stale API route does not erase the saved CAD project ID', async () => {
  const originalFetch = globalThis.fetch
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map([['ai-web3d:cad-project', 'cad_saved']])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } })
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })

  try {
    await assert.rejects(resumeCadProject(), /Restart the API/)
    assert.equal(values.get('ai-web3d:cad-project'), 'cad_saved')
  } finally {
    globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('mounting plate edits preserve hole identities and upgrade old projects', () => {
  const previous: CadPartSpec = {
    schemaVersion: '2.0', units: 'mm', partId: 'plate_1',
    base: { kind: 'extruded_rectangle', width: 120, depth: 80, thickness: 10 },
    features: [{ kind: 'through_hole', x: -40, y: -25, diameter: 8 }],
  }
  const plan = cadEditPlan(previous, {
    partId: 'plate_1', width: 120, depth: 80, thickness: 10,
    holeX: -40, holeY: -25, holeDiameter: 8, cornerChamfer: 4,
    additionalHoles: [{ id: 'hole_2', x: 40, y: 25, diameter: 8 }],
  })
  assert.deepEqual(plan, { schemaVersion: '2.0', operations: [
    { op: 'set_corner_chamfer', value: 4 },
    { op: 'upsert_hole', holeId: 'hole_2', x: 40, y: 25, diameter: 8 },
  ] })
})
