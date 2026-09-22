import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OpenAICompatibleProvider,
  type FetchLike,
  type OpenAICompatibleProviderState,
} from "../src/openai-compatible-provider.ts";

const CONFIG = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "test-model" };

function fakeFetch(
  handler: (url: string, init: RequestInit) => Promise<{ status: number; body: unknown; text?: string }>,
): FetchLike {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const result = await handler(String(url), init ?? {});
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
      text: async () => result.text ?? JSON.stringify(result.body),
    } as Response;
  }) as FetchLike;
}

test("isAvailable/initialize reflect config completeness", async () => {
  const incomplete = new OpenAICompatibleProvider({ baseUrl: "", apiKey: "", model: "" }, fakeFetch(async () => {
    throw new Error("must not fetch");
  }));

  assert.equal(await incomplete.isAvailable(), false);
  await incomplete.initialize();
  assert.deepEqual(incomplete.getState(), { phase: "error", message: "Missing base URL, API key, or model." });
});

test("a complete config initializes to ready without any network call", async () => {
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    throw new Error("must not fetch during initialize");
  }));

  assert.equal(await provider.isAvailable(), true);
  await provider.initialize();

  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("generateStructured before initialize throws instead of calling fetch", async () => {
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    throw new Error("must not fetch");
  }));

  await assert.rejects(() => provider.generateStructured([{ role: "user", content: "hi" }], {}), /not ready/);
});

test("generateStructured sends the expected request shape and parses the response", async () => {
  const schema = { type: "object", properties: { intent: { type: "string" } } };
  let receivedUrl = "";
  let receivedInit: RequestInit = {};

  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async (url, init) => {
      receivedUrl = url;
      receivedInit = init;
      return { status: 200, body: { choices: [{ message: { content: '{"intent":"modify_model","operations":[]}' } }] } };
    }),
  );
  await provider.initialize();

  const result = await provider.generateStructured<{ intent: string }>(
    [
      { role: "system", content: "system prompt" },
      { role: "user", content: "create a red cube" },
    ],
    schema,
    { temperature: 0.2, maxTokens: 256 },
  );

  assert.deepEqual(result, { intent: "modify_model", operations: [] });
  assert.equal(receivedUrl, "https://api.example.com/v1/chat/completions");
  assert.equal((receivedInit.headers as Record<string, string>).authorization, "Bearer sk-test");
  const sentBody = JSON.parse(receivedInit.body as string) as Record<string, unknown>;
  assert.equal(sentBody.model, "test-model");
  assert.deepEqual(sentBody.messages, [
    { role: "system", content: "system prompt" },
    { role: "user", content: "create a red cube" },
  ]);
  assert.deepEqual(sentBody.response_format, { type: "json_schema", json_schema: { name: "model_plan", schema } });
  assert.equal(sentBody.temperature, 0.2);
  assert.equal(sentBody.max_tokens, 256);
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("a non-2xx response throws a descriptive error without leaking the api key, and state returns to ready", async () => {
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async () => ({ status: 401, body: {}, text: "invalid api key" })),
  );
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /401/);
    assert.match(error.message, /invalid api key/);
    assert.doesNotMatch(error.message, /sk-test/);
    return true;
  });
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("a response with no message content throws a clear error", async () => {
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => ({ status: 200, body: { choices: [] } })));
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), /no message content/);
});

test("state transitions idle -> ready -> generating -> ready are observable via onStateChange", async () => {
  const observed: OpenAICompatibleProviderState[] = [];
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async () => ({ status: 200, body: { choices: [{ message: { content: "{}" } }] } })),
  );
  provider.onStateChange((state) => observed.push(state));

  await provider.initialize();
  await provider.generateStructured([], {});

  assert.deepEqual(observed, [{ phase: "ready" }, { phase: "generating" }, { phase: "ready" }]);
});

test("cancel aborts an in-flight request", async () => {
  // A hand-rolled fetch (not the fakeFetch() helper above) so the abort
  // signal actually rejects the pending call, the same way a real fetch does.
  const neverResolvingFetch: FetchLike = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as FetchLike;
  const provider = new OpenAICompatibleProvider(CONFIG, neverResolvingFetch);
  await provider.initialize();

  const pending = provider.generateStructured([], {});
  await provider.cancel();

  await assert.rejects(pending, /abort/i);
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("cancel before any request is a no-op", async () => {
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    throw new Error("must not fetch");
  }));

  await assert.doesNotReject(() => provider.cancel());
});
