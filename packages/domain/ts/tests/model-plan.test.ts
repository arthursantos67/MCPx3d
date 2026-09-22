import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ModelPlanValidationError,
  validateModelPlanDomainRules,
  type ModelPlan,
} from "../src/model-plan.ts";
import type { PrimitiveKind } from "../src/model-spec.ts";
import { FIXTURES_DIR, loadJson } from "./support.ts";

test("valid create plan passes domain validation", () => {
  const plan = loadJson<ModelPlan>(FIXTURES_DIR, "model-plan", "valid-create.json");

  assert.doesNotThrow(() => validateModelPlanDomainRules(plan));
  assert.equal(plan.operations[0]?.op, "create_object");
});

test("valid modify plan targets existing ids", () => {
  const plan = loadJson<ModelPlan>(FIXTURES_DIR, "model-plan", "valid-modify.json");

  assert.doesNotThrow(() => validateModelPlanDomainRules(plan));
  const targets = plan.operations.map((op) => ("target" in op ? op.target : undefined));
  assert.deepEqual(targets.sort(), ["obj_leg1", "obj_seat1", "obj_sphere1"]);
});

test("set_material without color or transparency is rejected", () => {
  const plan: ModelPlan = {
    intent: "modify_model",
    operations: [{ op: "set_material", target: "obj_1" } as ModelPlan["operations"][number]],
  };

  assert.throws(() => validateModelPlanDomainRules(plan), ModelPlanValidationError);
});

test("scale_object factor of zero is rejected", () => {
  const plan: ModelPlan = {
    intent: "modify_model",
    operations: [{ op: "scale_object", target: "obj_1", factor: [1, 0, 1] }],
  };

  assert.throws(() => validateModelPlanDomainRules(plan), ModelPlanValidationError);
});

test("create_object with the wrong dimension keys for its kind is rejected", () => {
  const plan: ModelPlan = {
    intent: "create_model",
    operations: [
      { op: "create_object", name: "Table", kind: "box", dimensions: { x: 1200, y: 750, z: 700 } },
    ],
  };

  assert.throws(() => validateModelPlanDomainRules(plan), (error: unknown) => {
    assert.ok(error instanceof ModelPlanValidationError);
    assert.match(error.message, /box requires dimensions/);
    assert.match(error.message, /"depth","height","width"/);
    return true;
  });
});

test("create_object with correct dimension keys for every primitive kind passes", () => {
  const cases: { kind: PrimitiveKind; dimensions: Record<string, number> }[] = [
    { kind: "box", dimensions: { width: 10, height: 10, depth: 10 } },
    { kind: "sphere", dimensions: { radius: 5 } },
    { kind: "cylinder", dimensions: { radius: 5, height: 10 } },
    { kind: "cone", dimensions: { bottomRadius: 5, height: 10 } },
  ];

  for (const { kind, dimensions } of cases) {
    const plan: ModelPlan = {
      intent: "create_model",
      operations: [{ op: "create_object", name: "Thing", kind, dimensions }],
    };
    assert.doesNotThrow(() => validateModelPlanDomainRules(plan), `kind ${kind} should pass`);
  }
});
