import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { projectAction } from './threeHelpers.ts'

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('modeler:workspace', 'three')
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'fixture' }))
  })
  await page.route('http://127.0.0.1:8011/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Cena Three.js interativa' })).toBeVisible()
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download')
  await projectAction(page, 'Exportar JSON')
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}

test('creation gives the scene the main area, keeps technical controls optional and expands gameplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (/Shader Error|THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text()) })
  await open(page)
  await expect(page.getByLabel('Hierarquia da cena')).toBeHidden()
  await expect(page.getByLabel('Inspector de cena')).toBeHidden()
  await expect(page.getByLabel('Estatísticas do renderer')).toBeHidden()
  await expect(page.getByRole('combobox', { name: 'Ação da IA', exact: true })).toBeHidden()
  const initial = (await page.locator('.three-stage').boundingBox())!
  expect(initial.height).toBeGreaterThan(440)
  const welcome=await exported(page)
  expect(welcome.name).toBe('Seu próximo jogo')
  expect(welcome.nodes.some((node:{asset?:{type:string}})=>node.asset?.type==='house')).toBe(false)
  await projectAction(page,'Vale dos Ventos')
  const doc = await exported(page)
  expect(doc.name).toBe('Vale dos Ventos')
  expect(doc.nodes.length).toBeGreaterThan(800)
  expect(doc.nodes.find((node: { kind: string }) => node.kind === 'terrain').geometry.biome).toBe('meadow')
  await page.screenshot({ path: '.cache/browser/three-create.png' })
  await page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
  const hud = page.getByRole('region', { name: 'Modo jogo' })
  await expect(hud).toContainText('Itens 0/7')
  await expect(page.getByRole('textbox', { name: 'Descreva a cena Three.js' })).toBeHidden()
  expect((await page.locator('.three-stage').boundingBox())!.height).toBeGreaterThan(initial.height + 80)
  await page.screenshot({ path: '.cache/browser/three-valley-game.png' })
  await page.keyboard.press('Escape')
  await expect(hud).toBeHidden()
  await page.getByRole('button', { name: 'Editor avançado', exact: true }).click()
  await expect(page.getByLabel('Hierarquia da cena')).toBeVisible()
  await expect(page.getByLabel('Inspector de cena')).toBeVisible()
  expect(errors).toEqual([])
})

test('a user can create and then remove and add objects by conversation without choosing an action', async ({ page }) => {
  await open(page)
  let calls = 0
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    calls++
    const request = route.request().postDataJSON()
    if (calls === 2) {
      expect(JSON.stringify(request.messages)).toContain('CENA E DIAGNÓSTICO')
      expect(JSON.stringify(request.messages)).toContain('wood')
    }
    const sphere = { id: 'esfera', name: 'Esfera', kind: 'sphere', parentId: null, position: [0, 0.5, 0], dimensions: [1, 1, 1], color: '#aabbcc', metalness: 0.4, roughness: 0.3 }
    const content = calls === 1 ? { name: 'Ateliê de testes', background: '#dfe7ee', exposure: 1, lightIntensity: 1.5, duration: 12,
      nodes: [{ ...sphere, id: 'cubo', kind: 'box', surface: { texture: 'wood' } }] }
      : { updates: [], additions: [sphere], removals: ['cubo'], environment: { exposure: 1.2, player: { speed: 6 } } }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }) })
  })
  const prompt = page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true })
  await prompt.fill('Um cubo de madeira sobre fundo claro')
  await page.getByRole('button', { name: 'Criar cena com IA', exact: true }).click()
  await expect(page.locator('.three-commandbar__identity strong')).toHaveText('Ateliê de testes')
  await expect(prompt).toHaveValue('')
  await expect(page.getByRole('region', { name: 'Progresso da geração Three.js' })).toBeHidden()
  const original = await exported(page)
  await prompt.fill('Remova o cubo e adicione uma esfera')
  await page.getByRole('button', { name: 'Editar cena com IA', exact: true }).click()
  await expect(prompt).toHaveValue('')
  const edited = await exported(page)
  expect(edited.nodes.map((node: { id: string }) => node.id)).toEqual(['esfera'])
  expect(edited.environment.player).toEqual({ ...original.environment.player, speed: 6 })
  expect(edited.environment.exposure).toBe(1.2)
  expect(calls).toBe(2)
})

test('creation remains usable on a narrow screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  await expect(page.getByRole('textbox', { name: 'Descreva a cena Three.js' })).toBeVisible()
  await page.getByRole('button', { name: 'Plataformas no espaço ↗', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Descreva a cena Three.js' })).toContainText('plataformas no espaço')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '.cache/browser/three-create-mobile.png' })
})
