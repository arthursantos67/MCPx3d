import { test, expect, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.addInitScript(() => { if (window.top === window) localStorage.setItem('modeler:cad-mechanics', 'concept') }) })
import { readFile } from 'node:fs/promises'

const zero = { x: 0, y: 0, z: 0 }
const program = (id: string, shape: 'box' | 'cylinder') => ({
  decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: id,
    steps: [{ id: 'body', op: 'base', shape, position: zero, rotation: zero,
      ...(shape === 'box' ? { width: 80, depth: 50, height: 10 } : { diameter: 12, height: 20 }) }],
  },
})

async function configureProvider(page: Page, responses: unknown[]) {
  await page.addInitScript(() => {
    if (window !== window.top) return
    localStorage.setItem('ai-web3d-modeler.provider-config.v1', JSON.stringify({
      mode: 'byok', baseUrl: 'http://provider.test/v1', apiKey: 'test-fixture', model: 'fixture-model',
    }))
  })
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    const next = responses.shift()
    if (!next) throw new Error('Unexpected provider request')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify(next) }, finish_reason: 'stop' }],
    }) })
  })
}

async function download(page: Page, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  const artifact = await pending
  const path = await artifact.path()
  expect(path).toBeTruthy()
  return { filename: artifact.suggestedFilename(), data: await readFile(path!) }
}

test('CAD preserves real threads, finishes, lofts and recessed holes through generation and export', async ({ page }) => {
  test.setTimeout(180_000)
  const spec = JSON.parse(await readFile('examples/cad/mechanical_mount.json', 'utf8'))
  const responses = [{ kind: 'part', reason: 'One connected threaded support' }, { decision: 'create', question: '', assumptions: [], spec }]
  await configureProvider(page, responses)
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Suporte com rosca M12, arredondamentos, chanfro, loft, rasgo e furos rebaixados')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled({ timeout: 120_000 })
  expect(responses).toHaveLength(0)
  await page.getByText('Editar construção · 7 operações', { exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Passo (mm)', exact: true })).toHaveValue('1.75')
  await expect(page.getByRole('combobox', { name: 'Perfil', exact: true })).toHaveValue('metric')
  await expect(page.getByRole('combobox', { name: 'Sentido', exact: true })).toHaveValue('right')
  await expect(page.getByRole('combobox', { name: 'Nova forma', exact: true }).locator('option')).toHaveCount(15)
  const step = await download(page, 'Baixar STEP')
  expect(step.data.toString()).toContain('ISO-10303-21')
  const stl = await download(page, 'Baixar STL')
  expect(stl.data.length).toBe(84 + stl.data.readUInt32LE(80) * 50)
  await expect(page.locator('.cad-mesh canvas')).toBeVisible()
  await expect(page.getByText('Atualizando a geometria da prévia…', { exact: true })).toHaveCount(0)
  await expect(page.locator('.cad-workspace__viewer [role="alert"]')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled()
  await expect(page.locator('.cad-workspace__footer')).toContainText('100.0 × 70.0 × 29.0 mm', { timeout: 120_000 })
  await expect(page.locator('.cad-workspace__viewer [role="alert"]')).toHaveCount(0)
  await page.screenshot({ path: '.cache/browser/cad-features.png' })
})

test('CAD connects shaft rotation to nut translation and keeps threaded components exportable', async ({ page }) => {
  test.setTimeout(240_000)
  const spec = JSON.parse(await readFile('examples/cad/threaded_drive.json', 'utf8'))
  const responses = [{ kind: 'assembly', reason: 'Threaded shaft and driven nut' },
    { decision: 'create', partId: spec.partId, question: '', assumptions: [], components: spec.components.map((component: typeof spec.components[number]) => ({
      id: component.id, action: 'build', description: `Build ${component.id}`, position: component.position,
      motion: component.motion ? { ...component.motion, pitch: 0 } : { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 },
    })) }, ...spec.components.map((component: typeof spec.components[number]) => ({ decision: 'create', question: '', assumptions: [],
      spec: { schemaVersion: '3.0', units: 'mm', partId: component.id, steps: component.steps },
    }))]
  await configureProvider(page, responses)
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Conjunto com fuso rosqueado e porca guiada acionados pelo mesmo controle')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto' })).toBeEnabled({ timeout: 120_000 })
  expect(responses).toHaveLength(0)
  await expect(page.locator('.cad-mesh__legend')).toContainText('shaft', { timeout: 120_000 })
  await expect(page.locator('.cad-mesh__legend')).toContainText('nut')
  await page.getByRole('slider').first().press('End')
  await expect(page.getByRole('slider').nth(1)).toHaveValue('2.3')
  await expect(page.getByText('Posição comandada: -414.00 °', { exact: true })).toBeVisible()
  await expect(page.getByText('Posição comandada: 2.30 mm', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  await expect(page.getByText('Revisão 1 salva com 3 corpos.', { exact: true })).toBeVisible({ timeout: 120_000 })
  const step = await download(page, 'STEP de nut')
  expect(step.filename).toBe('threaded_drive-nut-r1.step')
  await page.reload()
  await expect(page.getByRole('slider').first()).toHaveValue('2.3')
  await expect(page.getByRole('slider').nth(1)).toHaveValue('2.3')
  await expect(page.locator('.cad-mesh__legend')).toContainText('nut', { timeout: 120_000 })
  await expect(page.getByText('Atualizando a geometria da prévia…', { exact: true })).toHaveCount(0, { timeout: 120_000 })
  await expect(page.locator('.cad-workspace__viewer [role="alert"]')).toHaveCount(0)
})

test('CAD generates and saves a compound model, exports each format, edits and resumes it', async ({ page }) => {
  const responses = [
    { kind: 'assembly', reason: 'Independent support and sliding rod' },
    { decision: 'create', partId: 'sliding_support', question: '', assumptions: ['Dimensões em milímetros.'], components: [
      { id: 'support', action: 'build', description: 'A base measuring 80 by 50 by 10 mm.', position: zero,
        motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '' } },
      { id: 'rod', action: 'build', description: 'A cylinder of diameter 12 and height 20 mm.', position: { x: 0, y: 0, z: 30 },
        motion: { kind: 'slider', axis: 'z', minimum: 0, maximum: 10, value: 0, pitch: 0, group: '' } },
    ] },
    program('support', 'box'), program('rod', 'cylinder'),
  ]
  await configureProvider(page, responses)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const calls: string[] = []
  page.on('request', (request) => calls.push(request.url()))
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie um conjunto com suporte e uma haste móvel')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baixar STL do conjunto' })).toBeEnabled()
  expect(responses).toHaveLength(0)
  expect(calls.some((url) => url.includes('/api/projects'))).toBe(false)
  await expect(page.locator('.cad-mesh__legend')).toContainText('support')
  await expect(page.locator('.cad-mesh__legend')).toContainText('rod')

  const step = await download(page, 'Baixar STEP do conjunto')
  expect(step.filename).toBe('sliding_support-r0.step')
  expect(step.data.toString()).toContain('ISO-10303-21')
  const stl = await download(page, 'Baixar STL do conjunto')
  expect(stl.filename).toBe('sliding_support-r0.stl')
  expect(stl.data.length).toBe(84 + stl.data.readUInt32LE(80) * 50)
  const rod = await download(page, 'STEP de rod')
  expect(rod.filename).toBe('sliding_support-rod-r0.step')
  expect(rod.data.toString()).toContain('ISO-10303-21')

  await page.getByRole('slider').press('End')
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  await expect(page.getByText('Revisão 1 salva com 2 corpos.', { exact: true })).toBeVisible()
  await expect(page.getByText('Atualizando a geometria da prévia…', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '.cache/browser/cad-desktop.png' })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto' })).toBeVisible()
  await expect(page.getByRole('slider')).toHaveValue('10')
  expect(errors).toEqual([])
})

test('CAD repairs both overlapping motor covers with the real engine and exports four bodies', async ({ page }) => {
  const motor = JSON.parse(await readFile('tests/fixtures/cad_motor_overlap.json', 'utf8'))
  const responses = [
    { kind: 'assembly', reason: 'Four independent motor bodies' },
    { decision: 'create', partId: motor.partId, question: '', assumptions: [],
      components: motor.components.map((component: typeof motor.components[number]) => ({
        id: component.id, action: 'build', description: `Build component ${component.id}`,
        position: component.position, motion: { pitch: 0, group: '',
          ...(component.motion ?? { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0 }) },
      })) },
    ...motor.components.map((component: typeof motor.components[number]) => ({
      decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm',
        partId: component.id, steps: component.steps },
    })),
  ]
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await configureProvider(page, responses)
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie um motor com carcaça, duas tampas e rotor')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto' })).toBeEnabled()
  expect(responses).toHaveLength(0)
  const step = await download(page, 'Baixar STEP do conjunto')
  expect(step.data.toString()).toContain('ISO-10303-21')
  const stl = await download(page, 'Baixar STL do conjunto')
  expect(stl.data.length).toBe(84 + stl.data.readUInt32LE(80) * 50)
  const saved = await page.evaluate(() => localStorage.getItem('ai-web3d:cad-assembly'))
  const project = await page.request.get(`http://127.0.0.1:8011/api/cad/projects/${saved}`)
  const result = await project.json()
  expect(result.inspection.solidCount).toBe(4)
  expect(result.spec.components.map((item: { position: typeof zero }) => item.position.z)).toEqual([0, 64.5, -64.5, 0])
  expect(result.spec.components.map((item: { steps: unknown[] }) => item.steps)).toEqual(motor.components.map((item: { steps: unknown[] }) => item.steps))
  await page.getByRole('slider').press('End')
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  await expect(page.getByText('Revisão 1 salva com 4 corpos.', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('CAD saves a single part and preserves its last valid preview after a bad edit', async ({ page }) => {
  await configureProvider(page, [
    { kind: 'part', reason: 'One connected plate' }, program('base_plate', 'box'),
  ])
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie uma placa de 80 por 50 por 10 mm')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled()
  const step = await download(page, 'Baixar STEP')
  expect(step.data.toString()).toContain('ISO-10303-21')
  const stl = await download(page, 'Baixar STL')
  expect(stl.data.length).toBe(84 + stl.data.readUInt32LE(80) * 50)
  await expect(page.getByText('Atualizando a geometria da prévia…', { exact: true })).toHaveCount(0)
  await page.getByText('Editar construção · 1 operações', { exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Largura (mm)', exact: true }).fill('0')
  await expect(page.getByRole('alert')).toContainText('A prévia mantém a última geometria válida.')
  await expect(page.locator('.cad-mesh canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Salvar revisão', exact: true }).click()
  await expect(page.getByText('Invalid CAD dimensions', { exact: true })).toBeVisible()
  await expect(page.getByText('Rascunho · geometria disponível para exportação', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Baixar STEP', exact: true })).toBeEnabled()
})

test('X3D creates a validated scene and downloads it without an MCP server', async ({ page }) => {
  await configureProvider(page, [{ intent: 'create_model', operations: [
    { op: 'create_object', id: 'sphere', name: 'Esfera', kind: 'sphere', dimensions: { radius: 25 }, position: [0, 25, 0], color: '#087f8c' },
  ] }])
  await page.goto('/')
  await page.getByRole('button', { name: 'X3D Cenas 3D', exact: true }).click()
  await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Crie uma esfera de raio 25 mm')
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'X3D', exact: true })).toBeEnabled()
  const artifact = await download(page, 'X3D')
  expect(artifact.filename).toMatch(/\.x3d$/)
  expect(artifact.data.toString()).toContain('<Sphere radius="0.025"')
  expect(artifact.data.toString()).toContain('DEF="obj_sphere"')
  const html = await download(page, 'HTML')
  expect(html.data.toString()).toContain('<sphere')
  await expect(page.locator('.viewer-frame__iframe')).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(page.frameLocator('.viewer-frame__iframe').locator('canvas')).toBeVisible()
  await page.screenshot({ path: '.cache/browser/x3d-desktop.png' })
})

test('X3D creates a complex connected scene without extra model repairs and keeps its positions on edit', async ({ page }) => {
  const plan = JSON.parse(await readFile('tests/fixtures/x3d_industrial_cell.json', 'utf8'))
  const responses = [plan, { intent: 'modify_model', operations: [{ op: 'set_material', target: 'robo_braco', color: '#2469b2' }] }]
  await configureProvider(page, responses)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const payloads: { overlapPolicy: string; resolveOverlaps?: boolean }[] = []
  page.on('request', (request) => {
    if (/\/api\/projects\/[^/]+\/plans$/.test(request.url()) && request.method() === 'POST') payloads.push(request.postDataJSON())
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'X3D Cenas 3D', exact: true }).click()
  const policy = page.getByRole('checkbox', { name: 'Exigir separação entre todos os objetos' })
  await expect(policy).not.toBeChecked()
  await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Crie uma célula industrial com robô, esteira e seis caixas sem sobreposição entre as caixas')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'X3D', exact: true })).toBeEnabled()
  expect(responses).toHaveLength(1)
  expect(payloads).toHaveLength(1)
  expect(payloads[0].overlapPolicy).toBe('visual')
  expect(payloads[0].resolveOverlaps).toBeUndefined()
  const artifact = await download(page, 'X3D')
  expect(artifact.data.toString()).toContain('DEF="obj_robo_braco"')
  expect(artifact.data.toString()).toContain('DEF="obj_esteira_cilindro_1"')
  await expect(page.frameLocator('.viewer-frame__iframe').locator('canvas')).toBeVisible()
  const manifest = JSON.parse((await download(page, 'JSON')).data.toString())
  const originalPositions = Object.fromEntries(plan.operations.filter((op: { op: string }) => op.op === 'create_object')
    .map((op: { id: string; position: number[] }) => [op.id, op.position]))
  expect(manifest.objects).toHaveLength(59)
  expect(Object.fromEntries(manifest.objects.map((obj: { id: string; transform: { position: number[] } }) => [obj.id, obj.transform.position]))).toEqual(originalPositions)
  await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Mude o braço do robô para azul')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Modelo atualizado para a revisão 2', { exact: false })).toBeVisible()
  expect(responses).toHaveLength(0)
  expect(payloads).toHaveLength(2)
  const edited = JSON.parse((await download(page, 'JSON')).data.toString())
  expect(Object.fromEntries(edited.objects.map((obj: { id: string; transform: { position: number[] } }) => [obj.id, obj.transform.position]))).toEqual(originalPositions)
  expect(edited.objects.find((obj: { id: string }) => obj.id === 'robo_braco').material.color).toBe('#2469b2')
  await expect(page.frameLocator('.viewer-frame__iframe').locator('transform[def="obj_robo_braco"] material'))
    .toHaveAttribute('diffusecolor', /0\.1411/)
  await expect(page.frameLocator('.viewer-frame__iframe').locator('canvas')).toBeVisible()
  await page.screenshot({ path: '.cache/browser/x3d-industrial.png' })
  expect(errors).toEqual([])
})

test('eight-body CAD resumes after repeated quota and a model change without rebuilding completed bodies', async ({ page }) => {
  const components = Array.from({ length: 8 }, (_, index) => ({ id: `body_${index + 1}`, action: 'build',
    description: 'Box 80 by 50 by 10 mm, centered at local origin.', position: { ...zero, z: index * 30 },
    motion: { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '' } }))
  const quota = { error: { status: 'RESOURCE_EXHAUSTED', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
  ] } }
  const responses = [
    { kind: 'assembly', reason: 'eight independent bodies' },
    { decision: 'create', partId: 'quota_resume_8', question: '', assumptions: [], components },
    ...components.slice(0, 5).map((component) => program(component.id, 'box')),
    quota, quota,
    ...components.slice(5).map((component) => program(component.id, 'box')),
  ]
  await configureProvider(page, [])
  await page.unroute('http://provider.test/v1/chat/completions')
  const modelCalls: string[] = []
  await page.route('http://provider.test/v1/chat/completions', async (route) => {
    modelCalls.push(route.request().postDataJSON().model)
    const response = responses.shift()
    if (!response) throw new Error('Unexpected provider request')
    await route.fulfill({ status: 'error' in response ? 429 : 200, contentType: 'application/json',
      body: JSON.stringify('error' in response ? response : { choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }] }) })
  })
  const checkedParts: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/cad/programs/inspect')) checkedParts.push(request.postDataJSON().partId)
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Describe CAD part' }).fill('Crie oito corpos independentes, separados por 30 mm em Z.')
  await page.getByRole('button', { name: 'Criar com IA', exact: true }).click()
  const progress = page.getByRole('region', { name: 'Progresso da geração CAD' })
  await expect(progress.getByText('Geração pausada', { exact: true })).toBeVisible()
  await expect(progress.getByText(/5 de 8 componentes concluídos/)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /quota.*esgotada/ }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Retomar geração', exact: true }).click()
  await expect(progress.getByText('Geração pausada', { exact: true })).toBeVisible()
  expect(modelCalls).toHaveLength(9)
  await page.getByRole('button', { name: 'Trocar modelo ou provedor', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Configurações da IA' })
  await dialog.getByRole('textbox', { name: 'Modelo', exact: true }).fill('replacement-model')
  let navigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++ })
  await dialog.getByRole('button', { name: 'Salvar e aplicar', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('IA pronta', { exact: true })).toBeVisible()
  await expect(progress.getByText(/5 de 8 componentes concluídos/)).toBeVisible()
  await page.getByRole('button', { name: 'Retomar geração', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar STEP do conjunto' })).toBeVisible()
  expect(navigations).toBe(0)
  expect(responses).toHaveLength(0)
  expect(modelCalls.slice(9)).toEqual(Array(3).fill('replacement-model'))
  expect(checkedParts).toEqual(components.map((component) => component.id))
  expect((await download(page, 'Baixar STEP do conjunto')).data.toString()).toContain('ISO-10303-21')
  const stl = (await download(page, 'Baixar STL do conjunto')).data
  expect(stl.length).toBe(84 + stl.readUInt32LE(80) * 50)
  expect(errors).toEqual([])
})

test('mobile workspace fits the viewport and opens AI settings', async ({ page }) => {
  await configureProvider(page, [])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Da ideia ao modelo' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Configurar IA', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: 'Configurações da IA' })).toBeVisible()
  await page.screenshot({ path: '.cache/browser/mobile.png' })
})
