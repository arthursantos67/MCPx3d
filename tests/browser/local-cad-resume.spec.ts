import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { if (window.top === window) localStorage.setItem('modeler:cad-mechanics', 'concept') }) })

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
