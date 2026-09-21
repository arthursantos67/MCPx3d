import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import { MockLLMProvider } from "../src/mock-provider.ts";
import { buildClarificationFollowUp, generateModelPlan } from "../src/generate-model-plan.ts";

function specWithTwoSupports(): ModelSpec {
  return {
    schemaVersion: "1.0",
    projectId: "proj_1",
    revision: 1,
    units: "mm",
    scene: { displayScale: 1 },
    objects: [
      {
        id: "support_a",
        name: "Support",
        kind: "cylinder",
        dimensions: { radius: 10, height: 200 },
        transform: { position: [-100, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: "#808080" },
      },
      {
        id: "support_b",
        name: "Support",
        kind: "cylinder",
        dimensions: { radius: 10, height: 200 },
        transform: { position: [100, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: "#808080" },
      },
    ],
  };
}

function specWithLegAndBackrest(): ModelSpec {
  return {
    schemaVersion: "1.0",
    projectId: "proj_2",
    revision: 1,
    units: "mm",
    scene: { displayScale: 1 },
    objects: [
      {
        id: "leg_1",
        name: "Leg",
        kind: "cylinder",
        dimensions: { radius: 10, height: 400 },
        transform: { position: [-200, 0, -200], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: "#808080" },
      },
      {
        id: "leg_2",
        name: "Leg",
        kind: "cylinder",
        dimensions: { radius: 10, height: 400 },
        transform: { position: [200, 0, -200], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: "#808080" },
      },
      {
        id: "leg_3",
        name: "Leg",
        kind: "cylinder",
        dimensions: { radius: 10, height: 400 },
        transform: { position: [-200, 0, 200], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: "#808080" },
      },
      {
        id: "backrest",
        name: "Backrest",
        kind: "box",
        dimensions: { width: 400, height: 300, depth: 20 },
        transform: { position: [0, 500, -200], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: "#808080" },
      },
    ],
  };
}

const AMBIGUOUS_CASES: ReadonlyArray<{
  readonly name: string;
  readonly request: string;
  readonly modelSpec: ModelSpec;
  readonly question: string;
}> = [
  {
    name: "duplicate-named parts, no other qualifier",
    request: "make the support bigger",
    modelSpec: specWithTwoSupports(),
    question: "There are two objects named \"Support\" (support_a, support_b) -- which one do you mean?",
  },
  {
    name: "duplicate-named parts, vague relative reference",
    request: "move the support to the left",
    modelSpec: specWithTwoSupports(),
    question: "Both supports could be meant -- which one should move left, support_a or support_b?",
  },
  {
    name: "plural target on a scene with only one matching kind",
    request: "make it thicker",
    modelSpec: specWithTwoSupports(),
    question: "\"It\" is ambiguous with two supports in the scene -- which one do you mean?",
  },
  {
    name: "count mismatch against an incomplete part group",
    request: "make the four legs thicker",
    modelSpec: specWithLegAndBackrest(),
    question: "This model only has three legs (leg_1, leg_2, leg_3), not four -- which legs did you mean, or should a fourth be added?",
  },
  {
    name: "target with no matching object at all",
    request: "change the seat color to green",
    modelSpec: specWithLegAndBackrest(),
    question: "There is no object that looks like a seat in this model -- which part did you mean?",
  },
  {
    name: "ambiguous ordinal reference among identically shaped parts",
    request: "delete the second leg",
    modelSpec: specWithLegAndBackrest(),
    question: "The legs don't have a defined left-to-right order -- which leg id should be deleted (leg_1, leg_2, or leg_3)?",
  },
];

for (const { name, request, modelSpec, question } of AMBIGUOUS_CASES) {
  test(`ambiguous prompt produces a pure clarify plan: ${name}`, async () => {
    const provider = new MockLLMProvider([{ intent: "clarify", operations: [{ op: "clarify", question }] }]);

    const plan = await generateModelPlan({ provider, request, modelSpec });

    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0]?.op, "clarify");
    if (plan.operations[0]?.op === "clarify") {
      assert.equal(plan.operations[0].question, question);
    }
    assert.equal(provider.calls.length, 1);
  });
}

test("a clarify combined with a mutating operation is rejected and repaired once", async () => {
  const modelSpec = specWithTwoSupports();
  const provider = new MockLLMProvider([
    {
      intent: "modify_model",
      operations: [
        { op: "clarify", question: "Which support?" },
        { op: "set_dimensions", target: "support_a", dimensions: { radius: 20, height: 200 } },
      ],
    },
    { intent: "clarify", operations: [{ op: "clarify", question: "Which support do you mean, support_a or support_b?" }] },
  ]);

  const plan = await generateModelPlan({ provider, request: "make the support bigger", modelSpec });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0]?.op, "clarify");
  assert.equal(provider.calls.length, 2);
  assert.match(
    provider.calls[1]?.messages.at(-1)?.content ?? "",
    /clarify operation must not be combined/,
  );
});

test("a clarify combined with a mutating operation that persists after repair throws instead of guessing", async () => {
  const modelSpec = specWithTwoSupports();
  const mixedPlan = {
    intent: "modify_model",
    operations: [
      { op: "clarify", question: "Which support?" },
      { op: "set_dimensions", target: "support_a", dimensions: { radius: 20, height: 200 } },
    ],
  };
  const provider = new MockLLMProvider([mixedPlan, mixedPlan]);

  await assert.rejects(() => generateModelPlan({ provider, request: "make the support bigger", modelSpec }));
  assert.equal(provider.calls.length, 2);
});

test("buildClarificationFollowUp threads the prior question and answer into the next call", async () => {
  const modelSpec = specWithTwoSupports();
  const question = "There are two objects named \"Support\" -- which one do you mean, support_a or support_b?";

  const firstProvider = new MockLLMProvider([{ intent: "clarify", operations: [{ op: "clarify", question }] }]);
  const firstPlan = await generateModelPlan({ provider: firstProvider, request: "make the support bigger", modelSpec });
  assert.equal(firstPlan.operations[0]?.op, "clarify");

  const followUp = buildClarificationFollowUp(question, "the one on the left, support_a");
  assert.deepEqual(followUp, [
    { role: "assistant", content: question },
    { role: "user", content: "the one on the left, support_a" },
  ]);

  const secondProvider = new MockLLMProvider([
    { intent: "modify_model", operations: [{ op: "set_dimensions", target: "support_a", dimensions: { radius: 20, height: 200 } }] },
  ]);
  const secondPlan = await generateModelPlan({
    provider: secondProvider,
    request: "the one on the left, support_a",
    modelSpec,
    recentMessages: followUp,
  });

  assert.equal(secondPlan.operations[0]?.op, "set_dimensions");
  if (secondPlan.operations[0]?.op === "set_dimensions") {
    assert.equal(secondPlan.operations[0].target, "support_a");
  }

  const sentMessages = secondProvider.calls[0]?.messages ?? [];
  assert.equal(sentMessages[1]?.role, "assistant");
  assert.equal(sentMessages[1]?.content, question);
  assert.equal(sentMessages[2]?.role, "user");
  assert.match(sentMessages[2]?.content ?? "", /support_a/);
});
