import { test, expect, type Page } from '@playwright/test'
import { createEmptyScene, createNode, validateScene, type ThreeSceneDocument } from '../../apps/web/src/three/sceneDocument.ts'

const base = (): ThreeSceneDocument => validateScene({ ...createEmptyScene(), name: 'Oficina do viajante', nodes: [{ ...createNode('box'), dimensions: [20, 0.2, 20], position: [0, -0.1, 0] }], environment: { ...createEmptyScene().environment, shadows: false, reflections: false, motion: { grass: 'none', fauna: 'none', wind: 0 }, player: { spawn: [0, 0, 0], yaw: 0, speed: 4.5, jumpHeight: 1, mode: 'walk', weapon: 'none' } } })
async function open(page: Page, scene: ThreeSceneDocument) {
  await page.addInitScript(doc => { localStorage.setItem('modeler:workspace', 'three'); localStorage.setItem('modeler:three-scene:v1', JSON.stringify(doc)); HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error('Use drag look')) }, scene)
  await page.route('http://127.0.0.1:8011/api/**', route => route.fulfill({ status: 503, body: '{}' }))
  await page.goto('/')
  await page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Modo jogo' })).toBeVisible()
}
test('an item-free game has no inventory even with the full HUD', async ({ page }) => {
  await open(page, base())
  await expect(page.getByRole('button', { name: 'Inventário · B', exact: true })).toHaveCount(0)
  await page.keyboard.press('b')
  await expect(page.getByRole('dialog', { name: /Inventário/ })).toHaveCount(0)
})
test('collection-only inventory shows belongings without survival or crafting controls', async ({ page }) => {
  const scene = base()
  scene.environment.gameplay = { naturalResources: false, recipes: [], quests: [], startingItems: [{ item: 'Chave azul', amount: 1 }] }
  await open(page, validateScene(scene))
  await page.keyboard.press('b')
  const inventory = page.getByRole('dialog', { name: 'Inventário', exact: true })
  await expect(inventory.getByRole('button', { name: 'Mochila: Chave azul, 1' })).toBeVisible()
  await expect(inventory.getByRole('tablist')).toHaveCount(0)
  await expect(inventory.getByText(/Árvores dão|Bancada de fabricação|Combinar/)).toHaveCount(0)
})
test('dragging ingredients and the output crafts once, preserves quantities and equips the chosen slot', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const scene = base()
  scene.environment.gameplay = { naturalResources: false, quests: [], startingItems: [{ item: 'Madeira', amount: 8 }, { item: 'Pedra', amount: 4 }], items: [{ name: 'Machado de pedra', description: 'Um machado resistente para a estrada.', equipment: 'axe' }], recipes: [{ id: 'axe', name: 'Machado de pedra', inputs: [{ item: 'Madeira', amount: 3 }, { item: 'Pedra', amount: 2 }], output: { item: 'Machado de pedra', amount: 1 }, healing: 0 }] }
  await open(page, validateScene(scene)); await page.keyboard.press('b')
  const inventory = page.getByRole('dialog', { name: 'Inventário e fabricação' })
  await inventory.getByRole('button', { name: 'Mochila: Madeira, 8', exact: true }).dragTo(inventory.getByRole('button', { name: 'Bancada 1: vazio', exact: true }))
  await inventory.getByRole('button', { name: 'Mochila: Pedra, 4', exact: true }).dragTo(inventory.getByRole('button', { name: 'Bancada 2: vazio', exact: true }))
  const output = inventory.getByRole('button', { name: 'Retirar resultado: Machado de pedra', exact: true })
  await expect(output).toBeEnabled()
  await page.screenshot({ path: '.cache/browser/three-inventory-workbench.png' })
  await output.dragTo(inventory.getByRole('button', { name: 'Atalho 3: Vazio', exact: true }))
  await expect(inventory.getByRole('button', { name: 'Atalho 3: Machado de pedra', exact: true })).toBeVisible()
  await expect(inventory.getByRole('button', { name: 'Mochila: Machado de pedra, 1', exact: true })).toBeVisible()
  await expect(inventory.getByRole('button', { name: 'Bancada 1: Madeira, 5', exact: true })).toBeVisible()
  await expect(inventory.getByRole('button', { name: 'Bancada 2: Pedra, 2', exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); await page.keyboard.press('b')
  await expect(inventory.getByRole('button', { name: 'Mochila: Madeira, 5', exact: true })).toBeVisible()
  await expect(inventory.getByRole('button', { name: 'Mochila: Pedra, 2', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
