import { test, expect } from '@playwright/test'

test('late initialization from the previous provider cannot overwrite the active provider status', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'old' })))
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/ai/local/status/codex', async (route) => {
    await pending
    await route.fulfill({ json: { installed: false, authenticated: false, message: 'Old client unavailable' } })
  })
  await page.route('**/api/ai/local/status/claude', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  const oldResponse = page.waitForResponse('**/api/ai/local/status/codex')
  await page.goto('/')
  await page.getByRole('button', { name: 'Configurar IA', exact: true }).first().click()
  await page.getByRole('radio', { name: 'Claude Code · assinatura Claude', exact: true }).check()
  await page.getByRole('button', { name: 'Salvar e aplicar', exact: true }).click()
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  release()
  await oldResponse
  await page.waitForFunction(() => !document.body.textContent?.includes('Old client unavailable'))
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
})

for (const client of ['codex', 'claude'] as const) {
  test(`${client} subscription diagnostic uses unsaved fields then applies to CAD`, async ({ page }) => {
    const saved = { mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'old-model' }
    await page.addInitScript((config) => {
      localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify(config))
    }, saved)
    await page.route('**/api/ai/local/status/*', (route) => route.fulfill({ json: {
      client, installed: true, authenticated: true, plan: client === 'claude' ? 'team' : null, message: 'Cliente conectado.',
    } }))
    const requests: Record<string, unknown>[] = []
    await page.route('**/api/ai/local/generate', async (route) => {
      const body = route.request().postDataJSON()
      requests.push(body)
      const content = requests.length === 1 ? { ok: true } : requests.length === 2
        ? { kind: 'part', reason: 'Single plate' }
        : { decision: 'create', question: '', assumptions: [], spec: {
          schemaVersion: '3.0', units: 'mm', partId: 'cli_plate', steps: [{
            id: 'body', op: 'base', shape: 'box', width: 60, depth: 40, height: 8,
            position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
          }],
        } }
      await route.fulfill({ json: { content: JSON.stringify(content), finishReason: 'stop' } })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Configurar IA' }).click()
    await page.getByRole('radio', { name: client === 'codex' ? 'Codex · assinatura ChatGPT' : 'Claude Code · assinatura Claude', exact: true }).check()
    await expect(page.getByRole('textbox', { name: 'Modelo (opcional)' })).toHaveValue('')
    await page.getByRole('button', { name: 'Verificar instalação e login' }).click()
    await expect(page.locator('.provider-settings__diagnostic')).toContainText('Cliente conectado.')
    await page.getByRole('button', { name: 'Testar conexão', exact: true }).click()
    await expect(page.locator('.provider-settings__diagnostic')).toContainText('resposta JSON confirmadas')
    expect(requests[0].client).toBe(client)
    expect(requests[0].model).toBe('')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ai-web3d-modeler.provider-config.v1')!))).toEqual(saved)
    await page.getByRole('button', { name: 'Salvar e aplicar' }).click()
    await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ai-web3d-modeler.provider-config.v1')!))).toEqual({ mode: 'cli', client, model: '' })
    await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Placa de 60 por 40 por 8 mm')
    await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled({ timeout: 120_000 })
    expect(requests).toHaveLength(3)
  })
}

test('connection quota is displayed before CAD and does not save settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'old' })))
  await page.route('**/api/ai/local/status/*', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  await page.route('**/api/ai/local/generate', (route) => route.fulfill({ status: 429, json: { code: 'CLI_QUOTA', message: 'A assinatura atingiu um limite de uso.' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Configurar IA' }).click()
  await page.getByRole('radio', { name: 'Codex · assinatura ChatGPT', exact: true }).check()
  await page.getByRole('button', { name: 'Testar conexão', exact: true }).click()
  await expect(page.locator('.provider-settings [role="alert"]')).toContainText('limite de uso')
  await expect(page.getByRole('button', { name: 'Salvar e aplicar' })).toBeEnabled()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ai-web3d-modeler.provider-config.v1')!).mode)).toBe('byok')
})

test('closing during login verification prevents a later inference request', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'old' })))
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/ai/local/status/*', async (route) => {
    await pending
    await route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } })
  })
  let inferences = 0
  await page.route('**/api/ai/local/generate', async (route) => {
    inferences += 1
    await route.fulfill({ json: { content: '{"ok":true}', finishReason: 'stop' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Configurar IA' }).click()
  await page.getByRole('radio', { name: 'Codex · assinatura ChatGPT', exact: true }).check()
  const statusRequested = page.waitForRequest('**/api/ai/local/status/codex')
  await page.getByRole('button', { name: 'Testar conexão', exact: true }).click()
  await statusRequested
  await page.getByRole('button', { name: 'Cancelar teste e fechar' }).click()
  const completed = page.waitForResponse('**/api/ai/local/status/codex')
  release()
  await completed
  await page.getByRole('button', { name: 'Configurar IA' }).click()
  await expect(page.getByRole('button', { name: 'Testar conexão', exact: true })).toBeEnabled()
  expect(inferences).toBe(0)
})
