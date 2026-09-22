import assert from "node:assert/strict";
import { test } from "node:test";

import { MockLLMProvider, type MockResponse } from "../../../../packages/agent/src/mock-provider.ts";
import type { ModelSpec } from "../../../../packages/domain/ts/src/model-spec.ts";

import type { ApplyPlanRequestBody, ApplyPlanResponse } from "../../src/api/client.ts";
import { ChatController, type AgentProvider, type ChatApi } from "../../src/chat/ChatController.ts";
import type { AgentStatus } from "../../src/chat/types.ts";

function emptySpec(revision = 0): ModelSpec {
  return {
    schemaVersion: "1.0",
    projectId: "prj_test",
    revision,
    units: "mm",
    scene: { displayScale: 1 },
    objects: [],
  };
}

function makeFakeProvider(
  responses: readonly MockResponse[],
  initialState: AgentStatus = { phase: "ready" },
): { provider: AgentProvider; mock: MockLLMProvider } {
  const mock = new MockLLMProvider(responses);
  const state = initialState;
  const listeners = new Set<(next: AgentStatus) => void>();
  const provider: AgentProvider = {
    id: mock.id,
    isAvailable: () => mock.isAvailable(),
    initialize: () => mock.initialize(),
    generateStructured: (messages, schema, options) => mock.generateStructured(messages, schema, options),
    cancel: () => mock.cancel(),
    getState: () => state,
    onStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { provider, mock };
}

function makeFakeApi(
  initialSpec: ModelSpec,
  applyResult?: (body: ApplyPlanRequestBody) => ApplyPlanResponse,
): { api: ChatApi; applyCalls: ApplyPlanRequestBody[] } {
  const applyCalls: ApplyPlanRequestBody[] = [];
  const api: ChatApi = {
    createProject: async () => initialSpec,
    applyPlan: async (_projectId, body) => {
      applyCalls.push(body);
      if (!applyResult) throw new Error("applyPlan should not be called in this test");
      return applyResult(body);
    },
    resolveArtifactUrl: (relativeUrl) => `http://test${relativeUrl}`,
  };
  return { api, applyCalls };
}

const CREATE_CUBE_PLAN = {
  intent: "create_model",
  operations: [
    { op: "create_object", name: "Cube", kind: "box", dimensions: { width: 10, height: 10, depth: 10 }, color: "#ff0000" },
  ],
};

test("a successful request updates modelSpec/previewUrl and appends an assistant message", async () => {
  const spec = emptySpec(0);
  const { provider } = makeFakeProvider([CREATE_CUBE_PLAN]);
  const { api, applyCalls } = makeFakeApi(spec, () => ({
    projectId: "prj_test",
    revision: 1,
    modelSpec: { ...spec, revision: 1 },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: { url: "/api/projects/prj_test/artifacts/html?revision=1" },
    artifacts: [{ format: "html", available: true }],
  }));
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("create a red cube");

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0]?.expectedRevision, 0);
  const state = controller.getState();
  assert.equal(state.modelSpec?.revision, 1);
  assert.equal(state.previewUrl, "http://test/api/projects/prj_test/artifacts/html?revision=1");
  assert.equal(state.isBusy, false);
  assert.deepEqual(
    state.messages.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.match(state.messages[1]?.text ?? "", /revision 1/);
});

test("a generation failure leaves modelSpec/previewUrl untouched and surfaces an error message", async () => {
  const spec = emptySpec(0);
  // Malformed JSON twice: generateModelPlan's one-shot repair retry also fails, so it throws.
  const { provider } = makeFakeProvider(["not json{{{", "still not json{{{"]);
  const { api, applyCalls } = makeFakeApi(spec);
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("do something ambiguous");

  assert.equal(applyCalls.length, 0);
  const state = controller.getState();
  assert.equal(state.modelSpec?.revision, 0);
  assert.equal(state.previewUrl, null);
  assert.equal(state.isBusy, false);
  assert.deepEqual(
    state.messages.map((m) => m.role),
    ["user", "error"],
  );
});

test("a pure clarify plan is surfaced as an assistant question and never reaches applyPlan", async () => {
  const spec = emptySpec(0);
  const question = "There are two objects named \"Support\" -- which one do you mean?";
  const { provider } = makeFakeProvider([{ intent: "clarify", operations: [{ op: "clarify", question }] }]);
  const { api, applyCalls } = makeFakeApi(spec);
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("make the support bigger");

  assert.equal(applyCalls.length, 0);
  const state = controller.getState();
  assert.equal(state.modelSpec?.revision, 0);
  assert.deepEqual(
    state.messages.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.equal(state.messages[1]?.text, question);
});

test("a second send while one is already in flight is a no-op (duplicate-submit guard)", async () => {
  const spec = emptySpec(0);
  const { provider, mock } = makeFakeProvider([CREATE_CUBE_PLAN]);
  const { api, applyCalls } = makeFakeApi(spec, () => ({
    projectId: "prj_test",
    revision: 1,
    modelSpec: { ...spec, revision: 1 },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: { url: "/api/projects/prj_test/artifacts/html?revision=1" },
    artifacts: [{ format: "html", available: true }],
  }));
  const controller = new ChatController(provider, api);
  await controller.initialize();

  const first = controller.sendMessage("create a red cube");
  const second = controller.sendMessage("create a second cube");
  await Promise.all([first, second]);

  assert.equal(mock.calls.length, 1);
  assert.equal(applyCalls.length, 1);
  assert.equal(
    controller.getState().messages.filter((m) => m.role === "user").length,
    1,
  );
});

test("canSend reflects an unsupported local AI state", async () => {
  const spec = emptySpec(0);
  const { provider } = makeFakeProvider([], { phase: "unsupported", reason: "No WebGPU adapter." });
  const { api } = makeFakeApi(spec);
  const controller = new ChatController(provider, api);
  await controller.initialize();

  const gate = controller.canSend();

  assert.equal(gate.canSend, false);
  if (!gate.canSend) assert.equal(gate.reason, "No WebGPU adapter.");
});
