import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectWebGpuCapability,
  type WebGpuCapableNavigator,
} from "../../src/ai/webgpu-capability.ts";

test("reports ready when an adapter is available", async () => {
  const nav: WebGpuCapableNavigator = {
    gpu: { requestAdapter: async () => ({}) },
  };

  const capability = await detectWebGpuCapability(nav);

  assert.deepEqual(capability, { status: "ready" });
});

test("reports unsupported with a clear reason when navigator.gpu is absent", async () => {
  const nav: WebGpuCapableNavigator = {};

  const capability = await detectWebGpuCapability(nav);

  assert.equal(capability.status, "unsupported");
  assert.match((capability as { reason: string }).reason, /WebGPU/);
});

test("does not imply the 3D viewer itself is unsupported", async () => {
  const nav: WebGpuCapableNavigator = {};

  const capability = await detectWebGpuCapability(nav);

  assert.equal(capability.status, "unsupported");
  const reason = (capability as { reason: string }).reason;
  assert.doesNotMatch(reason, /viewer.{0,20}(unsupported|unavailable|disabled)/i);
});

test("reports unsupported when requestAdapter resolves to null", async () => {
  const nav: WebGpuCapableNavigator = {
    gpu: { requestAdapter: async () => null },
  };

  const capability = await detectWebGpuCapability(nav);

  assert.equal(capability.status, "unsupported");
});

test("reports unsupported when requestAdapter rejects", async () => {
  const nav: WebGpuCapableNavigator = {
    gpu: {
      requestAdapter: async () => {
        throw new Error("adapter request failed");
      },
    },
  };

  const capability = await detectWebGpuCapability(nav);

  assert.equal(capability.status, "unsupported");
});
