import { readFile, writeFile } from 'node:fs/promises'

const [inputPath, outputBase] = process.argv.slice(2)
if (!inputPath || !outputBase) {
  throw new Error('Usage: node tests/golden/run-benchmark.mjs <safe-samples.json> <output-base>')
}

const samples = JSON.parse(await readFile(inputPath, 'utf8'))
if (!Array.isArray(samples)) throw new Error('Benchmark input must be an array of safe samples.')

function safeString(value, pattern, fallback = null) {
  return typeof value === 'string' && pattern.test(value) ? value : fallback
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}

function safeTimings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([stage, duration]) => /^[a-z][a-z0-9_]{0,63}$/.test(stage) && safeNumber(duration) !== null)
    .map(([stage, duration]) => [stage, safeNumber(duration)]))
}

const VALIDATION_FAILURES = ['malformed', 'truncated', 'schema', 'domain', 'unknown-target', 'clarify-mix', 'batch-size', 'dropped-operations']

function safeValidationFailures(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(VALIDATION_FAILURES
    .filter((category) => safeNumber(value[category]))
    .map((category) => [category, safeNumber(value[category])]))
}

function safeSample(sample) {
  const value = sample && typeof sample === 'object' && !Array.isArray(sample) ? sample : {}
  return {
    caseId: safeString(value.caseId ?? value.id, /^[a-z0-9][a-z0-9_-]{0,79}$/i, 'unknown'),
    outcome: safeString(value.outcome, /^(success|failure|cancelled)$/i, 'failure'),
    correlationId: safeString(value.correlationId, /^[a-z0-9_-]{1,128}$/i),
    revision: safeNumber(value.revision),
    timings: safeTimings(value.timings),
    totalLatencyMs: safeNumber(value.totalLatencyMs),
    mcpCallCount: safeNumber(value.mcpCallCount),
    provider: safeString(value.provider, /^[a-z0-9][a-z0-9._-]{0,63}$/i, 'unknown'),
    model: safeString(value.model, /^[a-z0-9][a-z0-9._:/-]{0,127}$/i, 'unknown'),
    truncated: value.truncated === true,
    continued: value.continued === true,
    batches: safeNumber(value.batches) ?? 0,
    localRepairs: safeNumber(value.localRepairs) ?? 0,
    formatRepairs: safeNumber(value.formatRepairs) ?? 0,
    applyRepairs: safeNumber(value.applyRepairs) ?? 0,
    finalValidScene: value.finalValidScene === true,
    validationFailures: safeValidationFailures(value.validationFailures),
    skippedBatches: safeNumber(value.skippedBatches) ?? 0,
    overlapResolutions: safeNumber(value.overlapResolutions) ?? 0,
  }
}

const safeSamples = samples.map(safeSample)

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}

const stages = {}
for (const sample of safeSamples) {
  for (const [stage, duration] of Object.entries(sample.timings ?? {})) {
    if (typeof duration === 'number') (stages[stage] ??= []).push(duration)
  }
}
const metrics = Object.fromEntries(Object.entries(stages).map(([stage, values]) => [
  stage,
  values.length < 20 ? { rawSamples: values } : { p50: percentile(values, .5), p95: percentile(values, .95) },
]))
function rate(count, total) {
  return total === 0 ? null : Math.round((count / total) * 1000) / 1000
}

const byProviderModel = {}
for (const sample of safeSamples) (byProviderModel[`${sample.provider}/${sample.model}`] ??= []).push(sample)
const recovery = Object.fromEntries(Object.entries(byProviderModel).map(([providerModel, group]) => {
  const truncated = group.filter((sample) => sample.truncated)
  return [providerModel, {
    samples: group.length,
    truncationRate: rate(truncated.length, group.length),
    recoveryRate: rate(truncated.filter((sample) => sample.finalValidScene).length, truncated.length),
    continuationRate: rate(group.filter((sample) => sample.continued).length, group.length),
    localRepairRate: rate(group.filter((sample) => sample.localRepairs > 0).length, group.length),
    formatRepairRate: rate(group.filter((sample) => sample.formatRepairs > 0).length, group.length),
    applyRepairRate: rate(group.filter((sample) => sample.applyRepairs > 0).length, group.length),
    finalValidSceneRate: rate(group.filter((sample) => sample.finalValidScene).length, group.length),
    skippedBatchRate: rate(group.filter((sample) => sample.skippedBatches > 0).length, group.length),
    overlapResolutionRate: rate(group.filter((sample) => sample.overlapResolutions > 0).length, group.length),
    validationFailures: Object.fromEntries(VALIDATION_FAILURES
      .map((category) => [category, group.reduce((total, sample) => total + (sample.validationFailures[category] ?? 0), 0)])
      .filter(([, count]) => count > 0)),
  }]
}))

const output = {
  sampleCount: safeSamples.length,
  successful: safeSamples.filter((sample) => sample.outcome === 'success').length,
  stages: metrics,
  recovery,
  samples: safeSamples,
}
await writeFile(`${outputBase}.json`, `${JSON.stringify(output, null, 2)}\n`)
const rows = Object.entries(metrics).map(([stage, value]) => `| ${stage} | ${value.p50 ?? 'raw'} | ${value.p95 ?? value.rawSamples.join(', ')} |`).join('\n')
const recoveryRows = Object.entries(recovery).map(([providerModel, value]) => `| ${providerModel} | ${value.samples} | ${value.truncationRate ?? 'n/a'} | ${value.recoveryRate ?? 'n/a'} | ${value.continuationRate ?? 'n/a'} | ${value.localRepairRate ?? 'n/a'} | ${value.formatRepairRate ?? 'n/a'} | ${value.applyRepairRate ?? 'n/a'} | ${value.finalValidSceneRate ?? 'n/a'} | ${Object.entries(value.validationFailures).map(([category, count]) => `${category} ${count}`).join(', ') || 'none'} |`).join('\n')
await writeFile(`${outputBase}.md`, `# Golden benchmark results\n\nSamples: ${samples.length}; successful: ${output.successful}.\n\n| Stage | p50 ms | p95 ms / raw samples |\n|---|---:|---:|\n${rows}\n\n## Truncation and recovery by provider/model\n\n| Provider/model | Samples | Truncation | Recovery (of truncated) | Continuation | Local repair | Format repair | Apply repair | Final valid scene | Rejections |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${recoveryRows}\n`)
