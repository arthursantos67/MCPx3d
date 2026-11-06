import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { compileCadDesign, newCadDesign } from '../../packages/domain/ts/src/cad-parametric.ts'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({
      mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'test-fixture', model: 'unused',
    }))
  })
  await page.route('http://provider.test/**', () => { throw new Error('The parametric workbench must not call AI') })
  await page.goto('/')
  await page.getByRole('button', { name: 'Peças paramétricas', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Medidas que constroem' })).toBeVisible()
})

async function applyAndSave(page: Page) {
  await page.getByRole('button', { name: 'Aplicar medidas', exact: true }).click()
  const response = page.waitForResponse((response) => /\/api\/cad\/projects(?:\/[^/]+\/spec)?$/.test(response.url()) && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Validar e salvar', exact: true }).click()
  const saved = await (await response).json()
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: 'medidas e volume conferidos' })).toBeVisible()
  await expect(page.getByText('Atualizando a geometria da prévia…', { exact: true })).toHaveCount(0)
  await expect(page.locator('.cad-workspace__viewer [role="alert"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Superior', exact: true })).toBeVisible()
  return saved
}

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const result = await pending
  return { filename: result.suggestedFilename(), bytes: await readFile((await result.path())!) }
}

test('parametric plate produces real STEP/STL, blocks invalid dimensions and retains saved geometry', async ({ page }) => {
  test.setTimeout(120_000)
  await page.getByRole('spinbutton', { name: 'Largura X (mm)', exact: true }).fill('120')
  const saved = await applyAndSave(page)
  expect(saved.inspection.boundsMm).toEqual([120, 60, 6])
  const expected = compileCadDesign({ ...newCadDesign('plate'), parameters: { ...newCadDesign('plate').parameters, width: 120 } })
  expect(saved.inspection.volumeMm3).toBeCloseTo(expected.expectedVolumeMm3, 4)
  const step = await download(page, 'Baixar STEP')
  expect(step.bytes.toString()).toContain('ISO-10303-21')
  const stl = await download(page, 'Baixar STL')
  expect(stl.bytes.length).toBe(84 + stl.bytes.readUInt32LE(80) * 50)
  await page.getByRole('spinbutton', { name: 'Largura X (mm)', exact: true }).fill('15')
  await expect(page.getByRole('alert').filter({ hasText: 'A largura precisa separar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aplicar medidas', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Validar e salvar', exact: true })).toBeDisabled()
  const persisted = await page.request.get(`http://127.0.0.1:8011/api/cad/projects/${saved.projectId}`)
  expect((await persisted.json()).revision).toBe(0)
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: 'Largura X (mm)', exact: true })).toHaveValue('120')
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled()
  await expect(page.getByText('Atualizando a geometria da prévia…', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Superior', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Superior', exact: true }).click()
  await expect(page.locator('.cad-workspace__viewer [role="alert"]')).toHaveCount(0)
  await page.screenshot({ path: '.cache/browser/cad-parametric-plate.png' })
})

test('all remaining families validate without AI and dimensional edits create a revision', async ({ page }) => {
  test.setTimeout(180_000)
  for (const kind of ['bracket', 'flange', 'enclosure', 'spacer'] as const) {
    await page.getByRole('combobox', { name: 'Família de peça' }).selectOption(kind)
    const saved = await applyAndSave(page)
    const expected = compileCadDesign(newCadDesign(kind))
    expect(saved.inspection.solidCount).toBe(1)
    saved.inspection.boundsMm.forEach((value: number, axis: number) => expect(value).toBeCloseTo(expected.expectedBoundsMm[axis], 5))
    expect(saved.inspection.volumeMm3).toBeCloseTo(expected.expectedVolumeMm3, 4)
  }
  await page.getByRole('spinbutton', { name: 'Altura Z (mm)' }).fill('32')
  const edited = await applyAndSave(page)
  expect(edited.revision).toBe(1)
  expect(edited.inspection.boundsMm).toEqual([24, 24, 32])
  await page.getByRole('button', { name: 'Projeto livre', exact: true }).click()
  await page.getByText('Editar construção · 1 operações', { exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Comprimento Z (mm)', exact: true })).toHaveValue('32')
})

test('source JSON preserves relationships across export, import and reapplication', async ({ page }) => {
  test.setTimeout(120_000)
  await page.getByRole('combobox', { name: 'Família de peça' }).selectOption('flange')
  await page.getByRole('spinbutton', { name: 'Quantidade de furos' }).fill('8')
  await page.getByText('Guardar e reabrir medidas', { exact: true }).click()
  const exported = await download(page, 'Baixar projeto paramétrico')
  const source = JSON.parse(exported.bytes.toString())
  expect(source.parameters.holeCount).toBe(8)
  await page.getByRole('combobox', { name: 'Família de peça' }).selectOption('plate')
  await page.locator('.cad-parametric input[type="file"]').setInputFiles({ name: 'flange.parametric.json', mimeType: 'application/json', buffer: exported.bytes })
  await expect(page.getByRole('spinbutton', { name: 'Quantidade de furos' })).toHaveValue('8')
  const saved = await applyAndSave(page)
  expect(saved.spec.steps.find((step: { id: string }) => step.id === 'bolt_circle').pattern.count).toBe(8)
  await page.locator('.cad-parametric input[type="file"]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}') })
  await expect(page.getByRole('status').filter({ hasText: 'Formato ou família paramétrica inválida' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Família de peça' })).toHaveValue('flange')
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled()
})
