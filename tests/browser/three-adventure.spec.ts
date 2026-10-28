import { expect, test, type Page } from '@playwright/test'
import { createEmptyScene, createNode, validateScene } from '../../apps/web/src/three/sceneDocument.ts'
import { openAdvancedEditor, leaveGame } from './threeHelpers.ts'

async function open(page: Page, value: unknown) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('modeler:workspace', 'three'))
  await page.route('http://127.0.0.1:8011/api/**', route => route.fulfill({ status: 503, body: '{}' }))
  await page.goto('/')
  await openAdvancedEditor(page)
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'adventure.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
  await page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Modo jogo' })).toBeVisible()
  return errors
}

test('a player breaks scenery, crafts with the collected resources and finishes the mission', async ({ page }) => {
  const scene = validateScene({ ...createEmptyScene(), nodes: [
    { ...createNode('box'), id: 'floor', position: [0, -0.1, 0], dimensions: [20, 0.2, 20] },
    { ...createNode('box'), id: 'wood', name: 'Tronco para extração', position: [0, 1.1, -2.4], dimensions: [1, 2.2, 1], resource: { item: 'Madeira', amount: 3, health: 2 } },
    { ...createNode('box'), id: 'finish', position: [5, 0.5, 5], interaction: { trigger: 'key', key: '1', radius: 3, action: 'message', targetId: null, message: 'O sinal está pronto!' } },
  ], environment: { ...createEmptyScene().environment, sky: 'day', motion: { fauna: 'none', grass: 'none', wind: 0 }, shadows: false,
    player: { spawn: [0, 0, 0], yaw: 0, speed: 4.5, jumpHeight: 1, mode: 'walk', weapon: 'sword' },
    objective: { type: 'quests', title: '', timeLimit: 0 }, gameplay: { naturalResources: false, startingItems: [],
      recipes: [{ id: 'signal', name: 'Sinal', inputs: [{ item: 'Madeira', amount: 3 }], output: { item: 'Sinal', amount: 1 }, healing: 0 }],
      quests: [{ id: 'make', title: 'Prepare o sinal', giverId: null, rewards: [], steps: [{ kind: 'gather', target: 'Madeira', count: 3, label: 'Extraia madeira do tronco' }, { kind: 'craft', target: 'Sinal', count: 1, label: 'Fabrique o sinal com B' }] },
        { id: 'finish', title: 'Envie o sinal', giverId: null, rewards: [], steps: [{ kind: 'interact', target: 'finish', count: 1, label: 'Pressione 1 para enviar' }] }] } } })
  const errors = await open(page, scene), hud = page.getByRole('region', { name: 'Modo jogo' })
  await expect(hud).toContainText('Extrair')
  await page.keyboard.press('e')
  await expect(hud).toContainText('Extraia madeira do tronco · 3/3')
  await page.keyboard.press('b')
  const inventory = page.getByRole('dialog', { name: 'Inventário e fabricação' })
  await expect(inventory).toBeVisible()
  await expect(inventory.getByRole('button', { name: 'Fabricar Sinal', exact: true })).toBeEnabled()
  await inventory.getByRole('button', { name: 'Fabricar Sinal', exact: true }).click()
  await expect(inventory.locator('.three-inventory__items')).toContainText('Sinal')
  await expect(inventory.locator('.three-inventory__items')).not.toContainText('Madeira')
  await page.keyboard.press('Escape')
  await expect(inventory).toBeHidden()
  await expect(hud).toContainText('Envie o sinal')
  await page.keyboard.press('1')
  await expect(hud).toHaveAttribute('data-phase', 'won')
  await hud.getByRole('button', { name: 'Jogar de novo', exact: true }).click()
  await expect(hud).toHaveAttribute('data-phase', 'playing')
  await expect(hud).toContainText('Extrair')
  expect(errors).toEqual([])
})

test('water allows swimming and diving, consumes breath and recovers it at the surface', async ({ page }) => {
  const base = createEmptyScene(), scene = validateScene({ ...base, nodes: [
    { ...createNode('box'), id: 'bottom', position: [0, -3.1, 0], dimensions: [20, 0.2, 20] },
    { ...createNode('plane'), id: 'water', dimensions: [20, 0.01, 20], material: { ...createNode('plane').material, texture: 'water' } },
  ], environment: { ...base.environment, sky: 'day', shadows: false, motion: { fauna: 'none', grass: 'none', wind: 0 },
    player: { spawn: [0, -1.2, 0], yaw: 0, speed: 4.5, jumpHeight: 1, mode: 'walk' }, objective: { type: 'explore', title: '', timeLimit: 0 } } })
  const errors = await open(page, scene)
  await page.keyboard.down('c')
  const breath = page.getByRole('meter', { name: 'Fôlego' })
  await expect(breath).toBeVisible()
  await expect.poll(async () => Number(await breath.getAttribute('aria-valuenow'))).toBeLessThan(95)
  await page.keyboard.up('c')
  await page.keyboard.down('Space')
  await expect(breath).toBeHidden()
  await page.keyboard.up('Space')
  await leaveGame(page)
  expect(errors).toEqual([])
})
