import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import { buildSystemPrompt } from "../src/system-prompt.ts";

const BASE_SPEC: ModelSpec = {
  schemaVersion: "1.0",
  projectId: "proj_1",
  revision: 0,
  units: "mm",
  scene: { displayScale: 1 },
  objects: [{
    id: "seat",
    name: "Seat",
    kind: "box",
    dimensions: { width: 500, height: 40, depth: 500 },
    transform: { position: [0, 450, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    material: { color: "#8b5a2b" },
  }],
};

test("includes the never-emit-code rule, allowed operations, coordinate convention, units, and current model", () => {
  const prompt = buildSystemPrompt(BASE_SPEC);

  assert.match(prompt, /You do not write HTML, XML, JavaScript, Python, shell commands, or X3D source/);
  assert.match(prompt, /create_object: add a new primitive/);
  assert.match(prompt, /clarify: ask the user a question/);
  assert.match(prompt, /X is left\/right, Y is up\/down, Z is front\/back/);
  assert.match(prompt, /semantic unit is "mm"/);
  assert.match(prompt, /id=seat/);
});

test("instructs the model to answer in the user's own language", () => {
  const prompt = buildSystemPrompt(BASE_SPEC);

  assert.match(prompt, /same language the user's most recent message is written in/);
});

test("instructs the model to default/infer dimensions instead of clarifying over missing measurements", () => {
  const prompt = buildSystemPrompt(BASE_SPEC);

  assert.match(prompt, /do not ask for clarification just because exact measurements were not given/);
  assert.match(prompt, /infer reasonable real-world dimensions from that goal/);
  assert.match(prompt, /never for missing exact measurements alone/);
});

test("never invents operations beyond the fixed v1 set", () => {
  const prompt = buildSystemPrompt(BASE_SPEC);
  const allowedOps = [
    "create_object",
    "delete_object",
    "duplicate_object",
    "set_dimensions",
    "translate_object",
    "rotate_object",
    "scale_object",
    "set_material",
    "rename_object",
    "set_scene",
    "clarify",
    "no_change",
  ];

  for (const op of allowedOps) {
    assert.match(prompt, new RegExp(`- ${op}:`));
  }
});
