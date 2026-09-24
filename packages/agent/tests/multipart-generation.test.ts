import assert from "node:assert/strict";
import { test } from "node:test";

import furnitureCases from "../../../tests/golden/multipart-furniture.json" with { type: "json" };
import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import { MockLLMProvider } from "../src/mock-provider.ts";
import { generateModelPlan } from "../src/generate-model-plan.ts";

const EMPTY_SPEC: ModelSpec = {
  schemaVersion: "1.0",
  projectId: "proj_1",
  revision: 0,
  units: "mm",
  scene: { displayScale: 1 },
  objects: [],
};

for (const fixture of furnitureCases as ReadonlyArray<{
  readonly request: string;
  readonly expectedPartNames: readonly string[];
  readonly plan: Record<string, unknown>;
}>) {
  test(`golden furniture prompt creates named parts: ${fixture.request}`, async () => {
    const provider = new MockLLMProvider([fixture.plan]);
    const plan = await generateModelPlan({ provider, request: fixture.request, modelSpec: EMPTY_SPEC });
    const createdParts = plan.operations.filter((operation) => operation.op === "create_object");

    assert.ok(plan.operations.length <= 100);
    assert.deepEqual(createdParts.map((operation) => operation.name), fixture.expectedPartNames);
    assert.ok(createdParts.every((operation) => operation.id !== undefined));

    const verticalParts = createdParts.filter((operation) => operation.kind === "cylinder");
    assert.ok(verticalParts.length > 0);
    assert.ok(verticalParts.every((operation) => operation.position?.[1] === operation.dimensions.height / 2));

    const support = createdParts[0];
    const legHeight = verticalParts[0]?.dimensions.height;
    assert.ok(support?.position !== undefined);
    assert.ok(legHeight !== undefined);
    assert.equal(support?.position?.[1], legHeight + support?.dimensions.height / 2);
  });
}
