import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WebLlmRuntime,
  type CreateWebLlmEngine,
  type WebLlmEngineLike,
  type WebLlmStatus,
} from "../../src/ai/webllm-runtime.ts";
import type { WebGpuCapability } from "../../src/ai/webgpu-capability.ts";

const READY: WebGpuCapability = { status: "ready" };
const UNSUPPORTED: WebGpuCapability = {
  status: "unsupported",
  reason: "no WebGPU here",
};

function neverCalledWorker(): unknown {
  throw new Error("must not create a worker without WebGPU capability");
}

function neverCalledEngine(): Promise<WebLlmEngineLike> {
  throw new Error("must not create an engine without WebGPU capability");
}

test("unsupported capability short-circuits before touching worker or engine", async () => {
  const runtime = new WebLlmRuntime(
    "some-model",
    async () => UNSUPPORTED,
    neverCalledWorker,
    neverCalledEngine,
  );

  await runtime.initialize();

  assert.deepEqual(runtime.getStatus(), {
    phase: "unsupported",
    reason: "no WebGPU here",
  });
});

test("initialize goes idle -> loading -> ready and reports progress via the worker engine", async () => {
  const observed: WebLlmStatus[] = [];
  let receivedWorker: unknown;
  let receivedModelId: string | undefined;

  const createEngine: CreateWebLlmEngine = async (worker, modelId, options) => {
    receivedWorker = worker;
    receivedModelId = modelId;
    options.initProgressCallback({ progress: 0.5, text: "halfway", timeElapsed: 1 });
    return {};
  };

  const fakeWorker = { id: "fake-worker" };
  const runtime = new WebLlmRuntime(
    "test-model-id",
    async () => READY,
    () => fakeWorker,
    createEngine,
  );
  runtime.onStatusChange((status) => observed.push(status));

  await runtime.initialize();

  assert.equal(receivedWorker, fakeWorker);
  assert.equal(receivedModelId, "test-model-id");
  assert.deepEqual(runtime.getStatus(), { phase: "ready" });
  assert.deepEqual(observed[0], {
    phase: "loading",
    progress: { progress: 0, text: "", timeElapsed: 0 },
  });
  assert.deepEqual(observed[1], {
    phase: "loading",
    progress: { progress: 0.5, text: "halfway", timeElapsed: 1 },
  });
  assert.deepEqual(observed[2], { phase: "ready" });
});

test("a failing engine creation surfaces as an error status, not a thrown exception", async () => {
  const runtime = new WebLlmRuntime(
    "test-model-id",
    async () => READY,
    () => ({}),
    async () => {
      throw new Error("worker init failed");
    },
  );

  await runtime.initialize();

  assert.deepEqual(runtime.getStatus(), {
    phase: "error",
    message: "worker init failed",
  });
});

test("cancel forwards to the loaded engine's interruptGenerate", async () => {
  let interrupted = false;
  const runtime = new WebLlmRuntime(
    "test-model-id",
    async () => READY,
    () => ({}),
    async () => ({
      interruptGenerate: () => {
        interrupted = true;
      },
    }),
  );
  await runtime.initialize();

  runtime.cancel();

  assert.equal(interrupted, true);
});

test("cancel before initialize is a no-op", () => {
  const runtime = new WebLlmRuntime("test-model-id", async () => READY, neverCalledWorker, neverCalledEngine);

  assert.doesNotThrow(() => runtime.cancel());
});

test("onStatusChange unsubscribe stops further notifications", async () => {
  const observed: WebLlmStatus[] = [];
  const runtime = new WebLlmRuntime(
    "test-model-id",
    async () => UNSUPPORTED,
    neverCalledWorker,
    neverCalledEngine,
  );
  const unsubscribe = runtime.onStatusChange((status) => observed.push(status));
  unsubscribe();

  await runtime.initialize();

  assert.deepEqual(observed, []);
});
