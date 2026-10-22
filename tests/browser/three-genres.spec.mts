import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createCombatArenaScene } from '../../apps/web/src/three/sceneExperiences.ts'
import { subtreeIds } from '../../apps/web/src/three/sceneDocument.ts'
import { projectAction, leaveGame } from './threeHelpers.ts'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (/Shader Error|THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text()) })
  await page.addInitScript(() => {
    localStorage.setItem('modeler:workspace', 'three')
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'fixture' }))
  })
  await page.route('http://127.0.0.1:8011/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Cena Three.js interativa' })).toBeVisible()
  return errors
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download')
  await projectAction(page, 'Exportar JSON')
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}
const play = (page: Page) => page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
const hud = (page: Page) => page.getByRole('region', { name: 'Modo jogo' })

test('the neutral workspace offers a combat game with actual enemies instead of a village', async ({ page }) => {
  const errors = await open(page)
  expect((await exported(page)).name).toBe('Seu próximo jogo')
  await page.getByRole('button', { name: 'Jogar arena ↗', exact: true }).click()
  const doc = await exported(page)
  expect(doc.environment.objective.type).toBe('defeatEnemies')
  expect(doc.nodes.filter((n: { behavior?: { type: string } }) => n.behavior?.type === 'enemy')).toHaveLength(3)
  expect(doc.nodes.some((n: { asset?: { type: string } }) => n.asset?.type === 'house')).toBe(false)
  await play(page)
  await expect(hud(page)).toContainText('Inimigos 0/3')
  await page.screenshot({ path: '.cache/browser/genre-arena.png' })
  await leaveGame(page)
  await expect(hud(page)).toBeHidden()
  expect(await exported(page)).toEqual(doc)
  expect(errors).toEqual([])
})

test('platform game starts with a portal objective, physical raised platforms and flight disabled', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: 'Jogar plataformas ↗', exact: true }).click()
  const doc = await exported(page)
  expect(doc.environment.player.allowFly).toBe(false)
  expect(doc.nodes.filter((n: { id: string }) => /^platform-/.test(n.id))).toHaveLength(6)
  expect(doc.nodes.some((n: { kind: string }) => n.kind === 'terrain')).toBe(false)
  await play(page)
  await expect(hud(page)).toContainText('Atravesse as plataformas e alcance o portal')
  await page.keyboard.press('f')
  await expect(hud(page)).not.toContainText('Voo livre')
  await page.screenshot({ path: '.cache/browser/genre-platforms.png' })
  await leaveGame(page)
  expect(errors).toEqual([])
})

test('laboratory console activates the bridge in play mode and preserves the authored document', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: 'Resolver puzzle ↗', exact: true }).click()
  const doc = await exported(page)
  await play(page)
  await expect(hud(page)).toContainText(/Acionar · control/)
  await page.keyboard.press('e')
  await expect(hud(page).getByRole('status')).toContainText('Ponte acionada')
  await page.waitForTimeout(1800)
  await page.screenshot({ path: '.cache/browser/genre-laboratory.png' })
  await leaveGame(page)
  await expect(hud(page)).toBeHidden()
  expect(await exported(page)).toEqual(doc)
  expect(errors).toEqual([])
})

test('a robot can be defeated with the real melee action and completes the combat objective', async ({ page }) => {
  const errors = await open(page)
  const doc = createCombatArenaScene()
  const removed = new Set([...subtreeIds(doc.nodes, 'sentinel-b'), ...subtreeIds(doc.nodes, 'crawler-a')])
  doc.nodes = doc.nodes.filter(node => !removed.has(node.id))
  const enemy = doc.nodes.find(node => node.id === 'sentinel-a')!
  enemy.position = [0, 0, 0]
  enemy.behavior!.speed = 0
  doc.environment.player.spawn = [0, 0.02, 2.2]
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'combat.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  const original = await exported(page)
  await play(page)
  await expect(hud(page)).toContainText('Atacar · sentinel-a')
  await page.keyboard.press('e')
  await expect(page.getByRole('dialog', { name: 'Vitória' })).toBeVisible()
  await expect(hud(page)).toContainText('Inimigos 1/1')
  await leaveGame(page)
  expect(await exported(page)).toEqual(original)
  expect(errors).toEqual([])
})
