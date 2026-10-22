import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createEmptyScene, createNode, validateScene } from '../../apps/web/src/three/sceneDocument.ts'
import { openAdvancedEditor, projectAction, leaveGame } from './threeHelpers.ts'

test('equipped robot fires in both camera views and preserves the authored document', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (/Shader Error|THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text()) })
  await page.addInitScript(() => localStorage.setItem('modeler:workspace', 'three'))
  await page.route('http://127.0.0.1:8011/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/')
  await openAdvancedEditor(page)
  const floor = { ...createNode('box'), id: 'floor', position: [0, -0.1, 0], dimensions: [16, 0.2, 16] }
  const target = { ...createNode('box'), id: 'target', name: 'Alvo', position: [0, 1, -5], dimensions: [1.5, 2, 0.3],
    behavior: { type: 'enemy', speed: 0, range: 12, damage: 1, health: 100, attack: 'ranged' } }
  const doc = validateScene({ ...createEmptyScene(), name: 'Regressão de equipamento', nodes: [floor, target],
    environment: { ...createEmptyScene().environment, player: { spawn: [0, 0, 0], yaw: 0, speed: 3, jumpHeight: 1, mode: 'walk', avatar: 'robot', weapon: 'blaster', camera: 'third' }, motion: { wind: 0, grass: 'none', fauna: 'none' } } })
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'motion.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  const exportDoc = async () => {
    const pending = page.waitForEvent('download')
    await projectAction(page, 'Exportar JSON')
    return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
  }
  const before = await exportDoc()
  await page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
  const hud = page.getByRole('region', { name: 'Modo jogo' })
  await expect(hud).toBeVisible()
  await page.keyboard.down('s')
  await page.waitForTimeout(350)
  await page.keyboard.up('s')
  await page.keyboard.press('e')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.cache/browser/three-motion-third.png' })
  await page.keyboard.press('KeyV')
  await expect(hud).toContainText('1ª pessoa')
  await page.keyboard.press('e')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.cache/browser/three-motion-first.png' })
  await expect.poll(async () => Number(await hud.getByRole('meter', { name: 'Chefe: Alvo' }).getAttribute('aria-valuenow'))).toBeLessThan(100)
  await expect.poll(async () => Number(await hud.getByRole('meter', { name: 'Vida', exact: true }).getAttribute('aria-valuenow'))).toBeLessThan(100)
  await leaveGame(page)
  expect(await exportDoc()).toEqual(before)
  expect(errors).toEqual([])
})
