import { openAdvancedEditor, projectAction, leaveGame } from './threeHelpers.ts'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createEmptyScene, createNode, validateScene } from '../../apps/web/src/three/sceneDocument.ts'

async function open(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (/Shader Error|THREE.WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text()) })
  await page.addInitScript(() => {
    localStorage.setItem('modeler:workspace', 'three')
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'fixture' }))
  })
  await page.route('http://127.0.0.1:8011/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Cena Three.js interativa' })).toBeVisible()
  await openAdvancedEditor(page)
}
async function downloaded(page: Page, button: string) {
  const pending = page.waitForEvent('download')
  await projectAction(page, button)
  const download = await pending
  return { name: download.suggestedFilename(), data: await readFile((await download.path())!) }
}
const exported = async (page: Page) => JSON.parse((await downloaded(page, 'Exportar JSON')).data.toString('utf8'))
async function load(page: Page, value: unknown) {
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
}

function arena() {
  const floor = { ...createNode('box'), id: 'floor', name: 'Piso', position: [0, -0.1, 0] as [number, number, number], dimensions: [20, 0.2, 20] as [number, number, number] }
  const gem = { ...createNode('polyhedron'), id: 'gem', name: 'Cristal', position: [0, 1, -1] as [number, number, number], dimensions: [0.4, 0.6, 0.4] as [number, number, number], collidable: false,
    interaction: { trigger: 'proximity' as const, key: '', radius: 1.5, action: 'collect' as const, targetId: null, message: '' } }
  const hinge = { ...createNode('group'), id: 'hinge', name: 'Dobradiça', position: [-0.5, 0, -3] as [number, number, number],
    animation: { kind: 'keyframes' as const, axis: 'y' as const, duration: 0.6, amplitude: 0, phase: 0, start: 'trigger' as const, easing: 'smooth' as const,
      keys: [{ at: 0, move: [0, 0, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }, { at: 1, move: [0, 0, 0] as [number, number, number], turn: [0, -100, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }] } }
  const door = { ...createNode('box', hinge.id), id: 'door', name: 'Porta', position: [0.5, 1, 0] as [number, number, number], dimensions: [1, 2, 0.1] as [number, number, number],
    material: { ...createNode('box').material, color: '#c0392b' }, interaction: { trigger: 'click' as const, key: '', radius: 5, action: 'toggleAnimation' as const, targetId: hinge.id, message: '' } }
  const bell = { ...createNode('sphere'), id: 'bell', name: 'Sino', position: [6, 0.5, 6] as [number, number, number], interaction: { trigger: 'key' as const, key: '1', radius: 3, action: 'message' as const, targetId: null, message: 'Olá, explorador!' } }
  const doc = validateScene({ ...createEmptyScene(), name: 'Arena', nodes: [floor, gem, hinge, door, bell] })
  doc.environment = { ...doc.environment, sky: 'day', player: { spawn: [0, 0, 0], yaw: 0, speed: 4.5, jumpHeight: 1, mode: 'walk' } }
  return validateScene(doc)
}

test('the playable island renders with sky, lights and post-processing, and exports GLB and PNG', async ({ page }) => {
  // Full-window SwiftShader readback plus GLB export can exceed the generic 60 s budget.
  test.setTimeout(90_000)
  const errors: string[] = []
  await open(page, errors)
  await projectAction(page, 'Exemplo jogável')
  await expect(page.getByText('Ilha do Farol', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Estatísticas do renderer')).toContainText(/[1-9][\d.]* triângulos/)
  await page.screenshot({ path: '.cache/browser/three-island-editor.png' })
  const glb = await downloaded(page, 'Exportar GLB')
  expect(glb.name).toBe('ilha-do-farol.glb')
  expect(glb.data.subarray(0, 4).toString('latin1')).toBe('glTF')
  const json = JSON.parse(glb.data.subarray(20, 20 + glb.data.readUInt32LE(12)).toString('utf8'))
  expect(json.animations.length).toBeGreaterThan(1)
  expect(json.extensionsUsed).toContain('KHR_lights_punctual')
  const png = await downloaded(page, 'Capturar PNG')
  expect(png.data.subarray(1, 4).toString('latin1')).toBe('PNG')
  await page.getByRole('button', { name: '▶ Jogar', exact: true }).click()
  const hud = page.getByRole('region', { name: 'Modo jogo' })
  await expect(hud).toContainText('Itens 0/8')
  await page.keyboard.down('w')
  await page.waitForTimeout(700)
  await page.keyboard.up('w')
  await page.screenshot({ path: '.cache/browser/three-island-game.png' })
  await leaveGame(page)
  await expect(hud).toBeHidden()
  expect(errors).toEqual([])
})

test('play mode walks, collects, opens doors with E, fires key triggers and never mutates the document', async ({ page }) => {
  const errors: string[] = []
  await open(page, errors)
  const doc = arena()
  await load(page, doc)
  const original = await exported(page)
  await page.keyboard.press('p')
  const hud = page.getByRole('region', { name: 'Modo jogo' })
  await expect(hud.getByLabel('Itens coletados')).toHaveText('Itens 1/1')
  await expect(hud.getByRole('status')).toContainText('Cristal coletado · 1/1')
  await expect(hud).toContainText('Acionar · Porta')
  const canvas = page.getByRole('img', { name: 'Cena Three.js interativa' })
  const closed = await canvas.screenshot()
  await page.keyboard.press('e')
  await page.waitForTimeout(1200)
  expect((await canvas.screenshot()).equals(closed)).toBe(false)
  await page.keyboard.press('1')
  await expect(hud.getByRole('status')).toContainText('Olá, explorador!')
  const before = await canvas.screenshot()
  await page.keyboard.down('s')
  await page.waitForTimeout(600)
  await page.keyboard.up('s')
  expect((await canvas.screenshot()).equals(before)).toBe(false)
  await page.keyboard.press('f')
  await expect(hud).toContainText('Voo livre')
  await leaveGame(page)
  await expect(hud).toBeHidden()
  expect(await exported(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('editor shortcuts switch gizmos, nudge, delete, undo and open the shortcut reference', async ({ page }) => {
  const errors: string[] = []
  await open(page, errors)
  await projectAction(page, 'Cena vazia')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await page.getByRole('img', { name: 'Cena Three.js interativa' }).focus()
  await page.keyboard.press('e')
  await expect(page.getByRole('button', { name: 'Girar', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('r')
  await expect(page.getByRole('button', { name: 'Escalar', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('PageUp')
  const moved = await exported(page)
  expect(moved.nodes[0].position).toEqual([1, 0.6, 0])
  await page.getByRole('img', { name: 'Cena Three.js interativa' }).focus()
  await page.keyboard.press('Delete')
  expect((await exported(page)).nodes).toHaveLength(0)
  await page.keyboard.press('Control+z')
  expect((await exported(page)).nodes).toHaveLength(1)
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Atalhos de teclado' })).toContainText('Mover, girar ou escalar')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Atalhos de teclado' })).toBeHidden()
  await page.getByRole('combobox', { name: 'Tipo de objeto' }).selectOption('light')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await page.getByRole('combobox', { name: 'Tipo de luz' }).selectOption('spot')
  await page.getByRole('button', { name: 'Limpar seleção', exact: true }).click()
  await page.getByRole('combobox', { name: 'Céu e iluminação' }).selectOption('night')
  const bloom = page.getByRole('spinbutton', { name: 'Brilho (bloom)', exact: true })
  await bloom.fill('1.2')
  await bloom.press('Enter')
  const lit = await exported(page)
  expect(lit.nodes[1].light.type).toBe('spot')
  expect(lit.environment.sky).toBe('night')
  expect(lit.environment.bloom).toBe(1.2)
  await page.screenshot({ path: '.cache/browser/three-night-light.png' })
  expect(errors).toEqual([])
})

test('game systems: hazards hurt, third-person camera, enemies are defeated and the objective shows victory', async ({ page }) => {
  const errors: string[] = []
  await open(page, errors)
  const json = await page.evaluate(async () => {
    const { expandSceneRecipe } = await import('/src/three/sceneGeneration.ts')
    const single = { mode: 'linear', count: 1, offset: [0, 0, 0], radius: 0, axis: 'y' }
    const base = { parentId: null, rotation: [0, 0, 0], scale: [1, 1, 1], dimensions: [1, 1, 1], visible: true, color: '#cccccc', metalness: 0, roughness: 0.6, repeat: single }
    const prefab = (id: string, type: string, position: number[], size = 1) => ({ ...base, id, name: id, kind: 'group', position, prefab: { type, size, seed: 1, primary: null, secondary: null, text: '', lit: false, interactive: true } })
    return JSON.stringify(expandSceneRecipe({ name: 'Arena de teste', background: '#223344', exposure: 1, lightIntensity: 1.5, duration: 10,
      environment: { objective: { type: 'defeatEnemies', title: 'Derrote o slime', timeLimit: 0 }, player: { spawn: [0, 0, 0], yaw: 0, speed: 4, jumpHeight: 1, mode: 'walk', allowFly: false, health: 100, camera: 'first' } },
      nodes: [{ ...base, id: 'floor', name: 'Piso', kind: 'box', position: [0, -0.1, 0], dimensions: [40, 0.2, 40] }, prefab('spikes', 'spikes', [0, 0, 0]), prefab('slime', 'enemy', [0, 0, -1.2], 2)] }))
  })
  const doc = JSON.parse(json)
  await load(page, doc)
  await page.keyboard.press('p')
  const hud = page.getByRole('region', { name: 'Modo jogo' })
  await expect.poll(async () => Number(await hud.getByRole('meter', { name: 'Vida' }).getAttribute('aria-valuenow')), { timeout: 30000 }).toBeLessThan(100)
  await page.keyboard.press('v')
  await expect(hud).toContainText('3ª pessoa')
  await page.keyboard.press('v')
  await expect(hud).toContainText('Atacar', { timeout: 30000 })
  await page.keyboard.press('e')
  await expect(hud.getByLabel('Inimigos derrotados')).toHaveText('Inimigos 1/1')
  await expect(page.getByRole('dialog', { name: 'Vitória' })).toBeVisible()
  await page.getByRole('button', { name: 'Jogar de novo', exact: true }).click()
  await expect(hud.getByLabel('Inimigos derrotados')).toHaveText('Inimigos 0/1')
  await page.keyboard.press('f')
  await expect(hud.getByRole('status')).toContainText('voo está desativado')
  expect(errors).toEqual([])
})
