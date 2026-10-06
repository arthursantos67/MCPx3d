import { test, expect } from '@playwright/test'

const zero = { x: 0, y: 0, z: 0 }
const components = ['base', 'support'].map((id, index) => {
  const height = index ? 20 : 4
  return { id, position: { ...zero, z: index ? 4 : 0 }, steps: [
    { id: 'body', op: 'base', shape: 'box', position: { ...zero, z: height / 2 }, rotation: zero, width: 20, depth: 30, height },
    { id: 'mount', op: 'cut', shape: 'hole', position: { ...zero, y: -8, z: height }, rotation: zero,
      height: height + 2, diameter: 4.4, holeType: 'plain', headDiameter: 0, headDepth: 0,
      pattern: { kind: 'linear', count: 2, offset: { ...zero, y: 16 } } },
  ] }
})
const mechanics = { grounded: 'base', connections: [{ id: 'mount', kind: 'fixed', first: 'support', second: 'base',
  firstFeature: 'mount', secondFeature: 'mount', maxClearance: 0.3, minEngagement: 4, fastening: 'bolted', fastenerDiameter: 4 }] }

test('mechanical creation requires bindings, verifies a real mount and rejects a floating revision', async ({ page, request }) => {
  const responses = [
    { kind: 'assembly', reason: 'Base and bolted support' },
    { decision: 'create', partId: 'mechanical_mount_browser', question: '', assumptions: ['Instalar dois parafusos M4, porcas e arruelas.'], mechanics,
      components: components.map(({ id, position }) => ({ id, position, action: 'build', description: 'Matching mounting faces and two mount bores',
        motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 } })) },
    ...components.map(({ id, steps }) => ({ decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm', partId: id, steps } })),
  ]
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'gpt-5.6-terra' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  await page.route('**/api/ai/local/generate', async (route) => {
    const response = responses.shift()
    expect(response).toBeTruthy()
    await route.fulfill({ json: { content: JSON.stringify(response), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie uma base com suporte fixado por dois parafusos M4')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: 'Verificar vínculos mecânicos ao criar' })).toBeChecked()
  await expect(page.getByText('Vínculos mecânicos verificados nas poses amostradas.', { exact: true })).toBeVisible()
  expect(responses).toHaveLength(0)
  await page.getByRole('button', { name: 'Verificar montagem', exact: true }).click()
  await expect(page.getByText(/instalar fixadores Ø4 mm/)).toBeVisible()
  const projectId = await page.evaluate(() => localStorage.getItem('ai-web3d:cad-assembly'))
  expect(projectId).toBeTruthy()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true }).click()
  expect((await download).suggestedFilename()).toContain('.step')
  const support = page.locator('details').filter({ has: page.getByText('support · fixo · 2 etapas', { exact: true }) })
  await support.locator('summary').click()
  await support.getByLabel('Posição z (mm)', { exact: true }).fill('6')
  await expect(page.getByText(/instalar fixadores Ø4 mm/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /mounting surfaces have no shared planar contact area/ })).toBeVisible()
  expect((await (await request.get(`http://127.0.0.1:8011/api/cad/projects/${projectId}`)).json()).revision).toBe(0)
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toHaveCount(0)
  expect(responses).toHaveLength(0)
})

test('legacy assembly inspection reports the 24 mm unsupported gap without inference', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Conjunto composto', exact: true }).click()
  const draft = { schemaVersion: '4.0', units: 'mm', partId: 'floating_legacy_browser', components: components.map((component, index) =>
    index ? { ...component, position: { ...component.position, z: 28 } } : component) }
  await page.getByLabel('Importar rascunho CAD (JSON)').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)) })
  await expect(page.getByText('Vínculos mecânicos não verificados. Ausência de colisões não comprova funcionamento.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Verificar montagem', exact: true }).click()
  await expect(page.getByText('support: distância de 24.00 mm até base. Verifique a fixação.', { exact: true })).toBeVisible()
})

for (const questionCount of [1, 3]) test(`component decisions stay internal, preserve the base and bound attempts (${questionCount} questions)`, async ({ page }) => {
  const question = questionCount === 1
    ? 'Autoriza aumentar a altura do carro e reposicionar os furos da flange para fora da cavidade?'
    : 'Posso aumentar a guia para Ø8×216 ou alterar os suportes já validados?'
  const programs = components.map(({ id, steps }) => ({ decision: 'create', question: '', assumptions: [],
    spec: { schemaVersion: '3.0', units: 'mm', partId: id, steps } }))
  const responses = [
    { kind: 'assembly', reason: 'Base and support' },
    { decision: 'create', partId: 'clarification_resume_browser', question: '', assumptions: [], mechanics,
      components: components.map(({ id, position }) => ({ id, position, action: 'build', description: 'Matching faces and mount bores',
        motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 } })) },
    programs[0], ...Array.from({ length: questionCount }, () => ({ decision: 'clarify', question, spec: null, assumptions: [] })), programs[1],
  ]
  const checked: string[] = []
  page.on('request', (request) => { if (request.url().endsWith('/api/cad/programs/inspect')) checked.push(request.postDataJSON().partId) })
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'gpt-5.6-terra' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  await page.route('**/api/ai/local/generate', async (route) => {
    const response = responses.shift()
    expect(response).toBeTruthy()
    await route.fulfill({ json: { content: JSON.stringify(response), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie uma base e suporte com fixação útil; escolha as dimensões')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  if (questionCount === 3) {
    await expect(page.getByText(/O agente não conseguiu concluir uma decisão de projeto automaticamente/)).toBeVisible()
    await expect(page.getByText('support: ' + question, { exact: true })).toHaveCount(0)
    expect(responses).toHaveLength(1)
    await page.getByRole('button', { name: 'Retomar geração', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })).toBeEnabled()
  await expect(page.getByText('support: ' + question, { exact: true })).toHaveCount(0)
  await expect(page.getByText('Vínculos mecânicos verificados nas poses amostradas.', { exact: true })).toBeVisible()
  expect(responses).toHaveLength(0)
  expect(checked).toEqual(['base', 'support'])
})
