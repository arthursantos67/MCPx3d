import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ModelSpecValidationError,
  validateModelSpecDomainRules,
  type ModelSpec,
} from "../src/model-spec.ts";
import { FIXTURES_DIR, loadJson } from "./support.ts";

test("valid ModelSpec passes domain validation", () => {
  const spec = loadJson<ModelSpec>(FIXTURES_DIR, "model-spec", "valid.json");

  assert.doesNotThrow(() => validateModelSpecDomainRules(spec));
});

test("negative dimension is rejected", () => {
  const spec = loadJson<ModelSpec>(FIXTURES_DIR, "model-spec", "invalid-negative-dimension.json");

  assert.throws(() => validateModelSpecDomainRules(spec), ModelSpecValidationError);
});

test("duplicate object id is rejected", () => {
  const spec = loadJson<ModelSpec>(FIXTURES_DIR, "model-spec", "invalid-duplicate-id.json");

  assert.throws(() => validateModelSpecDomainRules(spec), /duplicate object id/);
});

test("nonzero scale is required", () => {
  const spec = loadJson<ModelSpec>(FIXTURES_DIR, "model-spec", "valid.json");
  spec.objects[0].transform.scale = [0, 1, 1];

  assert.throws(() => validateModelSpecDomainRules(spec), ModelSpecValidationError);
});

test("non-normalized color is rejected", () => {
  const spec = loadJson<ModelSpec>(FIXTURES_DIR, "model-spec", "valid.json");
  spec.objects[0].material.color = "red";

  assert.throws(() => validateModelSpecDomainRules(spec), ModelSpecValidationError);
});
