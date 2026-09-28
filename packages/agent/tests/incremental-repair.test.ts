import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelPlan } from "../../domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import { ModelPlanGenerationError, generateModelPlan } from "../src/generate-model-plan.ts";
import { createSceneGenerationCounters, generateScene } from "../src/generate-scene.ts";
import { MockLLMProvider } from "../src/mock-provider.ts";
import type { PlanValidationFailure } from "../src/plan-diagnostics.ts";

const EMPTY_SPEC: ModelSpec = {
  schemaVersion: "1.0",
  projectId: "prj_kitchen",
  revision: 0,
  units: "mm",
  scene: { displayScale: 1 },
  objects: [],
};

function part(index: number): Record<string, unknown> {
  return {
    op: "create_object",
    id: `part_${index}`,
    name: `Kitchen part ${index}`,
    kind: "box",
    dimensions: { width: 100, height: 100, depth: 100 },
    position: [index * 200, 50, 0],
    color: "#dddddd",
  };
}

function kitchen(count: number, replace?: (operation: Record<string, unknown>, index: number) => Record<string, unknown>) {
  return {
    intent: "create_model",
    operations: Array.from({ length: count }, (_unused, index) => (replace ? replace(part(index), index) : part(index))),
  };
}

const WITH_GLASS_WINDOW = (operation: Record<string, unknown>, index: number) =>
  index === 5 ? { ...operation, name: "SECRET free text window", transparency: 0.6 } : operation;

test("a schema failure names the operation and property, and the model gets its own plan back", async () => {
  const failures: PlanValidationFailure[] = [];
  const provider = new MockLLMProvider([kitchen(40, WITH_GLASS_WINDOW), kitchen(40)]);

  const plan = await generateModelPlan({
    provider,
    request: "Crie uma cozinha moderna completa",
    modelSpec: EMPTY_SPEC,
    onValidationFailure: (failure) => failures.push(failure),
  });

  assert.equal(plan.operations.length, 40);
  assert.deepEqual(failures, ["schema"]);
  const repair = provider.calls[1]?.messages ?? [];
  assert.equal(repair.at(-2)?.role, "assistant");
  assert.equal(JSON.parse(repair.at(-2)?.content ?? "{}").operations.length, 40);
  const instruction = repair.at(-1)?.content ?? "";
  assert.match(
    instruction,
    /- operations\[5\] \(create_object part_5\): property 'transparency' is not allowed; set transparency with a separate set_material operation/,
  );
  assert.match(instruction, /keep every other operation exactly as it was -- do not remove, merge, or simplify parts/);
  assert.doesNotMatch(instruction, /required property 'target'|SECRET/);
});

test("a correction that drops most of the rejected plan is refused instead of replacing the scene", async () => {
  const failures: PlanValidationFailure[] = [];
  const provider = new MockLLMProvider([kitchen(40, WITH_GLASS_WINDOW), kitchen(2)]);

  await assert.rejects(
    () => generateModelPlan({
      provider,
      request: "Crie uma cozinha moderna completa",
      modelSpec: EMPTY_SPEC,
      onValidationFailure: (failure) => failures.push(failure),
    }),
    (error: unknown) =>
      error instanceof ModelPlanGenerationError && /kept only 2 of 40 operations/.test(error.message) && !/SECRET/.test(error.message),
  );
  assert.deepEqual(failures, ["schema", "dropped-operations"]);
});

test("small plans and clarify answers are exempt from the retention check", async () => {
  const shrunk = await generateModelPlan({
    provider: new MockLLMProvider([kitchen(3, (op, i) => (i === 0 ? { ...op, color: "white" } : op)), kitchen(1)]),
    request: "three boxes",
    modelSpec: EMPTY_SPEC,
  });
  assert.equal(shrunk.operations.length, 1);

  const question = { intent: "clarify", operations: [{ op: "clarify", question: "Open or closed shelves?" }] };
  const clarified = await generateModelPlan({
    provider: new MockLLMProvider([kitchen(10, WITH_GLASS_WINDOW), question]),
    request: "a kitchen",
    modelSpec: EMPTY_SPEC,
  });
  assert.equal(clarified.operations[0]?.op, "clarify");
});

test("a domain failure is located on the offending operation", async () => {
  const cone = (operation: Record<string, unknown>, index: number) =>
    index === 7 ? { ...operation, id: "pendant_lamp", kind: "cone", dimensions: { radius: 150, thickness: 5 } } : operation;
  const provider = new MockLLMProvider([kitchen(12, cone), kitchen(12)]);

  await generateModelPlan({ provider, request: "a kitchen", modelSpec: EMPTY_SPEC });

  assert.match(
    provider.calls[1]?.messages.at(-1)?.content ?? "",
    /- operations\[7\] \(create_object pendant_lamp\): cone requires dimensions \["bottomRadius","height"\]/,
  );
});

test("an invalid color is reported on its operation without echoing the value", async () => {
  const broken = kitchen(6, (operation, index) => {
    if (index === 2) return { op: "translate_object", target: "ghost_part", delta: [0, 10, 0] };
    if (index === 4) return { ...operation, color: "silver" };
    return operation;
  });
  const provider = new MockLLMProvider([broken, kitchen(6)]);

  await generateModelPlan({ provider, request: "a kitchen", modelSpec: EMPTY_SPEC });

  const instruction = provider.calls[1]?.messages.at(-1)?.content ?? "";
  assert.match(instruction, /operations\[4\] \(create_object part_4\): color must be a 6-digit hexadecimal color/);
  assert.doesNotMatch(instruction, /silver/);
});

test("unparsable output keeps the plain repair request without an assistant turn", async () => {
  const provider = new MockLLMProvider(["not json{{{", kitchen(2)]);

  await generateModelPlan({ provider, request: "two boxes", modelSpec: EMPTY_SPEC });

  const repair = provider.calls[1]?.messages ?? [];
  assert.notEqual(repair.at(-2)?.role, "assistant");
  assert.match(repair.at(-1)?.content ?? "", /Your previous response was invalid:\n- malformed or unparsable output/);
});

test("an apply rejection sends the rejected plan back and refuses a collapsed correction", async () => {
  const applied: ModelPlan[] = [];
  const counters = createSceneGenerationCounters();
  const provider = new MockLLMProvider([kitchen(20), kitchen(2)]);

  await assert.rejects(
    () => generateScene({
      provider,
      request: "a kitchen",
      modelSpec: EMPTY_SPEC,
      counters,
      describeRepairableApplyError: () => "UNINTENDED_OVERLAP: 'Part 3' (part_3) intersects 'Part 4' (part_4)",
      applyPlan: async (plan) => {
        applied.push(plan);
        throw new Error("overlap");
      },
    }),
    /kept only 2 of 20 operations/,
  );

  const repair = provider.calls[1]?.messages ?? [];
  assert.equal(repair.at(-2)?.role, "assistant");
  assert.equal(JSON.parse(repair.at(-2)?.content ?? "{}").operations.length, 20);
  assert.match(repair.at(-1)?.content ?? "", /UNINTENDED_OVERLAP.*keep every other operation/s);
  assert.equal(applied.length, 1);
  assert.deepEqual(counters.validationFailures, { "dropped-operations": 1 });
});

test("dimensions given with another kind's keys or aliases are normalized without a repair call", async () => {
  const lamp = (id: string, kind: string, dimensions: Record<string, number>) =>
    ({ op: "create_object", id, name: id, kind, dimensions, position: [0, 2000, 0], color: "#ffffff" });
  const provider = new MockLLMProvider([{
    intent: "create_model",
    operations: [
      lamp("pendente_1", "sphere", { width: 300, height: 250, depth: 300 }),
      lamp("pendente_2", "sphere", { diameter: 280 }),
      lamp("table", "box", { x: 1800, y: 750, z: 900 }),
      lamp("stool_leg", "cylinder", { width: 40, height: 650, depth: 40 }),
      lamp("hood", "cone", { radius: 300, height: 400 }),
      lamp("counter", "box", { width: 2400, height: 900, length: 600 }),
      lamp("glass", "cylinder", { diameter: 80, height: 120 }),
      lamp("knob", "box", { radius: 20 }),
    ],
  }]);

  const plan = await generateModelPlan({ provider, request: "a kitchen", modelSpec: EMPTY_SPEC });

  assert.equal(provider.calls.length, 1);
  assert.deepEqual(
    plan.operations.map((operation) => (operation.op === "create_object" ? operation.dimensions : null)),
    [
      { radius: 125 },
      { radius: 140 },
      { width: 1800, height: 750, depth: 900 },
      { radius: 20, height: 650 },
      { bottomRadius: 300, height: 400 },
      { width: 2400, height: 900, depth: 600 },
      { radius: 40, height: 120 },
      { width: 40, height: 40, depth: 40 },
    ],
  );
});
