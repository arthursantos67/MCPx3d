import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OpenAICompatibleProvider,
  type FetchLike,
  type OpenAICompatibleProviderState,
} from "../src/openai-compatible-provider.ts";
import { ProviderRequestError, StructuredOutputError, type CompletionMetadata } from "../src/provider.ts";
import modelPlanSchema from "../../domain/schemas/model-plan.v1.schema.json" with { type: "json" };

const CONFIG = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "test-model" };

function fakeFetch(
  handler: (
    url: string,
    init: RequestInit,
  ) => Promise<{ status: number; body: unknown; text?: string; headers?: Record<string, string> }>,
): FetchLike {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const result = await handler(String(url), init ?? {});
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: new Headers(result.headers),
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

test("strips a trailing slash from baseUrl so the endpoint URL never gets a double slash", async () => {
  let receivedUrl = "";
  const provider = new OpenAICompatibleProvider(
    { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: "sk-test", model: "test-model" },
    fakeFetch(async (url) => {
      receivedUrl = url;
      return { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
  );
  await provider.initialize();

  await provider.generateStructured([], {});

  assert.equal(receivedUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
});

test("accepts a full chat completions endpoint without appending the path twice", async () => {
  let receivedUrl = "";
  const provider = new OpenAICompatibleProvider(
    {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions/",
      apiKey: "sk-test",
      model: "test-model",
    },
    fakeFetch(async (url) => {
      receivedUrl = url;
      return { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
  );
  await provider.initialize();

  await provider.generateStructured([], {});

  assert.equal(receivedUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
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
  assert.equal("max_tokens" in sentBody, false);
  assert.equal(sentBody.max_completion_tokens, 256);
  assert.equal(sentBody.reasoning_effort, "low");
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("strips description keys from the schema before sending it, without touching structural keywords", async () => {
  const schemaWithDescriptions = {
    type: "object",
    description: "top-level description",
    properties: {
      intent: { type: "string", description: "the intent field" },
      operations: {
        type: "array",
        items: {
          oneOf: [
            { type: "object", description: "a create op", properties: { op: { const: "create_object" } } },
          ],
        },
      },
    },
  };
  let receivedInit: RequestInit = {};
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async (_url, init) => {
      receivedInit = init;
      return { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
  );
  await provider.initialize();

  await provider.generateStructured([], schemaWithDescriptions);

  const sentBody = JSON.parse(receivedInit.body as string) as { response_format: { json_schema: { schema: unknown } } };
  const sentSchema = JSON.stringify(sentBody.response_format.json_schema.schema);
  assert.doesNotMatch(sentSchema, /description/);
  assert.deepEqual(sentBody.response_format.json_schema.schema, {
    type: "object",
    properties: {
      intent: { type: "string" },
      operations: {
        type: "array",
        items: { oneOf: [{ type: "object", properties: { op: { const: "create_object" } } }] },
      },
    },
  });
});

test("Gemini receives a supported schema shape while the local schema remains unchanged", async () => {
  const schema = {
    type: "object",
    required: ["decision", "spec"],
    properties: {
      decision: { enum: ["create", "clarify"] },
      spec: { anyOf: [
        { type: "object", additionalProperties: false, properties: { kind: { const: "extruded_rectangle" }, partId: { type: "string", pattern: "^[A-Z]+$", maxLength: 64 } } },
        { type: "null" },
      ] },
    },
  };
  let sentSchema: unknown;
  let sentTemperature: unknown;
  const provider = new OpenAICompatibleProvider(
    { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: "test-key", model: "gemini-3.5-flash-lite" },
    fakeFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      sentSchema = body.response_format.json_schema.schema;
      sentTemperature = body.temperature;
      return { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
  );
  await provider.initialize();
  await provider.generateStructured([], schema, { temperature: 0 });

  assert.deepEqual(sentSchema, {
    type: "object",
    required: ["decision", "spec"],
    properties: {
      decision: { type: "string", enum: ["create", "clarify"] },
      spec: { type: ["object", "null"], additionalProperties: false, properties: { kind: { type: "string", enum: ["extruded_rectangle"] }, partId: { type: "string" } } },
    },
  });
  assert.equal(sentTemperature, undefined);
  assert.equal((schema.properties.spec.anyOf[0] as Record<string, unknown>).additionalProperties, false);
  assert.equal((schema.properties.spec.anyOf[0] as { properties: { kind: { const: string } } }).properties.kind.const, "extruded_rectangle");
});

test("Gemini model-plan schema expands local references and drops unsupported keywords", async () => {
  let sentSchema: unknown;
  const provider = new OpenAICompatibleProvider(
    { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: "test-key", model: "gemini-3.5-flash-lite" },
    fakeFetch(async (_url, init) => {
      sentSchema = JSON.parse(String(init.body)).response_format.json_schema.schema;
      return { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
  );
  await provider.initialize();
  await provider.generateStructured([], modelPlanSchema);

  const json = JSON.stringify(sentSchema);
  assert.doesNotMatch(json, /"(?:\$ref|\$defs|const|oneOf|pattern|exclusiveMinimum|not|minLength|maxLength)"/);
  assert.match(json, /"anyOf"/);
  assert.match(json, /"create_object"/);
  assert.match(json, /"op":\{"enum":\["create_object"\],"type":"string"\}/);
});

test("defaults max_completion_tokens to the explicit 8192 cap when the caller doesn't specify one, and never sends max_tokens", async () => {
  let receivedInit: RequestInit = {};
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async (_url, init) => {
      receivedInit = init;
      return { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
  );
  await provider.initialize();

  await provider.generateStructured([], {});

  const sentBody = JSON.parse(receivedInit.body as string) as Record<string, unknown>;
  assert.equal("max_tokens" in sentBody, false);
  assert.equal(sentBody.max_completion_tokens, 8192);
});

test("a non-2xx response throws an actionable error without leaking the api key or raw body, and state returns to ready", async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async () => {
      calls += 1;
      return { status: 401, body: {}, text: "invalid api key sk-test for prompt SECRET_PROMPT" };
    }),
  );
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /status 401.*Check the API key/);
    assert.doesNotMatch(error.message, /sk-test|SECRET_PROMPT|invalid api key/);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("a JSON error body contributes only an identifier-shaped provider code", async () => {
  const bodies = [
    { error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid JSON payload near 'SECRET_PROMPT'" } },
    { error: { status: "echo of SECRET_PROMPT", code: "model_not_found", message: "SECRET_PROMPT" } },
  ];
  const expected = [/status 400\) \(provider code: INVALID_ARGUMENT\)/, /status 400\) \(provider code: model_not_found\)/];
  for (const [index, body] of bodies.entries()) {
    const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => ({ status: 400, body })));
    await provider.initialize();

    await assert.rejects(() => provider.generateStructured([], {}), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, expected[index]!);
      assert.doesNotMatch(error.message, /SECRET_PROMPT|Invalid JSON payload/);
      return true;
    });
  }
});

test("retries transient 503 responses with exponential backoff and succeeds", async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async () => {
      calls += 1;
      if (calls < 3) return { status: 503, body: { error: { status: "UNAVAILABLE" } } };
      return { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
    async (milliseconds) => {
      delays.push(milliseconds);
    },
    () => 0.5,
  );
  await provider.initialize();

  await assert.doesNotReject(() => provider.generateStructured([], {}));

  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("uses Retry-After when a transient response supplies it", async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async () => {
      calls += 1;
      return calls === 1
        ? { status: 503, body: {}, headers: { "retry-after": "3" } }
        : { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    }),
    async (milliseconds) => {
      delays.push(milliseconds);
    },
  );
  await provider.initialize();

  await provider.generateStructured([], {});

  assert.equal(calls, 2);
  assert.deepEqual(delays, [3000]);
});

test("a 429 without a retry interval stops after one request", async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    calls += 1;
    return { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } };
  }));
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), /status 429, 1 attempt/);
  assert.equal(calls, 1);
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("a short explicit 429 retry interval is honored once", async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    calls += 1;
    return calls === 1
      ? { status: 429, body: {}, headers: { "retry-after": "3" } }
      : { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
  }), async (milliseconds) => { delays.push(milliseconds); });
  await provider.initialize();

  await provider.generateStructured([], {});
  assert.equal(calls, 2);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] > 2900 && delays[0] <= 3000);
});

test("a long 429 retry interval is reported without waiting or retrying", async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    calls += 1;
    return { status: 429, body: {}, headers: { "retry-after": "60" } };
  }), async () => { throw new Error("must not wait"); });
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), /cerca de 60 segundos/);
  await assert.rejects(() => provider.generateStructured([], {}), /status 429, 0 attempts/);
  assert.equal(calls, 1);
});

test('Gemini RetryInfo supplies a retry interval even without exposed HTTP headers', async () => {
  let calls = 0;
  const delays: number[] = [];
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    calls++;
    return calls === 1 ? { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', details: [
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' },
    ] } } } : { status: 200, body: { choices: [{ message: { content: '{}' } }] } };
  }), async (delay) => { delays.push(delay); });
  await provider.initialize();
  await provider.generateStructured([], {});
  assert.equal(calls, 2);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] > 2900 && delays[0] <= 3000);
});

test('daily Gemini quota stops immediately even when a short RetryInfo is present', async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
    calls++;
    return { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'secret request and key', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' },
    ] } } };
  }), async () => { throw new Error('must not retry daily quota'); });
  await provider.initialize();
  await assert.rejects(provider.generateStructured([], {}), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.limit?.kind, 'quota');
    assert.equal(error.limit?.code, 'RESOURCE_EXHAUSTED');
    assert.match(error.message, /quota.*esgotada/);
    assert.doesNotMatch(error.message, /secret|request and key/);
    return true;
  });
  assert.equal(calls, 1);
});

test('billing quota and oversized requests are distinguished without echoing response content', async () => {
  for (const [body, kind] of [
    [{ error: { code: 'insufficient_quota', message: 'private account' } }, 'quota'],
    [{ error: { type: 'tokens', message: 'Request too large for private prompt' } }, 'request-size'],
  ] as const) {
    const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => ({ status: 429, body })));
    await provider.initialize();
    await assert.rejects(provider.generateStructured([], {}), (error: unknown) => {
      assert.ok(error instanceof ProviderRequestError);
      assert.equal(error.limit?.kind, kind);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
  }
});

test('expired retry deadlines permit a fresh request and clear the cooldown on success', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    let calls = 0;
    const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => {
      calls++;
      return calls === 1 ? { status: 429, headers: { 'retry-after': '60' }, body: {} }
        : { status: 200, body: { choices: [{ message: { content: '{}' } }] } };
    }));
    await provider.initialize();
    await assert.rejects(provider.generateStructured([], {}), /status 429/);
    await assert.rejects(provider.generateStructured([], {}), /0 attempts/);
    now += 60000;
    await provider.generateStructured([], {});
    await provider.generateStructured([], {});
    assert.equal(calls, 3);
  } finally { Date.now = originalNow; }
});

test("stops after four retries and replaces a raw 503 payload with an actionable message", async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async () => {
      calls += 1;
      return { status: 503, body: { error: { message: "high demand" } } };
    }),
    async () => undefined,
  );
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /temporarily unavailable after five attempts/);
    assert.doesNotMatch(error.message, /\{\s*"error"/);
    return true;
  });
  assert.equal(calls, 5);
});

test("a fetch failure becomes an actionable provider request error without leaking the original browser error", async () => {
  const provider = new OpenAICompatibleProvider(CONFIG, (async () => {
    throw new TypeError("NetworkError when attempting to fetch resource.");
  }) as FetchLike);
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "ProviderRequestError");
    assert.match(error.message, /check the Base URL/i);
    assert.doesNotMatch(error.message, /sk-test/);
    return true;
  });
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("a response with no message content throws a classified empty-output error", async () => {
  const provider = new OpenAICompatibleProvider(CONFIG, fakeFetch(async () => ({ status: 200, body: { choices: [] } })));
  await provider.initialize();

  await assert.rejects(
    () => provider.generateStructured([], {}),
    (error: unknown) => error instanceof StructuredOutputError && error.completion.failure === "empty",
  );
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

test("finish_reason length is classified as truncation with safe completion metadata only", async () => {
  const completions: CompletionMetadata[] = [];
  const truncated = '{"intent":"create_model","operations":[{"op":"create_object","name":"SECRET_PART';
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async () => ({
      status: 200,
      body: {
        choices: [{ message: { content: truncated }, finish_reason: "length" }],
        usage: { prompt_tokens: 900, completion_tokens: 2048, completion_tokens_details: { reasoning_tokens: 1024 } },
      },
    })),
  );
  await provider.initialize();

  const error = await provider
    .generateStructured([{ role: "user", content: "a big kitchen" }], {}, { onCompletion: (c) => completions.push(c) })
    .then(() => null, (reason: unknown) => reason);

  assert.ok(error instanceof StructuredOutputError);
  assert.equal(error.completion.failure, "truncated");
  assert.doesNotMatch(error.message, /SECRET_PART|kitchen|sk-test/);
  assert.deepEqual(completions, [{
    finishReason: "length",
    outputCharacters: truncated.length,
    usage: { promptTokens: 900, completionTokens: 2048, reasoningTokens: 1024 },
    failure: "truncated",
    locallyRepaired: false,
  }]);
  assert.doesNotMatch(JSON.stringify(completions), /SECRET_PART|kitchen|sk-test/);
});

test("the requested completion budget never exceeds the provider's declared output ceiling", async () => {
  let sentBudget: unknown;
  const provider = new OpenAICompatibleProvider(
    CONFIG,
    fakeFetch(async (_url, init) => {
      sentBudget = JSON.parse(String(init.body)).max_completion_tokens;
      return { status: 200, body: { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] } };
    }),
  );
  await provider.initialize();

  await provider.generateStructured([], {}, { maxTokens: 100_000 });

  assert.equal(provider.maxOutputTokens, 8192);
  assert.equal(sentBudget, 8192);
  assert.equal(provider.model, "test-model");
});
