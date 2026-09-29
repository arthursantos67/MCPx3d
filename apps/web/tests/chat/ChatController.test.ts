import assert from "node:assert/strict";
import { test } from "node:test";

import { MockLLMProvider, mockCompletion, type MockResponse } from "../../../../packages/agent/src/mock-provider.ts";
import type { ModelSpec } from "../../../../packages/domain/ts/src/model-spec.ts";
import type { CadPartSpec } from "../../../../packages/domain/ts/src/cad-part.ts";

import { ApiError, type ApplyPlanRequestBody, type ApplyPlanResponse, type Recipe } from "../../src/api/client.ts";
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
    deleteProject: async () => {},
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

const REPAIRED_CUBE_PLAN = {
  intent: "create_model",
  operations: [
    {
      op: "create_object",
      name: "Cube",
      kind: "box",
      dimensions: { width: 10, height: 10, depth: 10 },
      position: [20, 0, 0],
      color: "#ff0000",
    },
  ],
};

test("CAD chat uses the configured provider without changing the Web3D scene", async () => {
  const cadSpec: CadPartSpec = {
    schemaVersion: "2.0", units: "mm", partId: "plate_1",
    base: { kind: "extruded_rectangle", width: 100, depth: 80, thickness: 10 },
    features: [{ kind: "through_hole", x: 10, y: 5, diameter: 12 }],
  };
  const { provider, mock } = makeFakeProvider([{
    decision: "edit", question: "", operations: [{ op: "set_parameter", parameter: "width", value: 120 }],
  }]);
  const { api, applyCalls } = makeFakeApi(emptySpec());
  const controller = new ChatController(provider, api);
  await controller.initialize();

  const outcome = await controller.planCadEdit("set width to 120 mm", cadSpec);

  assert.equal(outcome.kind, "edit");
  assert.equal(mock.calls.length, 1);
  assert.equal(applyCalls.length, 0);
  assert.equal(controller.getState().isBusy, false);
  assert.equal(controller.getState().modelSpec?.revision, 0);
});

test("CAD creation uses the configured provider before a CAD project exists", async () => {
  const spec = {
    schemaVersion: "2.1", units: "mm", partId: "plate_from_prompt",
    base: { kind: "extruded_rectangle", width: 120, depth: 80, thickness: 10 },
    features: [{ kind: "through_hole", id: "hole_1", x: 0, y: 0, diameter: 8 }],
    cornerChamfer: 4,
  };
  const { provider, mock } = makeFakeProvider([{
    decision: "create", spec, question: "", assumptions: ["Thickness 10 mm was inferred."],
  }]);
  const { api, applyCalls } = makeFakeApi(emptySpec());
  const controller = new ChatController(provider, api);
  await controller.initialize();

  const outcome = await controller.planCadCreate("Crie uma placa com um furo");

  assert.equal(outcome.kind, "create");
  assert.equal(mock.calls.length, 1);
  assert.equal(applyCalls.length, 0);
  assert.equal(controller.getState().isBusy, false);
});

test("CAD programs are checked by the API and an unreachable checker does not block generation", async () => {
  const program = {
    schemaVersion: "3.0", units: "mm", partId: "block",
    steps: [{ id: "body", op: "base", shape: "box", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 40, depth: 20, height: 10 }],
  };
  const { provider } = makeFakeProvider([{ decision: "create", spec: program, question: "", assumptions: [] }]);
  const { api } = makeFakeApi(emptySpec());
  const checked: unknown[] = [];
  const controller = new ChatController(provider, {
    ...api,
    checkCadProgram: async (spec) => { checked.push(spec); throw new ApiError(503, { code: "CAD_ENGINE_UNAVAILABLE", message: "offline" }); },
  });
  await controller.initialize();

  const outcome = await controller.planCadProgram("Crie um bloco");

  assert.equal(outcome.kind, "create");
  if (outcome.kind === "create") assert.equal(outcome.geometryIssue, undefined);
  assert.deepEqual(checked, [program]);
  assert.equal(controller.getState().isBusy, false);
});

test("an exact recipe request applies saved geometry without calling the provider", async () => {
  const spec = emptySpec();
  const { provider, mock } = makeFakeProvider([]);
  const { api, applyCalls } = makeFakeApi(spec, () => ({
    projectId: spec.projectId,
    revision: 1,
    modelSpec: { ...spec, revision: 1 },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: { url: `/api/projects/${spec.projectId}/artifacts/html?revision=1` },
    artifacts: [],
    correlationId: null,
  }));
  const recipe: Recipe = {
    id: "builtin_table", schemaVersion: "1.0", name: "Mesa de jantar", units: "mm", displayScale: 1, objectCount: 1,
    plan: { intent: "create_table", operations: [{ op: "create_object", id: "top", name: "Tampo", kind: "box", dimensions: { width: 1200, height: 50, depth: 700 } }] },
  };
  api.matchRecipe = async () => recipe;
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("quero uma mesa");

  assert.equal(mock.calls.length, 0);
  assert.equal(applyCalls.length, 1);
  assert.deepEqual(applyCalls[0]?.plan, recipe.plan);
  assert.equal(controller.getState().modelSpec?.revision, 1);
  assert.match(controller.getState().messages[1]?.text ?? "", /Mesa de jantar/);
});

test("a specific request without a recipe continues through the planner", async () => {
  const spec = emptySpec();
  const { provider, mock } = makeFakeProvider([CREATE_CUBE_PLAN]);
  const { api, applyCalls } = makeFakeApi(spec, () => ({
    projectId: spec.projectId, revision: 1, modelSpec: { ...spec, revision: 1 },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: null, artifacts: [], correlationId: null,
  }));
  api.matchRecipe = async () => null;
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("mesa com furo de 20 mm");

  assert.equal(mock.calls.length, 1);
  assert.equal(applyCalls.length, 1);
});

test("an explicit no-overlap request removes model exemptions before applying", async () => {
  const spec = emptySpec();
  const plan = {
    intent: "create_model",
    operations: [{
      op: "create_object", id: "cabinet", name: "Cabinet", kind: "box",
      dimensions: { width: 600, height: 900, depth: 600 }, allowOverlap: true,
    }],
  };
  const { provider } = makeFakeProvider([plan]);
  const { api, applyCalls } = makeFakeApi(spec, () => ({
    projectId: spec.projectId, revision: 1, modelSpec: { ...spec, revision: 1 },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: null, artifacts: [], correlationId: null,
  }));
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("Crie uma cozinha sem sobreposição de objetos");

  assert.equal(applyCalls.length, 1);
  assert.equal((applyCalls[0]?.plan.operations[0] as { allowOverlap?: boolean }).allowOverlap, false);
  assert.equal(applyCalls[0]?.resolveOverlaps, undefined);
});

test("a saved recipe remains usable when WebGPU is unavailable", async () => {
  const spec = emptySpec();
  const { provider, mock } = makeFakeProvider([], { phase: "unsupported", reason: "No WebGPU adapter." });
  const { api, applyCalls } = makeFakeApi(spec, () => ({
    projectId: spec.projectId, revision: 1, modelSpec: { ...spec, revision: 1 },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: null, artifacts: [], correlationId: null,
  }));
  api.matchRecipe = async () => ({
    id: "builtin_table", schemaVersion: "1.0", name: "Mesa de jantar", units: "mm", displayScale: 1,
    objectCount: 1, plan: { intent: "table", operations: [{ op: "create_object", id: "top", name: "Tampo", kind: "box", dimensions: { width: 100, height: 10, depth: 50 } }] },
  });
  const controller = new ChatController(provider, api);
  await controller.initialize();
  assert.equal(controller.canSend().canSend, true);

  await controller.sendMessage("quero uma mesa");

  assert.equal(mock.calls.length, 0);
  assert.equal(applyCalls.length, 1);
  assert.equal(controller.getState().requestStatus, "succeeded");
  assert.equal(controller.getState().isBusy, false);
  assert.equal(controller.getState().pipelineStage, "ready");
});

test("manifest import replaces the project revision and clears old conversation context", async () => {
  const spec = emptySpec();
  const { provider } = makeFakeProvider([]);
  const { api } = makeFakeApi(spec);
  api.importManifest = async (_projectId, expectedRevision) => ({
    projectId: spec.projectId,
    revision: expectedRevision + 1,
    modelSpec: { ...spec, revision: expectedRevision + 1, scene: { ...spec.scene, title: "Imported bracket" } },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: { url: "/api/projects/prj_test/artifacts/html?revision=1" },
    artifacts: [],
    correlationId: "import-1",
  });
  const controller = new ChatController(provider, api);
  await controller.initialize();
  await controller.importManifest('{"schemaVersion":"1.0"}');

  assert.equal(controller.getState().modelSpec?.revision, 1);
  assert.equal(controller.getState().projectName, "Imported bracket");
  assert.equal(controller.getState().messages.length, 1);
  assert.match(controller.getState().messages[0]?.text ?? "", /Imported bracket/);
});

test("initialization resumes a live project with its preview", async () => {
  const spec = emptySpec(4);
  const { provider } = makeFakeProvider([]);
  const { api } = makeFakeApi(emptySpec());
  let created = false;
  api.createProject = async () => { created = true; return emptySpec(); };
  api.resumeProject = async () => ({
    projectId: spec.projectId, revision: spec.revision, modelSpec: spec,
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: { url: `/api/projects/${spec.projectId}/artifacts/html?revision=4` },
    artifacts: [{ format: "x3d", available: true, reason: null }],
    correlationId: null,
  });
  const controller = new ChatController(provider, api);

  await controller.initialize();

  assert.equal(created, false);
  assert.equal(controller.getState().modelSpec?.revision, 4);
  assert.match(controller.getState().previewUrl ?? "", /revision=4/);
  assert.equal(controller.getState().artifacts[0]?.format, "x3d");
});

test("failed manifest import keeps the last validated revision", async () => {
  const spec = emptySpec(2);
  const { provider } = makeFakeProvider([]);
  const { api } = makeFakeApi(spec);
  api.importManifest = async () => { throw new ApiError(400, { code: "INVALID_MANIFEST", message: "Invalid file" }); };
  const controller = new ChatController(provider, api);
  await controller.initialize();
  await controller.importManifest('bad');

  assert.equal(controller.getState().modelSpec?.revision, 2);
  assert.equal(controller.getState().requestStatus, "failed");
  assert.equal(controller.getState().messages.at(-1)?.role, "error");
});

test("a successful request updates modelSpec/previewUrl and appends an assistant message", async () => {
  const spec = emptySpec(0);
  const { provider } = makeFakeProvider([CREATE_CUBE_PLAN]);
  const { api, applyCalls } = makeFakeApi(spec, () => ({
    projectId: "prj_test",
    revision: 1,
    modelSpec: { ...spec, revision: 1 },
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: { url: "/api/projects/prj_test/artifacts/html?revision=1" },
    artifacts: [{ format: "html", available: true, reason: null }],
    correlationId: "request-1",
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

test("a rejected geometry plan is regenerated once with the API validation diagnostic", async () => {
  const spec = emptySpec(0);
  const { provider, mock } = makeFakeProvider([CREATE_CUBE_PLAN, REPAIRED_CUBE_PLAN]);
  let applyAttempt = 0;
  const { api, applyCalls } = makeFakeApi(spec, () => {
    applyAttempt += 1;
    if (applyAttempt === 1) {
      throw new ApiError(422, {
        code: "UNINTENDED_OVERLAP",
        message: "'Table top' (table_top) intersects 'Backrest' (chair_backrest); move one part.",
        correlationId: "request-overlap",
      });
    }
    return {
      projectId: "prj_test",
      revision: 1,
      modelSpec: { ...spec, revision: 1 },
      validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
      preview: { url: "/api/projects/prj_test/artifacts/html?revision=1" },
      artifacts: [{ format: "html", available: true, reason: null }],
      correlationId: "request-repaired",
    };
  });
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("create a table and chair");

  assert.equal(mock.calls.length, 2);
  assert.equal(applyCalls.length, 2);
  assert.deepEqual(applyCalls[0]?.plan, CREATE_CUBE_PLAN);
  assert.deepEqual(applyCalls[1]?.plan, REPAIRED_CUBE_PLAN);
  const repairRequest = mock.calls[1]?.messages.at(-1)?.content ?? "";
  assert.match(repairRequest, /UNINTENDED_OVERLAP/);
  assert.match(repairRequest, /table_top/);
  assert.equal(controller.getState().requestStatus, "succeeded");
  assert.deepEqual(controller.getState().messages.map((message) => message.role), ["user", "assistant"]);
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
    artifacts: [{ format: "html", available: true, reason: null }],
    correlationId: "request-1",
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

test("a failed update preserves the valid preview and revision for retry", async () => {
  const spec = emptySpec(1);
  const { provider } = makeFakeProvider([CREATE_CUBE_PLAN]);
  const { api } = makeFakeApi(spec, () => {
    throw new ApiError(503, { code: "MCP_UNAVAILABLE", message: "MCP is unavailable.", correlationId: "request-2" });
  });
  const controller = new ChatController(provider, api);
  await controller.initialize();
  controller.setViewerStatus("ready");
  const previewUrl = "http://test/api/projects/prj_test/artifacts/html?revision=1";
  (controller as unknown as { patch: (state: object) => void }).patch({ previewUrl });

  await controller.sendMessage("make it larger");

  const state = controller.getState();
  assert.equal(state.modelSpec?.revision, 1);
  assert.equal(state.previewUrl, previewUrl);
  assert.equal(state.requestStatus, "failed");
  assert.equal(state.failureSource, "mcp");
  assert.equal(controller.canSend().canSend, true);
});

test("no_change keeps the current artifact and does not advance the revision", async () => {
  const spec = emptySpec(1);
  const previewUrl = "http://test/api/projects/prj_test/artifacts/html?revision=1";
  const { provider } = makeFakeProvider([{ intent: "no_change", operations: [{ op: "no_change", reason: "Already correct." }] }]);
  const { api } = makeFakeApi(spec, () => ({
    projectId: "prj_test",
    revision: 1,
    modelSpec: spec,
    validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
    preview: { url: "/api/projects/prj_test/artifacts/html?revision=1" },
    artifacts: [{ format: "html", available: true, reason: null }],
    correlationId: "request-3",
  }));
  const controller = new ChatController(provider, api);
  await controller.initialize();
  (controller as unknown as { patch: (state: object) => void }).patch({ previewUrl });

  await controller.sendMessage("leave it as it is");

  const state = controller.getState();
  assert.equal(state.modelSpec?.revision, 1);
  assert.equal(state.previewUrl, previewUrl);
  assert.equal(state.requestStatus, "no-change");
});

test("an expired project preserves the last scene until explicit recreation, then clears stale state", async () => {
  const spec = emptySpec(1);
  const { provider } = makeFakeProvider([CREATE_CUBE_PLAN]);
  const { api } = makeFakeApi(spec, () => {
    throw new ApiError(404, { code: "PROJECT_NOT_FOUND", message: "Project expired.", correlationId: "request-4" });
  });
  const controller = new ChatController(provider, api);
  await controller.initialize();
  (controller as unknown as { patch: (state: object) => void }).patch({
    previewUrl: "http://test/api/projects/prj_test/artifacts/html?revision=1",
  });

  await controller.sendMessage("change the cube");

  assert.equal(controller.getState().requestStatus, "session-expired");
  assert.equal(controller.getState().previewUrl, "http://test/api/projects/prj_test/artifacts/html?revision=1");
  assert.equal(controller.canSend().canSend, false);

  await controller.retryProject();

  assert.equal(controller.getState().projectError, null);
  assert.equal(controller.getState().previewUrl, null);
  assert.equal(controller.getState().messages.length, 0);
});

test("cancelling local inference never submits its completed plan", async () => {
  const spec = emptySpec(1);
  let resolveGeneration: ((value: unknown) => void) | undefined;
  let cancelCalls = 0;
  const provider: AgentProvider = {
    id: "deferred",
    isAvailable: async () => true,
    initialize: async () => {},
    generateStructured: async <T>() => new Promise<T>((resolve) => { resolveGeneration = resolve as (value: unknown) => void; }),
    cancel: async () => { cancelCalls += 1; },
    getState: () => ({ phase: "ready" }),
    onStateChange: () => () => {},
  };
  const { api, applyCalls } = makeFakeApi(spec);
  const controller = new ChatController(provider, api);
  await controller.initialize();

  const request = controller.sendMessage("create a red cube");
  controller.cancelGeneration();
  resolveGeneration?.(CREATE_CUBE_PLAN);
  await request;

  assert.equal(cancelCalls, 1);
  assert.equal(applyCalls.length, 0);
  assert.equal(controller.getState().modelSpec?.revision, 1);
  assert.equal(controller.getState().requestStatus, "cancelled");
  assert.equal(controller.getState().isBusy, false);
  assert.equal(controller.canSend().canSend, true);
});

test("cancelling an API request aborts it without replacing the current model", async () => {
  const spec = emptySpec(1);
  const { provider } = makeFakeProvider([CREATE_CUBE_PLAN]);
  let signalStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let aborted = false;
  const api: ChatApi = {
    createProject: async () => spec,
    applyPlan: async (_projectId, _body, signal) => new Promise<ApplyPlanResponse>((_resolve, reject) => {
      signalStarted();
      signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    }),
    deleteProject: async () => {},
    resolveArtifactUrl: (relativeUrl) => `http://test${relativeUrl}`,
  };
  const controller = new ChatController(provider, api);
  await controller.initialize();

  const request = controller.sendMessage("create a red cube");
  await started;
  controller.cancelGeneration();
  await request;

  assert.equal(aborted, true);
  assert.equal(controller.getState().modelSpec?.revision, 1);
  assert.equal(controller.getState().previewUrl, null);
  assert.equal(controller.getState().requestStatus, "cancelled");
  assert.equal(controller.getState().isBusy, false);
});

function cabinetBatch(from: number, count: number): Record<string, unknown> {
  return {
    intent: "create_model",
    operations: Array.from({ length: count }, (_unused, offset) => ({
      op: "create_object",
      id: `cabinet_${from + offset}`,
      name: `Cabinet ${from + offset}`,
      kind: "box",
      dimensions: { width: 600, height: 900, depth: 600 },
      position: [(from + offset) * 700, 450, 0],
      color: "#d9c7a7",
    })),
  };
}

const TRUNCATED_SECRET_KITCHEN = mockCompletion(
  '{"intent":"create_model","operations":[{"op":"create_object","id":"SECRET_RAW_OUTPUT","name":"Cabi',
  "length",
);

function committingApply(spec: ModelSpec, failOnCall?: number): (body: ApplyPlanRequestBody) => ApplyPlanResponse {
  let calls = 0;
  return (body) => {
    calls += 1;
    if (calls === failOnCall) {
      throw new ApiError(503, { code: "MCP_UNAVAILABLE", message: "MCP is unavailable.", correlationId: "request-batch" });
    }
    const revision = body.expectedRevision + 1;
    return {
      projectId: "prj_test",
      revision,
      modelSpec: { ...spec, revision },
      validation: { schemaValid: true, semanticValid: true, warnings: [], autofixes: [] },
      preview: { url: `/api/projects/prj_test/artifacts/html?revision=${revision}` },
      artifacts: [{ format: "html", available: true, reason: null }],
      correlationId: `request-${revision}`,
    };
  };
}

test("a truncated scene request continues in validated batches and records provider/model stats", async () => {
  const spec = emptySpec(0);
  const { provider } = makeFakeProvider([
    TRUNCATED_SECRET_KITCHEN,
    cabinetBatch(1, 12),
    cabinetBatch(13, 5),
    { intent: "no_change", operations: [{ op: "no_change", reason: "Done." }] },
  ]);
  const { api, applyCalls } = makeFakeApi(spec, committingApply(spec));
  const controller = new ChatController(provider, api);
  const batchLabels: number[] = [];
  controller.onChange(() => {
    const batch = controller.getState().sceneBatch?.batch;
    if (batch !== undefined && batchLabels.at(-1) !== batch) batchLabels.push(batch);
  });
  await controller.initialize();

  await controller.sendMessage("create a full kitchen");

  const state = controller.getState();
  assert.deepEqual(applyCalls.map((call) => [call.expectedRevision, call.plan.operations.length]), [[0, 12], [1, 5]]);
  assert.deepEqual(batchLabels, [1, 2, 3]);
  assert.equal(state.modelSpec?.revision, 2);
  assert.equal(state.previewUrl, "http://test/api/projects/prj_test/artifacts/html?revision=2");
  assert.equal(state.requestStatus, "succeeded");
  assert.equal(state.sceneBatch, null);
  assert.match(state.messages.at(-1)?.text ?? "", /2 validated batches; revision 2/);
  assert.doesNotMatch(JSON.stringify(state), /SECRET_RAW_OUTPUT/);
  assert.deepEqual(state.generationStats["mock/default"], {
    requests: 1,
    truncatedRequests: 1,
    recoveredRequests: 1,
    continuedRequests: 1,
    localRepairs: 0,
    formatRepairs: 0,
    applyRepairs: 0,
    finalValidScenes: 1,
    skippedBatches: 0,
    overlapResolutions: 0,
    validationFailures: { truncated: 1 },
  });
});

test("a failed batch reports the exact batch and keeps the preceding valid revision and preview", async () => {
  const spec = emptySpec(0);
  const { provider } = makeFakeProvider([TRUNCATED_SECRET_KITCHEN, cabinetBatch(1, 12), cabinetBatch(13, 5)]);
  const { api } = makeFakeApi(spec, committingApply(spec, 2));
  const controller = new ChatController(provider, api);
  await controller.initialize();

  await controller.sendMessage("create a full kitchen");

  const state = controller.getState();
  assert.equal(state.modelSpec?.revision, 1);
  assert.equal(state.previewUrl, "http://test/api/projects/prj_test/artifacts/html?revision=1");
  assert.equal(state.requestStatus, "failed");
  assert.equal(state.failureSource, "mcp");
  assert.equal(state.correlationId, "request-batch");
  assert.match(state.messages.at(-1)?.text ?? "", /Scene batch 2 failed: MCP is unavailable\..*\(ref request-batch\)/);
  assert.doesNotMatch(JSON.stringify(state), /SECRET_RAW_OUTPUT/);
  assert.equal(state.generationStats["mock/default"]?.recoveredRequests, 0);
  assert.equal(controller.canSend().canSend, true);
});

test("cancelling during a later batch keeps the committed batch as the active scene", async () => {
  const spec = emptySpec(0);
  let resolveSecondBatch: ((value: unknown) => void) | undefined;
  const mock = new MockLLMProvider([TRUNCATED_SECRET_KITCHEN, cabinetBatch(1, 12)]);
  const provider: AgentProvider = {
    id: "deferred",
    isAvailable: async () => true,
    initialize: async () => {},
    generateStructured: async <T>(...args: Parameters<AgentProvider["generateStructured"]>) =>
      mock.calls.length < 2
        ? mock.generateStructured<T>(...args)
        : new Promise<T>((resolve) => { resolveSecondBatch = resolve as (value: unknown) => void; }),
    cancel: async () => {},
    getState: () => ({ phase: "ready" }),
    onStateChange: () => () => {},
  };
  const { api, applyCalls } = makeFakeApi(spec, committingApply(spec));
  const controller = new ChatController(provider, api);
  await controller.initialize();

  const request = controller.sendMessage("create a full kitchen");
  while (resolveSecondBatch === undefined) await new Promise((resolve) => setImmediate(resolve));
  controller.cancelGeneration();
  resolveSecondBatch(cabinetBatch(13, 5));
  await request;

  const state = controller.getState();
  assert.equal(applyCalls.length, 1);
  assert.equal(state.modelSpec?.revision, 1);
  assert.equal(state.previewUrl, "http://test/api/projects/prj_test/artifacts/html?revision=1");
  assert.equal(state.requestStatus, "cancelled");
  assert.equal(state.sceneBatch, null);
});
