import { test, expect } from '@playwright/test'
import { readFileSync, statSync } from 'node:fs'

const zero = { x: 0, y: 0, z: 0 }
const localFinish = { schemaVersion: '3.0', units: 'mm', partId: 'local_finish_ui', steps: [
  { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 40, depth: 30, height: 12 },
  { id: 'edge', op: 'modify', shape: 'chamfer', position: zero, rotation: zero, distance: 1, selector: 'parallel_z',
    selectionBox: { min: { x: 19, y: 14, z: -1 }, max: { x: 21, y: 16, z: 1 } } },
] }
const cases = ['helical_spring', 'pipe_bend', 'sweep'].map((shape) => ({
  shape, spec: JSON.parse(readFileSync(`examples/cad/${shape}.json`, 'utf8')),
}))
cases.push({ shape: 'chamfer', spec: localFinish })

for (const { shape, spec } of cases) test(`${shape} edits survive native validation, reload and STEP download`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({ mode: 'cli', client: 'codex', model: 'fixture-model' })))
  await page.route('**/api/ai/local/status/codex', (route) => route.fulfill({ json: { installed: true, authenticated: true, message: 'ready' } }))
  const responses = [{ kind: 'part', reason: 'One solid' }, { decision: 'create', spec, question: '', assumptions: [] }]
  await page.route('**/api/ai/local/generate', async (route) => {
    expect(responses.length).toBeGreaterThan(0)
    await route.fulfill({ json: { content: JSON.stringify(responses.shift()), finishReason: 'stop' } })
  })
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie uma peça conforme as dimensões fornecidas')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  const download = page.getByRole('button', { name: 'Baixar STEP', exact: true })
  await expect(download).toBeEnabled()
  const openEditor = () => page.getByText(`Editar construção · ${spec.steps.length} operações`, { exact: true }).click()
  await openEditor()
  const edited = shape === 'helical_spring' ? page.getByRole('spinbutton', { name: 'Voltas', exact: true })
    : shape === 'pipe_bend' ? page.getByRole('spinbutton', { name: 'Ângulo da curva (°)', exact: true })
    : shape === 'sweep' ? page.getByRole('spinbutton', { name: 'Ponto 1 · X (mm)', exact: true })
    : page.getByRole('spinbutton', { name: 'Distância (mm)', exact: true })
  const value = shape === 'helical_spring' ? '3.5' : shape === 'pipe_bend' ? '135' : shape === 'sweep' ? '-1' : '0.5'
  if (shape === 'chamfer') await expect(page.getByRole('checkbox', { name: 'Limitar seleção por região' })).toBeChecked()
  await edited.fill(value)
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  await expect(download).toBeEnabled()
  const pending = page.waitForEvent('download')
  await download.click()
  const file = await pending
  expect(file.suggestedFilename()).toContain('.step')
  expect(statSync((await file.path())!).size).toBeGreaterThan(100)
  await page.reload()
  await expect(download).toBeEnabled()
  await openEditor()
  await expect(edited).toHaveValue(value)
  if (shape === 'chamfer') {
    await expect(page.getByRole('checkbox', { name: 'Limitar seleção por região' })).toBeChecked()
    await expect(page.getByRole('spinbutton', { name: 'Mínimo X (mm)', exact: true })).toHaveValue('19')
  }
  expect(responses).toHaveLength(0)
})
