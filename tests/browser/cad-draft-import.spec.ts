import { test, expect } from '@playwright/test'

test('a failed part recovery preserves the independently saved assembly', async ({ page, request }) => {
  const zero = { x: 0, y: 0, z: 0 }
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'independent_recovery', components:
    ['left', 'right'].map((id, i) => ({ id, position: { ...zero, x: i * 100 }, steps: [
      { id: 'body', op: 'base', shape: 'box', width: 20, depth: 20, height: 20, position: zero, rotation: zero },
    ] })) }
  const created = await request.post('http://127.0.0.1:8011/api/cad/projects', { data: { spec: draft } })
  expect(created.status()).toBe(201)
  const saved = await created.json()
  await page.addInitScript((projectId) => {
    localStorage.setItem('ai-web3d:cad-program', 'unavailable')
    localStorage.setItem('ai-web3d:cad-assembly', projectId)
    localStorage.setItem('modeler:cad-editor', 'assembly')
  }, saved.projectId)
  await page.route('**/api/cad/projects/unavailable', (route) => route.fulfill({ status: 503,
    json: { code: 'CAD_ENGINE_UNAVAILABLE', message: 'Part recovery temporarily unavailable' } }))
  await page.goto('/')
  await expect(page.getByText('independent_recovery · 2 componentes', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled()
  await expect(page.getByText('Part recovery temporarily unavailable', { exact: true })).toBeVisible()
})

test('a rotating threaded wheel receives clearance in the base without changing its motion or calling AI', async ({ page }) => {
  test.setTimeout(120_000)
  const zero = { x: 0, y: 0, z: 0 }, rotation = { ...zero, y: 90 }
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'wheel_motion_clearance', components: [
    { id: 'base', position: { ...zero, z: 6 }, steps: [
      { id: 'plate', op: 'base', shape: 'box', width: 240, depth: 100, height: 12, position: zero, rotation: zero },
      { id: 'mount', op: 'cut', shape: 'cylinder', diameter: 6, height: 14, position: { ...zero, y: 32 }, rotation: zero },
    ] },
    { id: 'screw', position: { ...zero, z: 30 }, motion: { kind: 'rotary', axis: 'x', minimum: -35, maximum: 35, value: 0, group: 'drive', factor: -120 }, steps: [
      { id: 'wheel', op: 'base', shape: 'cylinder', diameter: 44, height: 8, position: { ...zero, x: -116 }, rotation },
      { id: 'shaft', op: 'union', shape: 'cylinder', diameter: 8.5, height: 240, position: zero, rotation },
      { id: 'helix', op: 'union', shape: 'thread', diameter: 12, height: 18, pitch: 3, profile: 'trapezoidal', handedness: 'right', clearance: 0, position: zero, rotation },
      { id: 'flat', op: 'cut', shape: 'box', width: 16, depth: 26, height: 6, position: { x: -116, y: 0, z: -20 }, rotation: zero },
    ] },
  ] }
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'test' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  let calls = 0
  await page.route('**/api/ai/local/generate', async (route) => { calls++; await route.abort() })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Conjunto composto', exact: true }).click()
  await page.getByLabel('Importar rascunho CAD (JSON)').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) })
  const save = page.waitForRequest((request) => request.url().endsWith('/api/cad/projects') && request.method() === 'POST', { timeout: 90_000 })
  await page.getByRole('button', { name: 'Corrigir interferências', exact: true }).click()
  const download = page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })
  await expect(download).toBeEnabled({ timeout: 90_000 })
  const savedSpec = (await save).postDataJSON().spec
  expect(savedSpec.components[1]).toEqual(draft.components[1])
  expect(savedSpec.components[0].steps.slice(0, -1)).toEqual(draft.components[0].steps)
  expect(savedSpec.components[0].steps.at(-1).shape).toBe('cylinder')
  const pending = page.waitForEvent('download')
  await download.click()
  expect((await pending).suggestedFilename()).toContain('.step')
  await page.getByRole('slider').fill('0.67')
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  await expect(download).toBeEnabled({ timeout: 90_000 })
  expect(calls).toBe(0)
})

test('imports a CAD draft without inference and requires real validation before export', async ({ page }) => {
  const zero = { x: 0, y: 0, z: 0 }
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'imported_supports', components:
    ['left', 'right'].map((id, i) => ({ id, position: { ...zero, x: i * 100 }, steps: [
      { id: 'body', op: 'base', shape: 'box', width: 20, depth: 20, height: 20, position: zero, rotation: zero },
    ] })) }
  let inference = 0
  await page.route('**/api/ai/local/generate', async (route) => { inference++; await route.abort() })
  await page.goto('/')
  await page.getByRole('button', { name: 'Conjunto composto', exact: true }).click()
  const upload = page.getByLabel('Importar rascunho CAD (JSON)')
  await upload.setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) })
  await expect(page.getByText('imported_supports · 2 componentes', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toHaveCount(0)
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":"4.0"}') })
  await expect(page.getByText('imported_supports · 2 componentes', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  const step = page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })
  await expect(step).toBeEnabled()
  const pending = page.waitForEvent('download')
  await step.click()
  expect((await pending).suggestedFilename()).toContain('.step')
  expect(inference).toBe(0)
})

test('repair button edits only the collision owner with a native patch, preserving its thread and finishing steps', async ({ page }) => {
  test.setTimeout(120_000)
  const zero = { x: 0, y: 0, z: 0 }
  const body = { id: 'body', op: 'base', shape: 'box', width: 50, depth: 40, height: 30, position: zero, rotation: zero }
  const thread = { id: 'threaded_hole', op: 'cut', shape: 'thread', diameter: 5, pitch: 0.8, height: 12,
    profile: 'metric', handedness: 'right', clearance: 0.1, starts: 1, position: { ...zero, x: 15, y: 12, z: 6 }, rotation: zero }
  const steps = [body, { id: 'finish', op: 'modify', shape: 'chamfer', selector: 'all', distance: 1, position: zero, rotation: zero }, thread]
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'patch_repaired', components: [
    { id: 'host', position: zero, steps }, { id: 'inner', position: zero, steps: [{ ...body, width: 10, depth: 10, height: 10 }] },
  ] }
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'test' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  let calls = 0
  await page.route('**/api/ai/local/generate', async (route) => {
    expect(++calls).toBe(1)
    const request = route.request().postDataJSON()
    expect(JSON.stringify(request)).toContain('replaceSteps')
    expect(JSON.stringify(request)).toContain('Edit ONLY component host')
    await route.fulfill({ json: { content: JSON.stringify({ decision: 'edit', partId: 'host', replaceSteps: [], removeStepIds: [],
      insertSteps: [{ afterStepId: 'threaded_hole', step: { ...body, id: 'clearance', op: 'cut', width: 12, depth: 12, height: 12 } }],
      question: '', assumptions: [] }), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Conjunto composto', exact: true }).click()
  await page.getByLabel('Importar rascunho CAD (JSON)').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) })
  const saved = page.waitForRequest((request) => request.url().endsWith('/api/cad/projects') && request.method() === 'POST', { timeout: 90_000 })
  await page.getByRole('button', { name: 'Corrigir interferências', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled({ timeout: 90_000 })
  const spec = (await saved).postDataJSON().spec
  expect(spec.components[0].steps.slice(0, 3)).toEqual(steps)
  expect(spec.components[0].steps[3].id).toBe('clearance')
  expect(spec.components[1]).toEqual(draft.components[1])
  expect(calls).toBe(1)
})

test('repair button resolves a cylindrical fit without any model request', async ({ page }) => {
  const zero = { x: 0, y: 0, z: 0 }
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'fit_without_inference', components: [
    { id: 'support', position: { ...zero, x: -30 }, steps: [
      { id: 'body', op: 'base', shape: 'box', width: 20, depth: 40, height: 40, position: zero, rotation: zero },
    ] },
    { id: 'guide', position: { ...zero, z: 10 }, steps: [
      { id: 'shaft', op: 'base', shape: 'cylinder', diameter: 8, height: 80, position: zero, rotation: { ...zero, y: 90 } },
    ] },
  ] }
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'test' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  let calls = 0
  await page.route('**/api/ai/local/generate', async (route) => { calls++; await route.abort() })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Conjunto composto', exact: true }).click()
  await page.getByLabel('Importar rascunho CAD (JSON)').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) })
  await page.getByRole('button', { name: 'Corrigir interferências', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled()
  expect(calls).toBe(0)
})

test('repair button restores a threaded fit and exports it without an AI request', async ({ page }) => {
  test.setTimeout(120_000)
  const zero = { x: 0, y: 0, z: 0 }, rotation = { ...zero, y: 90 }
  const common = { axis: 'x', minimum: -0.7, maximum: 0.7, value: 0.25, group: 'drive' }
  const thread = { id: 'helical_thread', op: 'union', shape: 'thread', diameter: 12, pitch: 3, height: 12,
    profile: 'trapezoidal', handedness: 'right', clearance: 0, starts: 1, position: zero, rotation }
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'thread_without_inference', components: [
    { id: 'screw', position: zero, motion: { ...common, kind: 'rotary', factor: -120 }, steps: [
      { id: 'journal', op: 'base', shape: 'cylinder', diameter: 10, height: 20, position: zero, rotation }, thread,
    ] },
    { id: 'nut', position: zero, motion: { ...common, kind: 'slider', factor: 1 }, steps: [
      { id: 'body', op: 'base', shape: 'cylinder', diameter: 22, height: 6, position: zero, rotation },
      { ...thread, id: 'internal_thread', op: 'cut', height: 6, clearance: 0.2, position: { ...zero, x: 3 } },
    ] },
    { id: 'reference', position: { ...zero, y: 50 }, steps: [
      { id: 'block', op: 'base', shape: 'box', width: 5, depth: 5, height: 5, position: zero, rotation: zero },
    ] },
  ] }
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'test' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  let calls = 0
  await page.route('**/api/ai/local/generate', async (route) => { calls++; await route.abort() })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Conjunto composto', exact: true }).click()
  await page.getByLabel('Importar rascunho CAD (JSON)').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) })
  const save = page.waitForRequest((request) => request.url().endsWith('/api/cad/projects') && request.method() === 'POST', { timeout: 90_000 })
  await page.getByRole('button', { name: 'Corrigir interferências', exact: true }).click()
  const download = page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })
  await expect(download).toBeEnabled({ timeout: 90_000 })
  const spec = (await save).postDataJSON().spec
  expect(spec.components[0].steps[0]).toEqual(draft.components[0].steps[0])
  expect(spec.components[0].steps[1].shape).toBe('tube')
  expect(spec.components[0].steps[2]).toEqual(thread)
  const female = spec.components[1].steps[1]
  expect(female.position.x).toBeCloseTo(0, 10)
  expect(female.height).toBe(8)
  expect(female.diameter).toBe(12)
  expect(female.pitch).toBe(3)
  expect(spec.components[2]).toEqual(draft.components[2])
  for (let i = 0; i < 2; i++) expect(spec.components[i].motion).toEqual(draft.components[i].motion)
  const pending = page.waitForEvent('download')
  await download.click()
  expect((await pending).suggestedFilename()).toContain('.step')
  expect(calls).toBe(0)
})

test('resuming a partial repair stays in repair mode and targets the next pair without a planning request', async ({ page }) => {
  const zero = { x: 0, y: 0, z: 0 }
  const body = { id: 'body', op: 'base', shape: 'box', width: 50, depth: 50, height: 50, position: zero, rotation: zero }
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'two_pending_pairs', components: [0, 1].flatMap((i) => [
    { id: `host_${i}`, position: { ...zero, x: i * 100 }, steps: [body] },
    { id: `inner_${i}`, position: { ...zero, x: i * 100 }, steps: [{ ...body, width: 10, depth: 10, height: 10 }] },
  ]) }
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'test' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  let calls = 0
  await page.route('**/api/ai/local/generate', async (route) => {
    const target = `host_${calls++}`
    expect(calls).toBeLessThanOrEqual(2)
    expect(JSON.stringify(route.request().postDataJSON())).toContain(`Edit ONLY component ${target}`)
    await route.fulfill({ json: { content: JSON.stringify({ decision: 'edit', partId: target, replaceSteps: [], removeStepIds: [],
      insertSteps: [{ afterStepId: 'body', step: { ...body, id: 'clearance', op: 'cut', width: 12, depth: 12, height: 12 } }],
      question: '', assumptions: [] }), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Conjunto composto', exact: true }).click()
  await page.getByLabel('Importar rascunho CAD (JSON)').setInputFiles({ name: 'draft.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) })
  await page.getByRole('button', { name: 'Corrigir interferências', exact: true }).click()
  const resume = page.getByRole('button', { name: 'Retomar correção', exact: true })
  await expect(resume).toBeEnabled()
  expect(calls).toBe(1)
  await expect(page.getByRole('button', { name: 'Retomar geração', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Baixar rascunho com erro (JSON)', exact: true })).toBeVisible()
  const save = page.waitForRequest((request) => request.url().endsWith('/api/cad/projects') && request.method() === 'POST')
  await resume.click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled()
  const spec = (await save).postDataJSON().spec
  expect(spec.components[0].steps[1].id).toBe('clearance')
  expect(spec.components[2].steps[1].id).toBe('clearance')
  expect(spec.components[1]).toEqual(draft.components[1])
  expect(spec.components[3]).toEqual(draft.components[3])
  expect(calls).toBe(2)
})
