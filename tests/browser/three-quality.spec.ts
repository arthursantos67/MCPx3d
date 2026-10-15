import { openAdvancedEditor, projectAction } from './threeHelpers.ts'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createEmptyScene, createNode, validateScene } from '../../apps/web/src/three/sceneDocument.ts'
import { staticGlb } from '../fixtures/staticGlb.ts'

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('modeler:workspace', 'three')
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'fixture', model: 'fixture' }))
  })
  await page.route('http://127.0.0.1:8011/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"offline"}' }))
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Cena Three.js interativa' })).toBeVisible()
  await openAdvancedEditor(page)
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download')
  await projectAction(page, 'Exportar JSON')
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'))
}
async function load(page: Page, value: unknown) {
  await page.getByLabel('Importar projeto Three.js').setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
}

test('detailed procedural scene renders in fullscreen and Escape exits the expansion fallback', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (/Shader Error|THREE.WebGLProgram/.test(message.text())) errors.push(message.text()) })
  await open(page)
  await projectAction(page, 'Exemplo detalhado')
  await expect(page.getByText('Observatório Helix', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sair da tela cheia', exact: true })).toBeVisible()
  const bounds = (await page.locator('.three-stage').boundingBox())!
  expect(Math.round(bounds.width)).toBe(1440)
  expect(Math.round(bounds.height)).toBe(900)
  await expect(page.getByRole('group', { name: 'Reprodução em tela cheia' })).toBeVisible()
  await page.getByRole('button', { name: 'Enquadrar cena', exact: true }).click()
  await page.screenshot({ path: '.cache/browser/three-helix-fullscreen.png' })
  await page.getByRole('button', { name: 'Sair da tela cheia', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Tela cheia', exact: true })).toBeVisible()
  await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = async () => { throw new Error('Denied in embedded browser') } })
  await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
  await expect(page.locator('.three-stage')).toHaveClass(/fullscreen/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.three-stage')).not.toHaveClass(/fullscreen/)
  expect(errors).toEqual([])
})

test('existing scenes are inspected, repaired locally without AI and enriched with contextual patches', async ({ page }) => {
  await open(page)
  const a = { ...createNode('box'), id: 'a', name: 'Carcaça' }, b = { ...createNode('box'), id: 'b', name: 'Módulo', position: [0.25, 0.5, 0] as [number, number, number] }
  const untouched = { ...createNode('lathe'), id: 'ornament', position: [5, 0.5, 0] as [number, number, number] }
  const doc = validateScene({ ...createEmptyScene(), nodes: [a, b, untouched] })
  await load(page, doc)
  await projectAction(page, 'Verificar cena')
  await expect(page.locator('.three-spatial summary')).toContainText('1 pares')
  await expect(page.locator('details.three-spatial')).toContainText('Superfícies se cruzam')
  let calls = 0
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    calls++
    const request = route.request().postDataJSON()
    expect(JSON.stringify(request.messages)).toContain('CENA E DIAGNÓSTICO')
    const content = { updates: [{ id: 'a', changes: { kind: 'roundedBox', geometry: { bevel: 0.1 }, material: { clearcoat: 0.8, texture: 'metal' } } }], additions: [] }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }) })
  })
  await page.getByRole('button', { name: 'Preparar Corrigir cena com IA', exact: true }).click()
  await page.getByRole('button', { name: 'Corrigir cena', exact: true }).click()
  await expect(page.getByText('Cena concluída', { exact: true })).toBeVisible()
  const repaired = await exported(page)
  expect(repaired.nodes.map((node: { id: string }) => node.id)).toEqual(['a', 'b', 'ornament'])
  expect([repaired.nodes[0].position, repaired.nodes[1].position]).not.toEqual([doc.nodes[0].position, doc.nodes[1].position])
  expect(calls).toBe(0)
  expect(repaired.nodes[2]).toEqual(doc.nodes[2])
  await expect(page.locator('.three-spatial summary')).toContainText('0 pares')
  await expect(page.locator('.three-spatial summary')).not.toContainText('desatualizado')
  await page.getByRole('combobox', { name: 'Ação da IA', exact: true }).selectOption('edit')
  await page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true }).fill('Arredonde a carcaça e aplique metal escovado com verniz, preservando os demais objetos.')
  await page.getByRole('button', { name: 'Editar cena com IA', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Descreva a cena Three.js', exact: true })).toHaveValue('')
  const edited = await exported(page)
  expect(edited.nodes[0].kind).toBe('roundedBox')
  expect(edited.nodes[0].material.texture).toBe('metal')
  expect(edited.nodes[0].material.clearcoat).toBe(0.8)
  expect(edited.nodes[2]).toEqual(doc.nodes[2])
  expect(calls).toBe(1)
})

test('GLB imports real indexed geometry, preserves it in JSON and refuses unsupported input', async ({ page }) => {
  await open(page)
  await projectAction(page, 'Cena vazia')
  await page.getByLabel('Importar modelo GLB').setInputFiles({ name: 'Cabine.glb', mimeType: 'model/gltf-binary', buffer: staticGlb() })
  await expect(page.getByText('Modelo GLB importado como malhas editáveis.', { exact: true })).toBeVisible()
  const doc = await exported(page)
  expect(doc.version).toBe('1.2')
  expect(doc.nodes).toHaveLength(2)
  const mesh = doc.nodes.find((node: { kind: string }) => node.kind === 'mesh')
  expect(mesh.geometry.vertices).toHaveLength(12)
  expect(mesh.geometry.indices).toHaveLength(12)
  expect(mesh.material.metalness).toBe(0.8)
  expect(mesh.material.opacity).toBe(0.65)
  expect(mesh.material.transparent).toBe(true)
  expect(mesh.material.doubleSided).toBe(true)
  await page.reload()
  expect(await exported(page)).toEqual(doc)
  await page.getByLabel('Importar modelo GLB').setInputFiles({ name: 'Animated.glb', mimeType: 'model/gltf-binary', buffer: staticGlb({ animated: true }) })
  await expect(page.getByRole('alert').filter({ hasText: 'GLB estático' })).toBeVisible()
  expect(await exported(page)).toEqual(doc)
  await page.getByLabel('Importar modelo GLB').setInputFiles({ name: 'External.glb', mimeType: 'model/gltf-binary', buffer: staticGlb({ external: true }) })
  await expect(page.getByRole('alert').filter({ hasText: 'referências externas' })).toBeVisible()
  expect(await exported(page)).toEqual(doc)
})

test('Verificar cena audits the scene and the automatic fix resolves it without AI', async ({ page }) => {
  await open(page)
  let calls = 0
  await page.route('http://provider.test/v1/chat/completions', async (route) => { calls++; await route.abort() })
  const a = { ...createNode('box'), id: 'a', name: 'Bloco A' }, b = { ...createNode('box'), id: 'b', name: 'Bloco B', position: [0.3, 0.5, 0] as [number, number, number] }
  await load(page, validateScene({ ...createEmptyScene(), nodes: [a, b] }))
  await projectAction(page, 'Verificar cena')
  await expect(page.locator('.three-spatial summary')).toContainText('1 pares')
  await page.getByRole('button', { name: 'Corrigir automaticamente (sem IA)', exact: true }).click()
  await expect(page.locator('.three-spatial summary')).toContainText('0 pares')
  await expect(page.locator('.three-generation-notes')).toContainText('Correção automática')
  await expect(page.locator('.three-generation-notes')).toContainText('Nenhum problema restante')
  expect(calls).toBe(0)
  await projectAction(page, 'Desfazer')
  expect((await exported(page)).nodes[1].position).toEqual([0.3, 0.5, 0])
})
