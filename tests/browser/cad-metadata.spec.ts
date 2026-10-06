import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { if (window.top === window) localStorage.setItem('modeler:cad-mechanics', 'concept') }) })

test('GPT component explanations exceeding 180 characters preserve assembly generation and STEP/STL exports', async ({ page }) => {
  const assumption = 'Foi adotada uma largura de 50 mm, profundidade de 30 mm e altura de 20 mm para este suporte, mantendo duas peças independentes separadas por 100 mm no eixo X. Essas medidas são apenas exemplos proporcionais e não representam uma certificação de resistência mecânica ou tolerância de fabricação.'
  const assumptions = [...Array.from({ length: 13 }, (_, index) => `Premissa ${index + 1}`), assumption]
  const zero = { x: 0, y: 0, z: 0 }
  const components = ['suporte-esquerdo', 'suporte-direito'].map((id, index) => ({
    id, action: 'build', description: 'Suporte retangular', position: { ...zero, x: index * 100 },
    motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 },
  }))
  const responses = [
    { kind: 'assembly', reason: 'Dois corpos independentes' },
    { decision: 'create', partId: 'suportes', question: '', assumptions: [], components },
    ...components.map((component) => ({ decision: 'create', question: '', assumptions, spec: {
      schemaVersion: '3.0', units: 'mm', partId: component.id,
      steps: [{ id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 50, depth: 30, height: 20 }],
    } })),
  ]
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'gpt-5.6-terra' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  await page.route('**/api/ai/local/generate', async (route) => {
    expect(route.request().postDataJSON().model).toBe('gpt-5.6-terra')
    const response = responses.shift()
    expect(response).toBeTruthy()
    await route.fulfill({ json: { content: JSON.stringify(response), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie dois suportes retangulares separados por 100 mm no eixo X')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  const step = page.getByRole('button', { name: 'Baixar STEP do conjunto', exact: true })
  await expect(step).toBeEnabled()
  await page.getByText('Premissas (28)', { exact: true }).click()
  await expect(page.getByText(`suporte-esquerdo: ${assumption}`, { exact: true })).toBeVisible()
  await expect(page.getByText(`suporte-direito: ${assumption}`, { exact: true })).toBeVisible()
  expect(responses).toHaveLength(0)
  for (const [button, extension] of [[step, '.step'], [page.getByRole('button', { name: 'Baixar STL do conjunto', exact: true }), '.stl']] as const) {
    const pending = page.waitForEvent('download')
    await button.click()
    expect((await pending).suggestedFilename()).toContain(extension)
  }
})
