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
const output = {
  sampleCount: safeSamples.length,
  successful: safeSamples.filter((sample) => sample.outcome === 'success').length,
  stages: metrics,
  samples: safeSamples,
}
await writeFile(`${outputBase}.json`, `${JSON.stringify(output, null, 2)}\n`)
const rows = Object.entries(metrics).map(([stage, value]) => `| ${stage} | ${value.p50 ?? 'raw'} | ${value.p95 ?? value.rawSamples.join(', ')} |`).join('\n')
await writeFile(`${outputBase}.md`, `# Golden benchmark results\n\nSamples: ${samples.length}; successful: ${output.successful}.\n\n| Stage | p50 ms | p95 ms / raw samples |\n|---|---:|---:|\n${rows}\n`)
