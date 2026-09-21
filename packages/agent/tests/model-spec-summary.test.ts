import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import { summarizeModelSpec } from "../src/model-spec-summary.ts";

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
