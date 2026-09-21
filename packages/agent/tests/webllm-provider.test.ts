import assert from "node:assert/strict";
import { test } from "node:test";

import type { MLCEngineInterface } from "@mlc-ai/web-llm";

import {
  WebLLMProvider,
  type CreateWebLlmEngine,
  type WebGpuCapabilityResult,
  type WebLLMProviderState,
} from "../src/webllm-provider.ts";

const AVAILABLE: WebGpuCapabilityResult = { available: true };
const UNAVAILABLE: WebGpuCapabilityResult = { available: false, reason: "no WebGPU here" };

function neverCalledWorker(): unknown {
  throw new Error("must not create a worker without WebGPU capability");
}

function neverCalledEngine(): Promise<MLCEngineInterface> {
  throw new Error("must not create an engine without WebGPU capability");
}

function fakeEngine(
  overrides: Partial<{
    create: (request: unknown) => Promise<{ choices: { message: { content: string | null } }[] }>;
    interruptGenerate: () => void;
  }> = {},
): MLCEngineInterface {
  const engine = {
    chat: {
      completions: {
        create: overrides.create ?? (async () => ({ choices: [{ message: { content: "{}" } }] })),
      },
    },
    interruptGenerate: overrides.interruptGenerate ?? (() => {}),
  };
  return engine as unknown as MLCEngineInterface;
}

test("unsupported capability short-circuits before touching worker or engine", async () => {
  const provider = new WebLLMProvider("some-model", async () => UNAVAILABLE, neverCalledWorker, neverCalledEngine);

  await provider.initialize();

  assert.deepEqual(provider.getState(), { phase: "unsupported", reason: "no WebGPU here" });
  assert.equal(await provider.isAvailable(), false);
});

test("initialize goes idle -> loading -> ready and reports progress", async () => {
  const observed: WebLLMProviderState[] = [];
  let receivedModelId: string | undefined;

  const createEngine: CreateWebLlmEngine = async (_worker, modelId, options) => {
    receivedModelId = modelId;
    options.initProgressCallback({ progress: 0.5, text: "halfway", timeElapsed: 1 });
    return fakeEngine();
  };

  const provider = new WebLLMProvider("test-model-id", async () => AVAILABLE, () => ({}), createEngine);
  provider.onStateChange((state) => observed.push(state));

  await provider.initialize();

  assert.equal(receivedModelId, "test-model-id");
  assert.deepEqual(provider.getState(), { phase: "ready" });
  assert.deepEqual(observed[0], { phase: "loading", progress: { progress: 0, text: "", timeElapsed: 0 } });
  assert.deepEqual(observed[1], { phase: "loading", progress: { progress: 0.5, text: "halfway", timeElapsed: 1 } });
  assert.deepEqual(observed[2], { phase: "ready" });
});

test("a failing engine creation surfaces as an error state, not a thrown exception", async () => {
  const provider = new WebLLMProvider(
    "test-model-id",
    async () => AVAILABLE,
    () => ({}),
    async () => {
      throw new Error("worker init failed");
    },
  );

  await provider.initialize();

  assert.deepEqual(provider.getState(), { phase: "error", message: "worker init failed" });
});

test("generateStructured before initialize throws instead of calling the engine", async () => {
  const provider = new WebLLMProvider("test-model-id", async () => AVAILABLE, () => ({}), neverCalledEngine);

  await assert.rejects(
    () => provider.generateStructured([{ role: "user", content: "hi" }], {}),
    /not ready/,
  );
});

test("generateStructured sends response_format json_object with the given schema and returns parsed content", async () => {
  const schema = { type: "object", properties: { intent: { type: "string" } } };
  let receivedRequest: unknown;

  const provider = new WebLLMProvider(
    "test-model-id",
    async () => AVAILABLE,
    () => ({}),
    async () =>
      fakeEngine({
        create: async (request) => {
          receivedRequest = request;
          return { choices: [{ message: { content: '{"intent":"modify_model","operations":[]}' } }] };
        },
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
  assert.deepEqual(receivedRequest, {
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "create a red cube" },
    ],
    response_format: { type: "json_object", schema: JSON.stringify(schema) },
    temperature: 0.2,
    max_tokens: 256,
  });
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("generateStructured returns to ready even when the engine call throws", async () => {
  const provider = new WebLLMProvider(
    "test-model-id",
    async () => AVAILABLE,
    () => ({}),
    async () =>
      fakeEngine({
        create: async () => {
          throw new Error("generation failed");
        },
      }),
  );
  await provider.initialize();

  await assert.rejects(() => provider.generateStructured([], {}), /generation failed/);
  assert.deepEqual(provider.getState(), { phase: "ready" });
});

test("cancel forwards to the loaded engine's interruptGenerate", async () => {
  let interrupted = false;
  const provider = new WebLLMProvider(
    "test-model-id",
    async () => AVAILABLE,
    () => ({}),
    async () => fakeEngine({ interruptGenerate: () => { interrupted = true; } }),
  );
  await provider.initialize();

  await provider.cancel();

  assert.equal(interrupted, true);
});

test("cancel before initialize is a no-op", async () => {
  const provider = new WebLLMProvider("test-model-id", async () => AVAILABLE, neverCalledWorker, neverCalledEngine);

  await assert.doesNotReject(() => provider.cancel());
});

test("onStateChange unsubscribe stops further notifications", async () => {
  const observed: WebLLMProviderState[] = [];
  const provider = new WebLLMProvider("test-model-id", async () => UNAVAILABLE, neverCalledWorker, neverCalledEngine);
  const unsubscribe = provider.onStateChange((state) => observed.push(state));
  unsubscribe();

  await provider.initialize();

  assert.deepEqual(observed, []);
});
