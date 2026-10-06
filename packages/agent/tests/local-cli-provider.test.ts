import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalCliProvider } from '../src/local-cli-provider.ts';
import { ProviderRequestError, StructuredOutputError } from '../src/provider.ts';

const config = { apiBaseUrl: 'http://localhost:8001/', client: 'codex' as const, model: '' };
const schema = { type: 'object' };
const messages = [{ role: 'user' as const, content: 'part request' }];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('local CLI checks subscription and sends the unchanged contract without credentials', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).includes('/status/')
      ? json({ client: 'codex', installed: true, authenticated: true, message: 'ready' })
      : json({ content: '{"ok":true}', finishReason: 'stop', usage: { completionTokens: 3 } });
  };
  const provider = new LocalCliProvider(config, fetchImpl);
  await provider.initialize();
  assert.equal(provider.getState().phase, 'ready');
  assert.deepEqual(await provider.generateStructured(messages, schema), { ok: true });
  assert.equal(calls[1].url, 'http://localhost:8001/api/ai/local/generate');
  assert.deepEqual(JSON.parse(calls[1].init!.body as string), { client: 'codex', model: '', messages, schema });
  assert.deepEqual(calls[1].init!.headers, { 'Content-Type': 'application/json' });
});

test('local CLI quota is a provider failure and is never automatically retried', async () => {
  let calls = 0;
  const provider = new LocalCliProvider(config, async () => {
    calls += 1;
    return json({ code: 'CLI_QUOTA', message: 'Limite da assinatura.' }, 429);
  });
  await assert.rejects(provider.generateStructured(messages, schema), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.limit?.kind, 'quota');
    assert.ok(!(error instanceof StructuredOutputError));
    return true;
  });
  assert.equal(calls, 1);
});

test('local CLI incomplete JSON pauses without retries and remains available for a manual resume', async () => {
  const provider = new LocalCliProvider(config, async () => json({ content: '{"steps":[', finishReason: 'stop' }));
  await assert.rejects(provider.generateStructured(messages, schema), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError && error.cause instanceof StructuredOutputError);
    assert.match(error.message, /JSON incompleto/);
    assert.doesNotMatch(error.message, /reached its output limit/);
    return true;
  });
  assert.equal(provider.getState().phase, 'ready');
});

test('a broken local HTTP envelope cannot trigger paid format retries', async () => {
  let calls = 0;
  const provider = new LocalCliProvider(config, async () => {
    calls++;
    return new Response('{"content":', { status: 200 });
  });
  await assert.rejects(provider.generateStructured(messages, schema), ProviderRequestError);
  assert.equal(calls, 1);
  assert.equal(provider.getState().phase, 'ready');
});

test('null or missing local HTTP fields fail safely with no paid retries', async () => {
  for (const payload of [null, {}, { content: 42, finishReason: 'stop' }]) {
    let calls = 0;
    const provider = new LocalCliProvider(config, async () => { calls++; return json(payload); });
    await assert.rejects(provider.generateStructured(messages, schema), ProviderRequestError);
    assert.equal(calls, 1);
    assert.equal(provider.getState().phase, 'ready');
  }
  const provider = new LocalCliProvider(config, async () => json(null, 503));
  await assert.rejects(provider.generateStructured(messages, schema), ProviderRequestError);
  assert.equal(provider.getState().phase, 'ready');
});

test('local CLI cancellation aborts the request and returns to ready without retry', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = (_url, init) => new Promise<Response>((_resolve, reject) => {
    calls += 1;
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const provider = new LocalCliProvider(config, fetchImpl);
  const pending = provider.generateStructured(messages, schema);
  await provider.cancel();
  await assert.rejects(pending, /cancelada/);
  assert.equal(provider.getState().phase, 'ready');
  assert.equal(calls, 1);
});
