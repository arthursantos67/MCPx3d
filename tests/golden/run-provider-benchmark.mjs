import { readFile, writeFile } from 'node:fs/promises'

import { createSceneGenerationCounters, generateScene } from '../../packages/agent/src/generate-scene.ts'
import { OpenAICompatibleProvider } from '../../packages/agent/src/openai-compatible-provider.ts'

const providerUrl = process.env.BENCHMARK_PROVIDER_URL
const apiKey = process.env.BENCHMARK_API_KEY
const model = process.env.BENCHMARK_MODEL
const apiBaseUrl = process.env.BENCHMARK_API_BASE_URL ?? 'http://localhost:8001'
if (!providerUrl || !apiKey || !model) throw new Error('Set BENCHMARK_PROVIDER_URL, BENCHMARK_API_KEY, and BENCHMARK_MODEL.')

const REPAIRABLE_APPLY_ERROR_CODES = new Set(['DOMAIN_VALIDATION_FAILED', 'UNKNOWN_TARGET', 'UNINTENDED_OVERLAP', 'X3D_VALIDATION_FAILED'])

class ApplyError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function safeCode(value) {
  return typeof value === 'string' ? value.replace(/[^a-z0-9_]/gi, '_').slice(0, 80) : 'unknown'
}

const corpus = JSON.parse(await readFile(new URL('./benchmark-prompts.json', import.meta.url), 'utf8'))
const provider = new OpenAICompatibleProvider({ baseUrl: providerUrl, apiKey, model })
await provider.initialize()
const samples = []
for (const item of corpus.cases) {
  const started = performance.now()
  const counters = createSceneGenerationCounters()
  let outcome = 'failure'; let revision = null; let correlationId = null; let errorCode = null; let finalValidScene = false
  const timings = {}
  try {
    const project = await fetch(`${apiBaseUrl}/api/projects`, { method: 'POST' }).then((response) => response.json())
    let applyCount = 0
    const result = await generateScene({
      provider,
      request: item.prompt,
      modelSpec: project,
      counters,
      describeRepairableApplyError: (error) =>
        error instanceof ApplyError && error.status === 422 && REPAIRABLE_APPLY_ERROR_CODES.has(error.code) ? `${error.code}: ${error.message}` : null,
      applyPlan: async (plan, spec, { resolveOverlaps }) => {
        applyCount += 1
        const applied = await fetch(`${apiBaseUrl}/api/projects/${project.projectId}/plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: spec.revision, requestId: `benchmark_${item.id}_${applyCount}`, plan, ...(resolveOverlaps ? { resolveOverlaps } : {}) }) })
        const body = await applied.json()
        correlationId = applied.headers.get('X-Correlation-Id')
        for (const [stage, duration] of Object.entries(body.timings ?? {})) timings[stage] = (timings[stage] ?? 0) + duration
        if (!applied.ok) throw new ApplyError(applied.status, safeCode(body.code), typeof body.message === 'string' ? body.message : 'apply failed')
        return body.modelSpec
      },
    })
    revision = result.modelSpec.revision
    if (result.status === 'applied') {
      finalValidScene = result.complete && result.skippedBatches.length === 0
      outcome = finalValidScene ? 'success' : 'failure'
      errorCode = !result.complete ? 'batch_limit_reached' : result.skippedBatches.length > 0 ? 'batches_skipped' : null
    } else {
      errorCode = result.status
    }
  } catch (error) {
    errorCode = error instanceof ApplyError ? error.code : safeCode(error instanceof Error ? error.name : 'unknown')
  }
  samples.push({
    caseId: item.id,
    category: item.category,
    outcome,
    revision,
    correlationId,
    timings,
    totalLatencyMs: Math.round(performance.now() - started),
    errorCode,
    provider: provider.id,
    model: provider.model,
    truncated: counters.truncations > 0,
    continued: counters.continued,
    batches: counters.committedBatches,
    localRepairs: counters.localRepairs,
    formatRepairs: counters.formatRepairs,
    applyRepairs: counters.applyRepairs,
    finalValidScene,
    validationFailures: counters.validationFailures,
    skippedBatches: counters.skippedBatches,
    overlapResolutions: counters.overlapResolutions,
  })
}
const outputBase = process.env.BENCHMARK_OUTPUT ?? 'tests/golden/results/provider-benchmark'
await writeFile(`${outputBase}.samples.json`, `${JSON.stringify(samples, null, 2)}\n`)
console.log(`Wrote ${samples.length} safe benchmark samples to ${outputBase}.samples.json`)
