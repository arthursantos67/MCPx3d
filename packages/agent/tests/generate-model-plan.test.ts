import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import { MockLLMProvider } from "../src/mock-provider.ts";
import { ModelPlanGenerationError, generateModelPlan } from "../src/generate-model-plan.ts";

const SPEC_WITH_SEAT: ModelSpec = {
  schemaVersion: "1.0",
  projectId: "proj_1",
  revision: 1,
  units: "mm",
  scene: { displayScale: 1 },
  objects: [
    {
      id: "seat",
      name: "Seat",
      kind: "box",
      dimensions: { width: 500, height: 40, depth: 500 },
      transform: { position: [0, 450, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      material: { color: "#8b5a2b" },
    },
  ],
};

const EMPTY_SPEC: ModelSpec = {
  ...SPEC_WITH_SEAT,
  objects: [],
};

test('"create a red cube" returns a valid create operation', async () => {
  const provider = new MockLLMProvider([
    {
      intent: "create_model",
      operations: [
        { op: "create_object", name: "Cube", kind: "box", dimensions: { width: 10, height: 10, depth: 10 }, color: "#ff0000" },
      ],
    },
  ]);

  const plan = await generateModelPlan({ provider, request: "create a red cube", modelSpec: EMPTY_SPEC });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0]?.op, "create_object");
  assert.equal(provider.calls.length, 1);
});

test("a modification targeting an existing id succeeds on the first attempt", async () => {
  const provider = new MockLLMProvider([
    { intent: "modify_model", operations: [{ op: "set_dimensions", target: "seat", dimensions: { width: 600 } }] },
  ]);

  const plan = await generateModelPlan({ provider, request: "make the seat wider", modelSpec: SPEC_WITH_SEAT });

  assert.equal(plan.operations[0]?.op, "set_dimensions");
  assert.equal(provider.calls.length, 1);
});

test("a modification targeting an unknown id is repaired once, then accepted if corrected", async () => {
  const provider = new MockLLMProvider([
    { intent: "modify_model", operations: [{ op: "set_dimensions", target: "ghost", dimensions: { width: 600 } }] },
    { intent: "modify_model", operations: [{ op: "set_dimensions", target: "seat", dimensions: { width: 600 } }] },
  ]);

  const plan = await generateModelPlan({ provider, request: "make it wider", modelSpec: SPEC_WITH_SEAT });

  assert.equal(provider.calls.length, 2);
  assert.equal(plan.operations[0]?.op, "set_dimensions");
  if (plan.operations[0]?.op === "set_dimensions") {
    assert.equal(plan.operations[0].target, "seat");
  }
  assert.match(provider.calls[1]?.messages.at(-1)?.content ?? "", /unknown object id/);
});

test("a modification that still targets an unknown id after repair throws an actionable error", async () => {
  const provider = new MockLLMProvider([
    { intent: "modify_model", operations: [{ op: "set_dimensions", target: "ghost", dimensions: { width: 600 } }] },
    { intent: "modify_model", operations: [{ op: "set_dimensions", target: "still_ghost", dimensions: { width: 600 } }] },
  ]);

  await assert.rejects(
    () => generateModelPlan({ provider, request: "make it wider", modelSpec: SPEC_WITH_SEAT }),
    (error: unknown) => {
      assert.ok(error instanceof ModelPlanGenerationError);
      assert.match(error.message, /unknown object id/);
      return true;
    },
  );
  assert.equal(provider.calls.length, 2);
});

test("a create_object may target its own caller-proposed id later in the same plan", async () => {
  const provider = new MockLLMProvider([
    {
      intent: "create_model",
      operations: [
        { op: "create_object", id: "leg1", name: "Leg", kind: "cylinder", dimensions: { radius: 5, height: 100 } },
        { op: "rename_object", target: "leg1", name: "Front Leg" },
      ],
    },
  ]);

  const plan = await generateModelPlan({ provider, request: "create a leg and rename it", modelSpec: EMPTY_SPEC });

  assert.equal(plan.operations.length, 2);
  assert.equal(provider.calls.length, 1);
});

test("a create_object with the wrong dimension keys for its kind is repaired once, then accepted if corrected", async () => {
  const provider = new MockLLMProvider([
    { intent: "create_model", operations: [{ op: "create_object", name: "Table", kind: "box", dimensions: { x: 1200, y: 750, z: 700 } }] },
    { intent: "create_model", operations: [{ op: "create_object", name: "Table", kind: "box", dimensions: { width: 1200, height: 750, depth: 700 } }] },
  ]);

  const plan = await generateModelPlan({ provider, request: "create a table", modelSpec: EMPTY_SPEC });

  assert.equal(provider.calls.length, 2);
  assert.equal(plan.operations[0]?.op, "create_object");
  if (plan.operations[0]?.op === "create_object") {
    assert.deepEqual(plan.operations[0].dimensions, { width: 1200, height: 750, depth: 700 });
  }
  assert.match(provider.calls[1]?.messages.at(-1)?.content ?? "", /box requires dimensions/);
});

test("an unknown operation name is rejected by the schema and repaired once", async () => {
  const provider = new MockLLMProvider([
    { intent: "modify_model", operations: [{ op: "explode_object", target: "seat" }] },
    { intent: "modify_model", operations: [{ op: "delete_object", target: "seat" }] },
  ]);

  const plan = await generateModelPlan({ provider, request: "get rid of it", modelSpec: SPEC_WITH_SEAT });

  assert.equal(plan.operations[0]?.op, "delete_object");
  assert.equal(provider.calls.length, 2);
});

test("an unknown operation name that persists after repair throws instead of guessing", async () => {
  const provider = new MockLLMProvider([
    { intent: "modify_model", operations: [{ op: "explode_object", target: "seat" }] },
    { intent: "modify_model", operations: [{ op: "explode_object", target: "seat" }] },
  ]);

  await assert.rejects(() => generateModelPlan({ provider, request: "get rid of it", modelSpec: SPEC_WITH_SEAT }));
  assert.equal(provider.calls.length, 2);
});

test("malformed JSON gets exactly one format-repair retry, then succeeds if corrected", async () => {
  const provider = new MockLLMProvider([
    "not json{{{",
    JSON.stringify({ intent: "no_change", operations: [{ op: "no_change" }] }),
  ]);

  const plan = await generateModelPlan({ provider, request: "hello", modelSpec: EMPTY_SPEC });

  assert.equal(plan.operations[0]?.op, "no_change");
  assert.equal(provider.calls.length, 2);
});

test("malformed JSON that persists after one repair throws instead of retrying further", async () => {
  const provider = new MockLLMProvider(["not json{{{", "still not json"]);

  await assert.rejects(() => generateModelPlan({ provider, request: "hello", modelSpec: EMPTY_SPEC }));
  assert.equal(provider.calls.length, 2);
});

test("an extra field on an operation (e.g. an executable-code field) is rejected by the closed schema", async () => {
  const provider = new MockLLMProvider([
    {
      intent: "create_model",
      operations: [
        {
          op: "create_object",
          name: "Cube",
          kind: "box",
          dimensions: { width: 10, height: 10, depth: 10 },
          script: "alert(1)",
        },
      ],
    },
    {
      intent: "create_model",
      operations: [{ op: "create_object", name: "Cube", kind: "box", dimensions: { width: 10, height: 10, depth: 10 } }],
    },
  ]);

  const plan = await generateModelPlan({ provider, request: "create a cube", modelSpec: EMPTY_SPEC });

  assert.equal(provider.calls.length, 2);
  assert.deepEqual(Object.keys(plan.operations[0] as unknown as Record<string, unknown>), [
    "op",
    "name",
    "kind",
    "dimensions",
  ]);
});

test("passes recent messages and prior validation diagnostics through to the provider", async () => {
  const provider = new MockLLMProvider([{ intent: "no_change", operations: [{ op: "no_change" }] }]);

  await generateModelPlan({
    provider,
    request: "try again",
    modelSpec: EMPTY_SPEC,
    recentMessages: [
      { role: "user", content: "create a cube" },
      { role: "assistant", content: "done" },
    ],
    priorValidationDiagnostics: "dimensions must be positive",
  });

  const sent = provider.calls[0]?.messages ?? [];
  assert.equal(sent[0]?.role, "system");
  assert.equal(sent[1]?.content, "create a cube");
  assert.equal(sent[2]?.content, "done");
  assert.match(sent[3]?.content ?? "", /try again/);
  assert.match(sent[3]?.content ?? "", /dimensions must be positive/);
});
