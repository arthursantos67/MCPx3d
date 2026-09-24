import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import {
  MAX_MODEL_SPEC_SUMMARY_CHARACTERS,
  MAX_MODEL_SPEC_SUMMARY_OBJECTS,
  summarizeModelSpec,
} from "../src/model-spec-summary.ts";

test("empty scene summarizes to a clear placeholder", () => {
  const spec: ModelSpec = {
    schemaVersion: "1.0",
    projectId: "proj_1",
    revision: 0,
    units: "mm",
    scene: { displayScale: 1 },
    objects: [],
  };

  assert.equal(summarizeModelSpec(spec), "(empty scene -- no objects yet)");
});

test("summarizes each object's id, name, kind, dimensions, transform, and color", () => {
  const spec: ModelSpec = {
    schemaVersion: "1.0",
    projectId: "proj_1",
    revision: 3,
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

  const summary = summarizeModelSpec(spec);

  assert.match(summary, /id=seat/);
  assert.match(summary, /name="Seat"/);
  assert.match(summary, /kind=box/);
  assert.match(summary, /width=500/);
  assert.match(summary, /position=\(0, 450, 0\)/);
  assert.match(summary, /color=#8b5a2b/);
});

test("bounds the summary while retaining only model-facing object context", () => {
  const spec: ModelSpec = {
    schemaVersion: "1.0",
    projectId: "internal-project-id",
    revision: 8,
    units: "mm",
    scene: { displayScale: 1 },
    objects: Array.from({ length: 4 }, (_, index) => ({
      id: `part_${index + 1}`,
      name: `Part ${index + 1}`,
      kind: "box" as const,
      dimensions: { width: 100, height: 20, depth: 50 },
      transform: { position: [index * 10, 0, 0] as [number, number, number], rotation: [0, 0, 0], scale: [1, 1, 1] },
      material: { color: "#112233" },
    })),
  };

  const summary = summarizeModelSpec(spec, { maxCharacters: 500, maxObjects: 2 });

  assert.ok(summary.length <= 500);
  assert.match(summary, /id=part_1/);
  assert.match(summary, /kind=box/);
  assert.match(summary, /position=\(0, 0, 0\)/);
  assert.match(summary, /additional object(?:s)? omitted/);
  assert.doesNotMatch(summary, /internal-project-id|revision/);
});

test("caps configurable summary limits", () => {
  const spec: ModelSpec = {
    schemaVersion: "1.0",
    projectId: "proj_1",
    revision: 0,
    units: "mm",
    scene: { displayScale: 1 },
    objects: Array.from({ length: MAX_MODEL_SPEC_SUMMARY_OBJECTS + 1 }, (_, index) => ({
      id: `part_${index}`,
      name: `Part ${index}`,
      kind: "box" as const,
      dimensions: { width: 100, height: 20, depth: 50 },
      transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0], scale: [1, 1, 1] },
      material: { color: "#112233" },
    })),
  };

  const summary = summarizeModelSpec(spec, {
    maxCharacters: Number.MAX_SAFE_INTEGER,
    maxObjects: Number.MAX_SAFE_INTEGER,
  });

  assert.ok(summary.length <= MAX_MODEL_SPEC_SUMMARY_CHARACTERS);
  assert.match(summary, new RegExp(`id=part_${MAX_MODEL_SPEC_SUMMARY_OBJECTS - 1}`));
  assert.doesNotMatch(summary, new RegExp(`id=part_${MAX_MODEL_SPEC_SUMMARY_OBJECTS}`));
  assert.match(summary, /additional object(?:s)? omitted/);
});
