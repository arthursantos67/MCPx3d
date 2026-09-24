import { readFile, writeFile } from 'node:fs/promises'

const providerUrl = process.env.BENCHMARK_PROVIDER_URL
const apiKey = process.env.BENCHMARK_API_KEY
const model = process.env.BENCHMARK_MODEL
const apiBaseUrl = process.env.BENCHMARK_API_BASE_URL ?? 'http://localhost:8001'
if (!providerUrl || !apiKey || !model) throw new Error('Set BENCHMARK_PROVIDER_URL, BENCHMARK_API_KEY, and BENCHMARK_MODEL.')

const corpus = JSON.parse(await readFile(new URL('./benchmark-prompts.json', import.meta.url), 'utf8'))
const schema = JSON.parse(await readFile(new URL('../../packages/domain/schemas/model-plan.v1.schema.json', import.meta.url), 'utf8'))
const samples = []
for (const item of corpus.cases) {
  const started = performance.now()
  const project = await fetch(`${apiBaseUrl}/api/projects`, { method: 'POST' }).then((response) => response.json())
  let outcome = 'failure'; let revision = null; let correlationId = null; let timings = {}; let errorCode = null
  try {
    const generated = await fetch(providerUrl, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: 'Return only a ModelPlan JSON. Use named primitive parts for furniture; ask with clarify when a TV mounting or shelf open/closed variant is unspecified.' }, { role: 'user', content: item.prompt }], response_format: { type: 'json_schema', json_schema: { name: 'model_plan', strict: true, schema } } }) }).then(async (response) => { if (!response.ok) throw new Error(`provider_${response.status}`); return response.json() })
    const plan = JSON.parse(generated.choices[0].message.content)
    const applied = await fetch(`${apiBaseUrl}/api/projects/${project.projectId}/plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, requestId: `benchmark_${item.id}`, plan }) })
    const body = await applied.json()
    correlationId = applied.headers.get('X-Correlation-Id'); timings = body.timings ?? {}; revision = body.revision ?? null; errorCode = body.code ?? null; outcome = applied.ok ? 'success' : 'failure'
  } catch (error) { errorCode = error instanceof Error ? error.message.replace(/[^a-z0-9_]/gi, '_').slice(0, 80) : 'unknown' }
  samples.push({ caseId: item.id, category: item.category, outcome, revision, correlationId, timings, totalLatencyMs: Math.round(performance.now() - started), errorCode })
}
const outputBase = process.env.BENCHMARK_OUTPUT ?? 'tests/golden/results/provider-benchmark'
await writeFile(`${outputBase}.samples.json`, `${JSON.stringify(samples, null, 2)}\n`)
console.log(`Wrote ${samples.length} safe benchmark samples to ${outputBase}.samples.json`)
