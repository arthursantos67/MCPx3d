import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { if (window.top === window) localStorage.setItem('modeler:cad-mechanics', 'concept') }) })

for (const kind of ['part', 'assembly'] as const) test(`a failed circular handwheel chamfer in a ${kind} is repaired and saved without user intervention`, async ({ page }) => {
  test.setTimeout(180_000)
  const draft = JSON.parse(readFileSync('tests/fixtures/cad/threaded-handwheel-finishing.json', 'utf8'))
  const zero = { x: 0, y: 0, z: 0 }
  const responses: unknown[] = [
    { kind, reason: 'Fuso com volante' },
    ...(kind === 'assembly' ? [
      { decision: 'create', partId: 'handwheel_finish_regression', question: '', assumptions: [], components: ['base', draft.partId].map((id, index) => ({
        id, action: 'build', description: index ? 'Fuso roscado com volante e chanfros' : 'Base retangular',
        position: { ...zero, x: index ? 0 : -100 },
        motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 },
      })) },
      { decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm', partId: 'base',
        steps: [{ id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 20, depth: 20, height: 10 }] } },
    ] : []),
    { decision: 'create', spec: draft, question: '', assumptions: [] },
    { selector: 'positive_x', size: 1, beforeStepId: '' },
  ]
  const selections: string[] = []
  const componentsChecked: string[] = []
  const expectedCalls = kind === 'assembly' ? 5 : 3
  let calls = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/api/cad/programs/inspect')) {
      const spec = request.postDataJSON()
      componentsChecked.push(spec.partId)
      if (spec.partId === draft.partId) selections.push(spec.steps.at(-1).selector)
    }
  })
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'gpt-5.6-terra' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  await page.route('**/api/ai/local/generate', async (route) => {
    calls++
    const response = responses.shift()
    expect(response).toBeTruthy()
    if (calls === expectedCalls) {
      const input = route.request().postDataJSON()
      expect(input.schema.required).toEqual(['selector', 'size', 'beforeStepId'])
      expect(input.messages[1].content).toContain('selected edges:')
      expect(input.messages[1].content).toContain('shaftAndWheelChamfers')
    }
    await route.fulfill({ json: { content: JSON.stringify(response), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie um fuso roscado com volante e chanfro de 1 mm')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  const step = page.getByRole('button', { name: kind === 'assembly' ? 'Baixar STEP do conjunto' : 'Baixar STEP', exact: true })
  await expect(step).toBeEnabled({ timeout: 150_000 })
  expect(calls).toBe(expectedCalls)
  expect(responses).toHaveLength(0)
  expect(selections).toEqual(['circular', 'positive_x'])
  if (kind === 'assembly') expect(componentsChecked.filter((id) => id === 'base')).toHaveLength(1)
  await expect(page.getByText(/Retome o mesmo pedido|Autoriza|tentativa de correção permitida/)).toHaveCount(0)
  const pending = page.waitForEvent('download')
  await step.click()
  expect((await pending).suggestedFilename()).toContain('.step')
})

test('an incomplete native component pauses and resumes without repeating completed model requests', async ({ page }) => {
  const zero = { x: 0, y: 0, z: 0 }
  const components = ['suporte_esquerdo', 'suporte_direito'].map((id, index) => ({
    id, action: 'build', description: 'Suporte retangular', position: { ...zero, x: index * 100 },
    motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 },
  }))
  const body = (index: number) => JSON.stringify({ decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: components[index].id,
    steps: [{ id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 50, depth: 30, height: 20 }],
  } })
  const responses = [
    JSON.stringify({ kind: 'assembly', reason: 'Dois corpos independentes' }),
    JSON.stringify({ decision: 'create', partId: 'suportes_resume', question: '', assumptions: [], components }),
    body(0), '{"decision":"create","spec":{"steps":[', body(1),
  ]
  let calls = 0
  let saves = 0
  const checked: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/cad/programs/inspect')) checked.push(request.postDataJSON().partId)
  })
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'gpt-5.6-terra' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  await page.route('**/api/ai/local/generate', async (route) => {
    calls++
    const content = responses.shift()
    expect(content).toBeTruthy()
    await route.fulfill({ json: { content, finishReason: 'stop' } })
  })
  await page.route('**/api/cad/projects', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().spec?.schemaVersion === '4.0' && ++saves === 1) {
      await route.fulfill({ status: 503, json: { code: 'CAD_ENGINE_UNAVAILABLE', message: 'Salvamento temporariamente indisponível.' } })
    } else await route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie dois suportes retangulares separados por 100 mm no eixo X')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByText(/Componente suporte_direito:.*JSON incompleto/)).toBeVisible()
  const resume = page.getByRole('button', { name: 'Retomar geração', exact: true })
  await expect(resume).toBeEnabled()
  expect(calls).toBe(4)
  expect(checked.filter((id) => id === components[0].id)).toHaveLength(1)
  await resume.click()
  await expect(page.getByText('Salvamento temporariamente indisponível.', { exact: true })).toBeVisible()
  expect(calls).toBe(5)
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  const step = page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })
  await expect(step).toBeEnabled()
  expect(calls).toBe(5)
  expect(responses).toHaveLength(0)
  expect(saves).toBe(2)
  expect(checked.filter((id) => id === components[0].id)).toHaveLength(1)
  for (const [button, extension] of [[step, '.step'], [page.getByRole('button', { name: 'Baixar STL do conjunto', exact: true }), '.stl']] as const) {
    const pending = page.waitForEvent('download')
    await button.click()
    expect((await pending).suggestedFilename()).toContain(extension)
  }
})
