import { test, expect } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'

const zero = { x: 0, y: 0, z: 0 }
const fixed = { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'gpt-5.6-terra' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
})

test('a rejected finish still offers STEP/STL and conserves the source after reloading', async ({ page }) => {
  const body = { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 20, depth: 20, height: 10 }
  const finish = { id: 'finish', op: 'modify', shape: 'chamfer', position: zero, rotation: zero, selector: 'all', distance: 100 }
  const responses = [
    { kind: 'part', reason: 'Um único sólido' },
    { decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm', partId: 'failed_finish', steps: [body, finish] } },
    { selector: 'top', size: 100, beforeStepId: '' },
    { decision: 'edit', partId: 'failed_finish', replaceSteps: [{ ...finish, selector: 'positive_x' }], insertSteps: [], removeStepIds: [], question: '', assumptions: [] },
    { selector: 'bottom', size: 100, beforeStepId: '' },
  ]
  let calls = 0
  await page.route('**/api/ai/local/generate', async (route) => {
    calls++
    const response = responses.shift()
    expect(response).toBeTruthy()
    await route.fulfill({ json: { content: JSON.stringify(response), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie um bloco com chanfro de 100 mm')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /A peça ainda não passou.*3 correções/ }).first()).toBeVisible()
  expect(calls).toBe(5)
  const downloadButton = page.getByRole('button', { name: 'Baixar rascunho STEP/STL (ZIP)', exact: true })
  await expect(downloadButton).toBeEnabled()
  await expect(page.getByText(/Prévia do rascunho.*Algumas etapas/)).toBeVisible()
  const pending = page.waitForEvent('download')
  await downloadButton.click()
  const file = await pending
  expect(file.suggestedFilename()).toBe('failed_finish-rascunho.zip')
  expect(statSync((await file.path())!).size).toBeGreaterThan(100)
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Baixar rascunho STEP/STL (ZIP)', exact: true })).toBeEnabled()
  expect(calls).toBe(5)
  const sourcePending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar geometria original (JSON)', exact: true }).click()
  const source = JSON.parse(readFileSync((await (await sourcePending).path())!, 'utf8'))
  expect(source.partId).toBe('failed_finish')
  expect(source.steps.map((step: { id: string }) => step.id)).toEqual(['body', 'finish'])
  expect(source.steps[1].distance).toBe(100)
})

test('the CAD engine accepts an undersized guide after local fit correction without another AI call', async ({ page }) => {
  const supports = [-1, 1].map((sign) => ({ id: sign < 0 ? 'left' : 'right', position: { ...zero, x: sign * 102 }, steps: [
    { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 12, depth: 20, height: 20 },
    { id: 'bore', op: 'cut', shape: 'hole', position: { ...zero, x: 6 }, rotation: { ...zero, y: 90 }, diameter: 8.4, height: 12,
      holeType: 'plain', headDiameter: 0, headDepth: 0 },
  ] }))
  const mechanics = { grounded: 'left', connections: supports.map((component) => ({
    id: `${component.id}_fix`, kind: 'fixed', first: 'guide', second: component.id, firstFeature: 'shaft', secondFeature: 'bore',
    minEngagement: 12, maxClearance: .3, fastening: 'bonded', fastenerDiameter: 0,
  })) }
  const plan = [...supports, { id: 'guide', position: zero }].map((component) => ({ ...component, action: 'build', description: 'Escolha dimensões compatíveis com os encaixes existentes', motion: fixed }))
  const bodies = [...supports, { id: 'guide', steps: [{ id: 'shaft', op: 'base', shape: 'cylinder', position: zero,
    rotation: { ...zero, y: 90 }, diameter: 8, height: 208 }] }]
  const responses = [
    { kind: 'assembly', reason: 'Guia com dois suportes' },
    { decision: 'create', partId: 'guide_auto_fit', question: '', assumptions: [], mechanics, components: plan },
    ...bodies.map((body) => ({ decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm', partId: body.id, steps: body.steps } })),
  ]
  let calls = 0
  const lengths: number[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/cad/programs/inspect') && request.postDataJSON().partId === 'guide') lengths.push(request.postDataJSON().steps[0].height)
  })
  await page.route('**/api/ai/local/generate', async (route) => {
    calls++
    const response = responses.shift()
    expect(response).toBeTruthy()
    if (calls === 5) expect(route.request().postDataJSON().messages[1].content).toContain('Computed mating targets')
    await route.fulfill({ json: { content: JSON.stringify(response), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Monte uma guia com dois suportes e vínculos físicos verificados')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled()
  expect(calls).toBe(5)
  expect(lengths).toEqual([216])
  await expect(page.getByText(/Vínculos mecânicos verificados nas poses/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baixar rascunho STEP/STL (ZIP)', exact: true })).toHaveCount(0)
})

test('a failed component preserves the complete draft and resumes without rebuilding the other bodies', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('modeler:cad-mechanics', 'concept'))
  const body = { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 20, depth: 20, height: 10 }
  const finish = { id: 'finish', op: 'modify', shape: 'chamfer', position: zero, rotation: zero, selector: 'all', distance: 100 }
  const components = ['pending', 'ready', 'also_ready'].map((id, index) => ({ id, action: 'build', description: 'Bloco independente',
    position: { ...zero, x: index * 50 }, motion: fixed }))
  const creation = (id: string, steps: readonly object[] = [body]) => ({ decision: 'create', question: '', assumptions: [],
    spec: { schemaVersion: '3.0', units: 'mm', partId: id, steps } })
  const patch = (selector: string, distance: number) => ({ decision: 'edit', partId: 'pending',
    replaceSteps: [{ ...finish, selector, distance }], insertSteps: [], removeStepIds: [], question: '', assumptions: [] })
  const responses = [
    { kind: 'assembly', reason: 'Três peças' },
    { decision: 'create', partId: 'continued_draft', components, mechanics: null, question: '', assumptions: [] },
    creation('pending', [body, finish]),
    { selector: 'top', size: 100, beforeStepId: '' }, patch('positive_x', 100),
    { selector: 'bottom', size: 100, beforeStepId: '' },
    creation('ready'), creation('also_ready'), patch('bottom', .5),
  ]
  let calls = 0
  const inspections: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/cad/programs/inspect')) inspections.push(request.postDataJSON().partId)
  })
  await page.route('**/api/ai/local/generate', async (route) => {
    calls++
    const response = responses.shift()
    expect(response).toBeTruthy()
    await route.fulfill({ json: { content: JSON.stringify(response), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Monte três peças separadas')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /Geometria disponível.*1 componente/ }).first()).toBeVisible()
  expect(calls).toBe(8)
  const sourcePending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar geometria original (JSON)', exact: true }).click()
  const source = JSON.parse(readFileSync((await (await sourcePending).path())!, 'utf8'))
  expect(source.components.map((component: { id: string }) => component.id)).toEqual(['pending', 'ready', 'also_ready'])
  const bundlePending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar rascunho STEP/STL (ZIP)', exact: true }).click()
  expect(statSync((await (await bundlePending).path())!).size).toBeGreaterThan(100)
  await page.getByRole('button', { name: 'Retomar geração', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled()
  expect(calls).toBe(9)
  expect(inspections.filter((id) => id === 'ready')).toHaveLength(1)
  expect(inspections.filter((id) => id === 'also_ready')).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Baixar rascunho STEP/STL (ZIP)', exact: true })).toHaveCount(0)
})
