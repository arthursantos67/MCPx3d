import { openAdvancedEditor, projectAction } from './threeHelpers.ts'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({
      mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'test-fixture', model: 'fixture-model',
    }))
  })
  // The studio must remain usable while all backend requests fail.
  await page.route('http://127.0.0.1:8011/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Three.js Estúdio de cenas', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Cena Three.js interativa' })).toBeVisible()
  await openAdvancedEditor(page)
  await projectAction(page, 'Abrir exemplo')
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download')
  await projectAction(page, 'Exportar JSON')
  const download = await pending
  return JSON.parse(await readFile((await download.path())!, 'utf8'))
}

test('Three.js renders the local pavilion and edits, restores and round trips a scene without API', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await setup(page)
  await expect(page.getByLabel('Estatísticas do renderer')).toContainText(/[1-9][\d.]* triângulos/)
  await expect(page.getByText('Pavilhão Aurora', { exact: true })).toBeVisible()
  await page.screenshot({ path: '.cache/browser/three-pavilion.png' })
  await projectAction(page, 'Cena vazia')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  const name = page.getByRole('textbox', { name: 'Nome do objeto', exact: true })
  await name.fill('Peça de exposição')
  await name.press('Enter')
  const position = page.getByRole('spinbutton', { name: 'Posição (m) X', exact: true })
  await position.fill('2.5')
  await position.press('Enter')
  const metalness = page.getByRole('spinbutton', { name: 'Metalicidade', exact: true })
  await metalness.fill('0.8')
  await metalness.press('Enter')
  await page.getByRole('button', { name: 'Duplicar', exact: true }).click()
  await expect(name).toHaveValue('Peça de exposição (cópia)')
  await projectAction(page, 'Desfazer')
  await page.getByRole('button', { name: 'Projeto ▾', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refazer', exact: true })).toBeEnabled()
  await projectAction(page, 'Refazer')
  await expect(name).toHaveValue('Peça de exposição (cópia)')
  const doc = await exported(page)
  expect(doc.nodes).toHaveLength(2)
  expect(doc.nodes[0].position[0]).toBe(2.5)
  expect(doc.nodes[0].material.metalness).toBe(0.8)
  expect(doc.nodes[1].position[0]).toBe(3.75)
  await page.getByRole('button', { name: 'CAD STEP · STL', exact: true }).click()
  await expect(page.locator('.three-workspace')).toBeHidden()
  await page.getByRole('button', { name: 'Three.js Estúdio de cenas', exact: true }).click()
  expect(await exported(page)).toEqual(doc)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Three.js Estúdio de cenas', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await exported(page)).toEqual(doc)
  await projectAction(page, 'Cena vazia')
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'cena.three.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  expect(await exported(page)).toEqual(doc)
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'invalido.json', mimeType: 'application/json', buffer: Buffer.from('{"version":"9"}') })
  await expect(page.getByRole('alert').filter({ hasText: 'Importação recusada' })).toBeVisible()
  expect(await exported(page)).toEqual(doc)
  expect(errors).toEqual([])
})

test('viewport picking, local group transforms and subtree operations remain coherent', async ({ page }) => {
  await setup(page)
  await projectAction(page, 'Cena vazia')
  await page.getByRole('combobox', { name: 'Tipo de objeto' }).selectOption('group')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  const x = page.getByRole('spinbutton', { name: 'Posição (m) X', exact: true })
  await x.fill('3')
  await x.press('Enter')
  await page.getByRole('combobox', { name: 'Tipo de objeto' }).selectOption('box')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  const doc = await exported(page)
  expect(doc.nodes[1].parentId).toBe(doc.nodes[0].id)
  await page.getByRole('button', { name: 'Enquadrar seleção', exact: true }).click()
  await page.getByRole('button', { name: 'Limpar seleção', exact: true }).click()
  const canvas = page.getByRole('img', { name: 'Cena Three.js interativa' })
  const bounds = (await canvas.boundingBox())!
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } })
  await expect(page.getByRole('textbox', { name: 'Nome do objeto', exact: true })).toHaveValue('Caixa')
  await page.getByLabel('Hierarquia da cena').getByRole('button', { name: 'Grupo Grupo', exact: true }).click()
  await page.getByRole('button', { name: 'Duplicar grupo', exact: true }).click()
  expect((await exported(page)).nodes).toHaveLength(4)
  await page.getByRole('button', { name: 'Excluir grupo', exact: true }).click()
  expect((await exported(page)).nodes).toHaveLength(2)
  await projectAction(page, 'Desfazer')
  expect((await exported(page)).nodes).toHaveLength(4)
})

test('invalid numeric edits keep the valid document and mobile layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await projectAction(page, 'Cena vazia')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  const scale = page.getByRole('spinbutton', { name: 'Escala X', exact: true })
  await scale.fill('0')
  await scale.press('Enter')
  await expect(scale).toHaveAttribute('aria-invalid', 'true')
  expect((await exported(page)).nodes[0].scale[0]).toBe(1)
  await scale.fill('2')
  await scale.press('Enter')
  expect((await exported(page)).nodes[0].scale[0]).toBe(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.cache/browser/three-mobile.png', fullPage: true })
})

test('storage failure is reported while JSON export remains available', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') } })
  await projectAction(page, 'Cena vazia')
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível salvar' })).toBeVisible()
  expect((await exported(page)).nodes).toEqual([])
})

test('a corrupt local draft is preserved until an intentional edit', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('modeler:workspace', 'three')
    localStorage.setItem('modeler:three-scene:v1', '{corrupt')
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'fixture' }))
  })
  await page.goto('/')
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível recuperar' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('modeler:three-scene:v1'))).toBe('{corrupt')
  await projectAction(page, 'Cena vazia')
  await expect(page.locator('.three-save-indicator')).toHaveAttribute('title', 'Salvo neste navegador')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('modeler:three-scene:v1')!).nodes)).toEqual([])
})

test('WebGL2 failure leaves the scene editable and exportable', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof getContext>) {
      if (args[0] === 'webgl2') return null
      return getContext.apply(this, args)
    } as typeof getContext
  })
  await page.addInitScript(() => {
    localStorage.setItem('modeler:workspace', 'three')
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'fixture' }))
  })
  await page.goto('/')
  await expect(page.getByRole('alert').filter({ hasText: 'WebGL2 indisponível' })).toBeVisible()
  await openAdvancedEditor(page)
  await projectAction(page, 'Cena vazia')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  expect((await exported(page)).nodes).toHaveLength(1)
})

const animatedRecipe = {
  name: 'Observatório orbital', background: '#182b3e', exposure: 1.2, lightIntensity: 2, duration: 8,
  nodes: [{ id: 'orbital', parentId: null, name: 'Satélite', kind: 'box', position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1],
    color: '#38b9c6', metalness: 0.6, roughness: 0.35,
    animation: { kind: 'float', axis: 'y', duration: 8, amplitude: 1, phase: 0 },
    repeat: { mode: 'radial', count: 24, offset: [0, 0, 0], radius: 5, axis: 'y' } }],
}

test('AI creates a complete procedural animated scene and scrubbing changes the actual viewport', async ({ page }) => {
  await setup(page)
  let calls = 0
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    calls++
    const body = route.request().postDataJSON()
    expect(body.messages[0].content).toContain('diretor de arte')
    expect(body.response_format.json_schema.schema.properties.nodes).toBeTruthy()
    if (calls === 2) expect(body.messages.at(-1).content).toContain('Refine a receita')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(animatedRecipe) }, finish_reason: 'stop' }] }) })
  })
  await page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true }).fill('Um observatório orbital com 24 satélites flutuantes em um círculo.')
  await page.getByRole('button', { name: 'Criar cena com IA', exact: true }).click()
  await expect(page.getByText('Observatório orbital', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect.poll(async () => Number((await page.getByLabel('Tempo atual').innerText()).split(' / ')[0])).toBeGreaterThan(0.1)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  const doc = await exported(page)
  expect(calls).toBe(2)
  expect(doc.nodes).toHaveLength(24)
  expect(doc.nodes[0].animation.kind).toBe('float')
  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click()
  const canvas = page.getByRole('img', { name: 'Cena Three.js interativa' })
  const first = await canvas.screenshot()
  const slider = page.getByRole('slider', { name: 'Tempo da cena', exact: true })
  await slider.fill('2')
  await expect(page.getByLabel('Tempo atual')).toContainText('2.0 / 8 s')
  const second = await canvas.screenshot()
  expect(first.equals(second)).toBe(false)
  expect((await exported(page)).nodes[0].position).toEqual(doc.nodes[0].position)
  await page.getByRole('button', { name: 'Reproduzir', exact: true }).click()
  await page.getByRole('button', { name: 'CAD STEP · STL', exact: true }).click()
  const frozen = await page.getByLabel('Tempo atual').innerText()
  await page.getByRole('button', { name: 'Three.js Estúdio de cenas', exact: true }).click()
  await expect(page.getByLabel('Tempo atual')).not.toHaveText(frozen)
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await page.screenshot({ path: '.cache/browser/three-generated-animated.png' })
  await page.reload()
  expect((await exported(page)).nodes[0].animation).toEqual(doc.nodes[0].animation)
})

test('AI contract failure is bounded and preserves the previous scene', async ({ page }) => {
  await setup(page)
  const original = await exported(page)
  let calls = 0
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    calls++
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"nodes":[]}' }, finish_reason: 'stop' }] }) })
  })
  await page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true }).fill('Uma estação detalhada.')
  await page.getByRole('button', { name: 'Criar cena com IA', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'templates' })).toBeVisible()
  expect(calls).toBe(2)
  expect(await exported(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'CAD STEP · STL', exact: true })).toBeEnabled()
})

test('cancelling AI keeps the current scene and releases the editor', async ({ page }) => {
  await setup(page)
  const runtime = page.locator('.workspace-topbar').getByRole('status')
  await expect(runtime).toHaveText('IA pronta')
  const original = await exported(page)
  let resolveRequest: () => void = () => {}
  const requestStarted = new Promise<void>((resolve) => { resolveRequest = resolve })
  let release: () => void = () => {}
  const waitForRelease = new Promise<void>((resolve) => { release = resolve })
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    resolveRequest()
    await waitForRelease
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(animatedRecipe) }, finish_reason: 'stop' }] }) }).catch(() => {})
  })
  await page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true }).fill('Cena demorada.')
  await page.getByRole('button', { name: 'Criar cena com IA', exact: true }).click()
  await requestStarted
  await expect(runtime).toHaveText('IA gerando')
  await expect(runtime.locator('.workspace-runtime__dot')).toHaveClass(/workspace-runtime__dot--ready/)
  await page.getByRole('button', { name: 'Projeto ▾', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cena vazia', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'CAD STEP · STL', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancelar geração', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Geração cancelada' })).toBeVisible()
  await expect(runtime).toHaveText('IA pronta')
  release()
  expect(await exported(page)).toEqual(original)
  await page.getByRole('button', { name: 'Projeto ▾', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cena vazia', exact: true })).toBeEnabled()
})

test('progress shows the provider wait and applies a configurable five-minute deadline', async ({ page }) => {
  await setup(page)
  const original = await exported(page)
  await page.clock.install()
  let started: () => void = () => {}, release: () => void = () => {}
  const requestStarted = new Promise<void>((resolve) => { started = resolve })
  const delayed = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    calls++
    started()
    await delayed
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(animatedRecipe) }, finish_reason: 'stop' }] }) }).catch(() => {})
  })
  await expect(page.getByRole('combobox', { name: 'Tempo máximo de geração', exact: true })).toHaveValue('300')
  await page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true }).fill('Cena demorada com Codex.')
  await page.getByRole('button', { name: 'Criar cena com IA', exact: true }).click()
  await requestStarted
  const progress = page.getByRole('region', { name: 'Progresso da geração Three.js' })
  await expect(progress.locator('[aria-current="step"]')).toContainText('Construção da cena na IA')
  await expect(progress).toContainText('não transmite as etapas internas')
  await expect(progress).toContainText('chamada 1 de até 2')
  await page.clock.fastForward(121000)
  await expect(progress.getByLabel('Tempo decorrido')).toHaveText(/^02:/)
  await expect(page.getByRole('button', { name: 'Cancelar geração', exact: true })).toBeVisible()
  await page.clock.fastForward(180000)
  await expect(progress.getByRole('status')).toHaveText('Tempo esgotado')
  await expect(page.getByRole('alert').filter({ hasText: 'prazo de 5 minutos' })).toBeVisible()
  await expect(progress.locator('[data-state="stopped"]')).toContainText('Construção da cena na IA')
  await progress.getByText('Histórico desta tentativa', { exact: true }).click()
  await expect(progress).toContainText('resposta interrompida não pode ser retomada')
  release()
  expect(await exported(page)).toEqual(original)
  expect(calls).toBe(1)
  await page.getByRole('combobox', { name: 'Tempo máximo de geração', exact: true }).selectOption('600')
  await expect(page.getByRole('combobox', { name: 'Tempo máximo de geração', exact: true })).toHaveValue('600')
  const canvasBounds = (await page.getByRole('img', { name: 'Cena Three.js interativa' }).boundingBox())!
  const playbackBounds = (await page.getByRole('group', { name: 'Reprodução da cena' }).boundingBox())!
  expect(canvasBounds.y + canvasBounds.height).toBeLessThanOrEqual(playbackBounds.y + 1)
  await page.screenshot({ path: '.cache/browser/three-generation-timeout.png' })
})

test('progress preserves the contract diagnosis and identifies the correction call', async ({ page }) => {
  await setup(page)
  let calls = 0, started: () => void = () => {}, release: () => void = () => {}
  const correctionStarted = new Promise<void>((resolve) => { started = resolve })
  const delayed = new Promise<void>((resolve) => { release = resolve })
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    calls++
    if (calls === 2) { started(); await delayed }
    const response = calls === 1 ? { nodes: [] } : animatedRecipe
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }] }) })
  })
  await page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true }).fill('Cena com correção de contrato.')
  await page.getByRole('button', { name: 'Criar cena com IA', exact: true }).click()
  await correctionStarted
  const progress = page.getByRole('region', { name: 'Progresso da geração Three.js' })
  await expect(progress.locator('[aria-current="step"]')).toHaveText(/Correção pela IA/)
  await expect(progress).toContainText('chamada 2 de até 2')
  await progress.getByText('Histórico desta tentativa', { exact: true }).click()
  await expect(progress).toContainText('precisa de correção')
  release()
  await expect(progress.getByRole('status')).toHaveText('Cena concluída')
  await expect(progress.getByRole('list', { name: 'Etapas da geração' })).toBeHidden()
  await expect(progress).toContainText('24 objetos')
  expect(calls).toBe(2)
})

test('AI output outside the contract is adjusted and applied with visible notes instead of an error', async ({ page }) => {
  await setup(page)
  const recipe = { ...animatedRecipe, name: 'Receita imperfeita', nodes: [
    { ...animatedRecipe.nodes[0], id: 'ring', kind: 'sphere', geometry: { segments: 300 }, repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' } },
    { ...animatedRecipe.nodes[0], id: 'twin', name: 'Gêmeo', animation: { kind: 'none', axis: 'y', duration: 8, amplitude: 0, phase: 0 }, position: [0.2, 1, 0], repeat: { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y', onto: 'missing' } }] }
  let calls = 0
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    calls++
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) }, finish_reason: 'stop' }] }) })
  })
  await page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true }).fill('Duas esferas.')
  await page.getByRole('button', { name: 'Criar cena com IA', exact: true }).click()
  await expect(page.getByText('Receita imperfeita', { exact: true })).toBeVisible()
  const notes = page.locator('.three-generation-notes')
  await expect(notes).toContainText('Segmentos')
  await expect(notes).toContainText('Correção automática')
  await expect(page.locator('.three-spatial summary')).toContainText('0 pares')
  expect(calls).toBe(1)
  const doc = await exported(page)
  expect(doc.nodes).toHaveLength(2)
  expect(doc.nodes[0].geometry.segments).toBe(20)
})
