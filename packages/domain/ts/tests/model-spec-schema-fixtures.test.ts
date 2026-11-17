/** Validates the ModelSpec fixtures shared with Python against the same JSON Schema. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { FIXTURES_DIR, SCHEMAS_DIR, loadJson } from "./support.ts";

const ajv = new Ajv2020({ allErrors: true });
const modelSpecSchema = loadJson(SCHEMAS_DIR, "model-spec.v1.schema.json");

test("valid ModelSpec fixture passes schema", () => {
  const validate = ajv.compile(modelSpecSchema as object);
  const instance = loadJson(FIXTURES_DIR, "model-spec", "valid.json");

  assert.equal(validate(instance), true, ajv.errorsText(validate.errors));
});

test("negative-dimension ModelSpec fixture fails schema", () => {
  const validate = ajv.compile(modelSpecSchema as object);
  const instance = loadJson(FIXTURES_DIR, "model-spec", "invalid-negative-dimension.json");

  assert.equal(validate(instance), false);
});

test("duplicate-id ModelSpec fixture passes schema (uniqueness is a domain rule, not a schema rule)", () => {
  const validate = ajv.compile(modelSpecSchema as object);
  const instance = loadJson(FIXTURES_DIR, "model-spec", "invalid-duplicate-id.json");

  assert.equal(validate(instance), true, ajv.errorsText(validate.errors));
});

test("named scene background fails schema", () => {
  const validate = ajv.compile(modelSpecSchema as object);
  const instance = loadJson<{ scene: { background: string } }>(FIXTURES_DIR, "model-spec", "valid.json");
  instance.scene.background = "blue";
  assert.equal(validate(instance), false);
});
