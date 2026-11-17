/** Validates the ModelPlan fixtures shared with Python against the same JSON Schema. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { FIXTURES_DIR, SCHEMAS_DIR, loadJson } from "./support.ts";

const ajv = new Ajv2020({ allErrors: true });
const modelPlanSchema = loadJson(SCHEMAS_DIR, "model-plan.v1.schema.json");

test("valid ModelPlan fixtures pass schema", () => {
  const validate = ajv.compile(modelPlanSchema as object);

  const create = loadJson(FIXTURES_DIR, "model-plan", "valid-create.json");
  const modify = loadJson(FIXTURES_DIR, "model-plan", "valid-modify.json");

  assert.equal(validate(create), true, ajv.errorsText(validate.errors));
  assert.equal(validate(modify), true, ajv.errorsText(validate.errors));
});

test("unknown-operation ModelPlan fixture fails schema", () => {
  const validate = ajv.compile(modelPlanSchema as object);
  const instance = loadJson(FIXTURES_DIR, "model-plan", "invalid-unknown-operation.json");

  assert.equal(validate(instance), false);
});

test("named scene background plan fails schema", () => {
  const validate = ajv.compile(modelPlanSchema as object);
  assert.equal(validate({ intent: "background", operations: [{ op: "set_scene", background: "blue" }] }), false);
});
