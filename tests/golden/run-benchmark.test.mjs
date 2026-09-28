import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('benchmark output retains only safe timing metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-web3d-benchmark-'))
  const input = join(directory, 'samples.json')
  const output = join(directory, 'report')
  try {
    await writeFile(input, JSON.stringify([{
      id: 'primitive-en-01',
      outcome: 'success',
      correlationId: 'request_123',
      revision: 2,
      timings: { provider_request: 123.4, 'bad stage': 999 },
      totalLatencyMs: 456.7,
      mcpCallCount: 3,
      prompt: 'Create a red cube',
      apiKey: 'secret-key',
      rawProviderResponse: '{"secret":true}',
    }]), 'utf8')

    await execFileAsync(process.execPath, ['tests/golden/run-benchmark.mjs', input, output])
    const report = await readFile(`${output}.json`, 'utf8')
    const parsed = JSON.parse(report)

    assert.deepEqual(parsed.samples, [{
      caseId: 'primitive-en-01',
      outcome: 'success',
      correlationId: 'request_123',
      revision: 2,
      timings: { provider_request: 123 },
      totalLatencyMs: 457,
      mcpCallCount: 3,
      provider: 'unknown',
      model: 'unknown',
      truncated: false,
      continued: false,
      batches: 0,
      localRepairs: 0,
      formatRepairs: 0,
      applyRepairs: 0,
      finalValidScene: false,
      validationFailures: {},
      skippedBatches: 0,
      overlapResolutions: 0,
    }])
    assert.doesNotMatch(report, /Create a red cube|secret-key|rawProviderResponse/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('benchmark reports truncation and recovery rates by provider/model without unsafe fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-web3d-benchmark-'))
  const input = join(directory, 'samples.json')
  const output = join(directory, 'report')
  const gemini = { provider: 'openai-compatible', model: 'gemini-2.5-flash' }
  try {
    await writeFile(input, JSON.stringify([
      { ...gemini, id: 'large-scene-en-01', outcome: 'success', truncated: true, continued: true, batches: 3, finalValidScene: true },
      { ...gemini, id: 'large-scene-pt-01', outcome: 'failure', truncated: true, continued: true, batches: 1, finalValidScene: false, rawProviderResponse: '{"operations":[' },
      { ...gemini, id: 'primitive-en-01', outcome: 'success', localRepairs: 1, finalValidScene: true },
      { ...gemini, id: 'primitive-en-02', outcome: 'success', formatRepairs: 1, applyRepairs: 1, finalValidScene: true, validationFailures: { schema: 1, 'dropped-operations': 1, 'raw model text': 5 } },
      { provider: 'webllm', model: 'Bearer sk-secret with spaces', id: 'primitive-en-01', outcome: 'success', finalValidScene: true },
    ]), 'utf8')

    await execFileAsync(process.execPath, ['tests/golden/run-benchmark.mjs', input, output])
    const report = JSON.parse(await readFile(`${output}.json`, 'utf8'))
    const markdown = await readFile(`${output}.md`, 'utf8')

    assert.deepEqual(report.recovery['openai-compatible/gemini-2.5-flash'], {
      samples: 4,
      truncationRate: 0.5,
      recoveryRate: 0.5,
      continuationRate: 0.5,
      localRepairRate: 0.25,
      formatRepairRate: 0.25,
      applyRepairRate: 0.25,
      finalValidSceneRate: 0.75,
      skippedBatchRate: 0,
      overlapResolutionRate: 0,
      validationFailures: { schema: 1, 'dropped-operations': 1 },
    })
    assert.equal(report.recovery['webllm/unknown'].recoveryRate, null)
    assert.match(markdown, /\| openai-compatible\/gemini-2\.5-flash \| 4 \| 0\.5 \| 0\.5 \|.*\| schema 1, dropped-operations 1 \|/)
    assert.doesNotMatch(JSON.stringify(report) + markdown, /sk-secret|"operations":\[|raw model text/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
