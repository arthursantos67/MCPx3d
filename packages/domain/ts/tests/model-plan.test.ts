import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ModelPlanValidationError,
  validateModelPlanDomainRules,
  type ModelPlan,
} from "../src/model-plan.ts";
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
