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
    }])
    assert.doesNotMatch(report, /Create a red cube|secret-key|rawProviderResponse/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
