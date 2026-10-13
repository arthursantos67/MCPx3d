import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { LocalCliProvider } from '../packages/agent/src/local-cli-provider.ts'
import { CadAgentController } from '../apps/web/src/cad/CadAgentController.ts'
import { readAssemblyIssue } from '../packages/domain/ts/src/cad-assembly-diagnostics.ts'
import { evaluateCadRequirements, summarizeCadBenchmark } from './cad-benchmark-metrics.mjs'
import { cadIdentity } from '../packages/agent/src/cad-identity.ts'

if (!process.argv.includes('--run')) {
  console.log('Uses your authenticated subscription and native CAD workers. Two smoke cases by default; --suite runs the requirement corpus; --repeat N repeats selected cases; --case ID selects one suite case. Run: node scripts/benchmark-cad.mjs --run --suite')
  process.exit(0)
}
if (process.argv.includes('--suite') && (process.argv.includes('--complex') || process.argv.includes('--resume'))) throw new Error('--suite cannot be combined with --complex/--resume')
const repeatIndex = process.argv.indexOf('--repeat')
const repetitions = repeatIndex < 0 ? 1 : Number(process.argv[repeatIndex + 1])
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100 || process.argv.includes('--resume') && repetitions !== 1) throw new Error('--repeat must be 1–100, or 1 when resuming')
if (process.argv.includes('--resume') && !process.argv.includes('--complex')) {
  console.error('--resume requires --complex to resume the saved eight-body case.')
  process.exit(1)
}
const base = process.env.CAD_BENCHMARK_API ?? 'http://127.0.0.1:8001'
const output = resolve(process.env.CAD_BENCHMARK_OUTPUT ?? '.cache/cad-quality-live')
await mkdir(output, { recursive: true })
const provider = new LocalCliProvider({ apiBaseUrl: base, client: 'codex', model: process.env.CAD_BENCHMARK_MODEL ?? '' })
await provider.initialize()
const inspections = new Map()
async function inspect(path, spec, signal, assembly = false) {
  const response = await fetch(`${base}/api/cad/${path}/inspect`, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) })
  if (response.ok) {
    inspections.set(cadIdentity(spec), await response.json())
    return null
  }
  const failure = await response.json()
  if (['CAD_GEOMETRY_INVALID', 'CAD_MECHANICS_INVALID', 'INVALID_CAD_REQUEST'].includes(failure.code))
    return assembly ? readAssemblyIssue(failure.message, failure.details) ?? failure.message : failure.message
  throw new Error(`${failure.code}: ${failure.message}`)
}
const simpleCases = [
  { id: 'socket-head-plate', assembly: false,
    request: 'Crie uma placa de montagem usinável com quatro furos passantes para parafusos M5 de cabeça cilíndrica Allen. As cabeças devem ficar alojadas abaixo da face superior. Escolha dimensões úteis, preserve parede e fundo sob os rebaixos e não adicione acabamentos cosméticos.' },
  { id: 'three-body-support', assembly: true,
    request: 'Crie um conjunto funcional com exatamente três peças para apoiar um eixo liso estacionário entre dois suportes separados. O eixo deve engatar pelo menos 12 mm em cada suporte, com parede ao redor dos furos. Fixe o eixo por adesivo nos furos e declare a premissa de montagem. Escolha dimensões proporcionais e úteis, ancore um suporte, não adicione acabamentos cosméticos.' },
]
const suite = process.argv.includes('--suite') ? JSON.parse(await readFile(resolve('tests/golden/cad-benchmark-prompts.json'), 'utf8')) : simpleCases
const selected = process.argv.includes('--complex') ? [{ id: 'eight-body-threaded-actuator', assembly: true,
  request: 'Crie um atuador linear funcional com exatamente oito peças, acionado por um volante manual e fuso com rosca trapezoidal real. Decida a decomposição no planejamento. O carro deve mover-se sem girar, o fuso deve permanecer retido axialmente, todos os corpos devem estar ligados fisicamente e o curso útil deve ser de pelo menos 20 mm. Escolha dimensões usináveis, verifique engate e paredes em todo o curso, inclua alojamentos para cabeças de parafusos quando necessários e declare ferragens/adesivos exigidos. Evite acabamentos cosméticos e preserve os recursos funcionais.' }] : suite
const caseIndex = process.argv.indexOf('--case')
const requestedIds = caseIndex < 0 ? null : process.argv[caseIndex + 1]?.split(',')
if (caseIndex >= 0 && (!requestedIds?.length || requestedIds.some((id) => !selected.some((item) => item.id === id)))) throw new Error('Unknown --case ID')
const filtered = requestedIds ? selected.filter((item) => requestedIds.includes(item.id)) : selected
if (!filtered.length) throw new Error('Unknown --case ID')
const cases = Array.from({ length: repetitions }, (_, index) => filtered.map((item) => ({ ...item, caseId: item.id, trial: index + 1,
  id: repetitions === 1 ? item.id : `${item.id}-trial-${index + 1}` }))).flat()
const report = { timestamp: new Date().toISOString(), provider: provider.id, model: provider.model, cases: [] }
const reportName = process.argv.includes('--suite') ? 'report-suite.json' : process.argv.includes('--resume') ? 'report-complex-resume.json' : process.argv.includes('--complex') ? 'report-complex.json' : 'report.json'
for (const item of cases) {
  inspections.clear()
  let latestDraft = null, stats = null
  const controller = new CadAgentController(provider, {
    checkCadProgram: (spec, signal) => inspect('programs', spec, signal),
    checkCadAssembly: (spec, signal) => inspect('assemblies', spec, signal, true),
  })
  controller.setDraftListener((draft) => { latestDraft = draft })
  controller.setStatsListener((current) => { stats = current })
  const started = performance.now()
  const result = { id: item.id, caseId: item.caseId, trial: item.trial, status: 'failed', stats: null, durationMs: 0, draftZipBytes: 0, requirementIssues: [] }
  console.log(`Starting ${item.id}`)
  try {
    const previous = process.argv.includes('--resume')
      ? JSON.parse(await readFile(resolve(output, `${item.id}-draft.json`), 'utf8')).spec : undefined
    if (previous && previous.components?.length < 8) delete previous.mechanics
    const outcome = item.assembly
      ? await controller.planCadAssembly(item.request, previous, (progress) => console.log(`${item.id}: ${progress.phase} ${progress.completed}/${progress.components.length}`), true)
      : await controller.planCadProgram(item.request)
    if (outcome.kind !== 'create') throw new Error('The model did not create a design')
    await writeFile(resolve(output, `${item.id}.json`), JSON.stringify(outcome.spec, null, 2))
    result.status = 'validated'
    result.inspection = inspections.get(cadIdentity(outcome.spec))
    result.requirementIssues = evaluateCadRequirements(outcome.spec, item.expectations, result.inspection)
    latestDraft = { spec: outcome.spec, request: item.request }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    console.log(`${item.id}: ${result.error}`)
  }
  result.stats = stats
  result.durationMs = Math.round(performance.now() - started)
  if (latestDraft) {
    await writeFile(resolve(output, `${item.id}-draft.json`), JSON.stringify(latestDraft, null, 2))
    const response = await fetch(`${base}/api/cad/drafts/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(latestDraft) })
    if (response.ok) {
      const bundle = new Uint8Array(await response.arrayBuffer())
      await writeFile(resolve(output, `${item.id}.zip`), bundle)
      result.draftZipBytes = bundle.length
    } else result.exportError = (await response.json()).message
  }
  report.cases.push(result)
  report.summary = summarizeCadBenchmark(report.cases, cases.length)
  report.byCase = Object.fromEntries(filtered.map((item) => [item.id,
    summarizeCadBenchmark(report.cases.filter((entry) => entry.caseId === item.id), repetitions)]))
  await writeFile(resolve(output, reportName), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(result))
  if (result.error && /quota|429|RESOURCE_EXHAUSTED/i.test(result.error)) break
}
process.exitCode = report.cases.length === cases.length && report.cases.every((item) => item.status === 'validated' && !item.requirementIssues.length && !item.exportError) ? 0 : 1
