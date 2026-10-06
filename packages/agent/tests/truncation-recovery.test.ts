import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelPlan } from "../../domain/ts/src/model-plan.ts";
import type { ModelSpec } from "../../domain/ts/src/model-spec.ts";
import {
  COMPLETION_TOKEN_OVERHEAD,
  COMPLETION_TOKENS_PER_OPERATION,
  ModelPlanTruncatedError,
  completionTokenBudget,
  generateModelPlan,
} from "../src/generate-model-plan.ts";
import {
  MAX_APPLY_REPAIRS,
  MAX_PLAN_OPERATIONS,
  MAX_SCENE_BATCHES,
  SCENE_BATCH_OPERATIONS,
  SceneBatchError,
  createSceneGenerationCounters,
  generateScene,
} from "../src/generate-scene.ts";
import { MockLLMProvider, mockCompletion } from "../src/mock-provider.ts";

const EMPTY_SPEC: ModelSpec = {
  schemaVersion: "1.0",
  projectId: "prj_kitchen",
  revision: 0,
  units: "mm",
  scene: { displayScale: 1 },
  objects: [],
};

function cabinet(index: number): Record<string, unknown> {
  return {
    op: "create_object",
    id: `cabinet_${index}`,
    name: `Cabinet ${index}`,
    kind: "box",
    dimensions: { width: 600, height: 900, depth: 600 },
    position: [index * 700, 450, 0],
    color: "#d9c7a7",
  };
}

function batchPlan(from: number, count: number): Record<string, unknown> {
  return {
    intent: "create_model",
    operations: Array.from({ length: count }, (_unused, offset) => cabinet(from + offset)),
  };
}

const DONE = { intent: "no_change", operations: [{ op: "no_change", reason: "The kitchen is complete." }] };

const TRUNCATED_KITCHEN = mockCompletion(
  `{"intent":"create_model","operations":[${JSON.stringify(cabinet(1))},{"op":"create_object","id":"cabi`,
  "length",
);

/** Commits a plan the way the backend would: bump the revision and add created parts. */
function fakeCommit(applied: ModelPlan[]): (plan: ModelPlan, spec: ModelSpec) => Promise<ModelSpec> {
  return async (plan, spec) => {
    applied.push(plan);
    const created = plan.operations.flatMap((operation) =>
      operation.op === "create_object"
        ? [{
            id: operation.id ?? `part_${spec.objects.length}`,
            name: operation.name,
            kind: operation.kind,
            dimensions: operation.dimensions as Record<string, number>,
            transform: { position: operation.position ?? [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            material: { color: operation.color ?? "#cccccc" },
          } satisfies ModelSpec["objects"][number]]
        : [],
    );
    return { ...spec, revision: spec.revision + 1, objects: [...spec.objects, ...created] };
  };
}

test("first-response truncation raises a classified error without a format-repair call", async () => {
  const provider = new MockLLMProvider([TRUNCATED_KITCHEN, batchPlan(1, 2)]);

  await assert.rejects(
    () => generateModelPlan({ provider, request: "a full kitchen", modelSpec: EMPTY_SPEC }),
    (error: unknown) => error instanceof ModelPlanTruncatedError && error.completion.finishReason === "length",
  );
  assert.equal(provider.calls.length, 1);
});

test("truncation during the format-repair attempt is still classified as truncation", async () => {
  const provider = new MockLLMProvider(["not json{{{", TRUNCATED_KITCHEN]);

  await assert.rejects(
    () => generateModelPlan({ provider, request: "a full kitchen", modelSpec: EMPTY_SPEC }),
    ModelPlanTruncatedError,
  );
  assert.equal(provider.calls.length, 2);
});

test("a locally repaired response is used only after passing normal validation", async () => {
  const fenced = mockCompletion(`\`\`\`json\n${JSON.stringify(batchPlan(1, 2)).replace(/]}$/, ",]}")}\n\`\`\``);
  const repaired = await generateModelPlan({ provider: new MockLLMProvider([fenced]), request: "two cabinets", modelSpec: EMPTY_SPEC });
  assert.equal(repaired.operations.length, 2);

  const repairedButInvalid = mockCompletion('```json\n{"intent":"x","operations":[{"op":"explode"},]}\n```');
  const provider = new MockLLMProvider([repairedButInvalid, batchPlan(1, 1)]);
  const plan = await generateModelPlan({ provider, request: "one cabinet", modelSpec: EMPTY_SPEC });
  assert.equal(plan.operations.length, 1);
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1]?.messages.at(-1)?.content ?? "", /operations\[0\] \(explode\) uses an unknown op/);
});

test("every request carries an explicit completion budget bounded by the provider limit", async () => {
  const unlimited = new MockLLMProvider([batchPlan(1, 1)]);
  await generateModelPlan({ provider: unlimited, request: "a cabinet", modelSpec: EMPTY_SPEC });
  assert.equal(unlimited.calls[0]?.options?.maxTokens, COMPLETION_TOKEN_OVERHEAD + COMPLETION_TOKENS_PER_OPERATION * 100);

  const limited = new MockLLMProvider([batchPlan(1, 1)], { maxOutputTokens: 1000 });
  await generateModelPlan({ provider: limited, request: "a cabinet", modelSpec: EMPTY_SPEC });
  assert.equal(limited.calls[0]?.options?.maxTokens, 1000);

  const batch = new MockLLMProvider([batchPlan(1, 1)]);
  await generateModelPlan({
    provider: batch,
    request: "a cabinet",
    modelSpec: EMPTY_SPEC,
    continuation: { batch: 1, maxOperations: SCENE_BATCH_OPERATIONS },
  });
  assert.equal(
    batch.calls[0]?.options?.maxTokens,
    COMPLETION_TOKEN_OVERHEAD + COMPLETION_TOKENS_PER_OPERATION * SCENE_BATCH_OPERATIONS,
  );
  assert.equal(completionTokenBudget(10_000), 8192);
  assert.equal(completionTokenBudget(100, 8192), 7424);
});

test("a batch that exceeds its operation cap goes through the normal repair path", async () => {
  const provider = new MockLLMProvider([batchPlan(1, SCENE_BATCH_OPERATIONS + 1), batchPlan(1, SCENE_BATCH_OPERATIONS)]);
  const plan = await generateModelPlan({
    provider,
    request: "a kitchen",
    modelSpec: EMPTY_SPEC,
    continuation: { batch: 1, maxOperations: SCENE_BATCH_OPERATIONS },
  });
  assert.equal(plan.operations.length, SCENE_BATCH_OPERATIONS);
  assert.match(provider.calls[1]?.messages.at(-1)?.content ?? "", new RegExp(`emit at most ${SCENE_BATCH_OPERATIONS}`));
});

test("a truncated kitchen continues as bounded, independently committed batches", async () => {
  const provider = new MockLLMProvider([
    TRUNCATED_KITCHEN,
    batchPlan(1, 12),
    batchPlan(13, 12),
    batchPlan(25, 6),
    DONE,
  ]);
  const applied: ModelPlan[] = [];
  const progress: string[] = [];
  const counters = createSceneGenerationCounters();

  const outcome = await generateScene({
    provider,
    request: "a full kitchen with base cabinets, wall cabinets and appliances",
    modelSpec: EMPTY_SPEC,
    applyPlan: fakeCommit(applied),
    onProgress: (p) => progress.push(`${p.stage}:${p.batch}:${p.committedBatches}`),
    counters,
  });

  assert.deepEqual(outcome.status === "applied" && [outcome.batches, outcome.complete, outcome.modelSpec.revision], [3, true, 3]);
  assert.equal(outcome.modelSpec.objects.length, 30);
  assert.deepEqual(applied.map((plan) => plan.operations.length), [12, 12, 6]);
  assert.ok(applied.every((plan) => plan.operations.length <= SCENE_BATCH_OPERATIONS));
  assert.deepEqual(progress, [
    "generating:0:0",
    "generating:1:0", "applying:1:0",
    "generating:2:1", "applying:2:1",
    "generating:3:2", "applying:3:2",
    "generating:4:3",
  ]);
  const secondBatchPrompt = provider.calls[2]?.messages.at(-1)?.content ?? "";
  assert.match(secondBatchPrompt, new RegExp(`built in several steps.*use all ${SCENE_BATCH_OPERATIONS} while parts`, "s"));
  assert.doesNotMatch(secondBatchPrompt, /batch \d|step \d/i);
  assert.match(provider.calls[2]?.messages[0]?.content ?? "", /cabinet_12/);
  assert.deepEqual(counters, {
    completions: 5,
    truncations: 1,
    localRepairs: 0,
    formatRepairs: 0,
    applyRepairs: 0,
    continued: true,
    committedBatches: 3,
    skippedBatches: 0,
    overlapResolutions: 0,
    validationFailures: { truncated: 1 },
  });
});

test("a failed batch is reported exactly while earlier batches stay committed", async () => {
  const provider = new MockLLMProvider([TRUNCATED_KITCHEN, batchPlan(1, 12), batchPlan(13, 12)]);
  const applied: ModelPlan[] = [];
  const commit = fakeCommit(applied);
  let lastCommitted = EMPTY_SPEC;

  const error = await generateScene({
    provider,
    request: "a full kitchen",
    modelSpec: EMPTY_SPEC,
    applyPlan: async (plan, spec) => {
      if (applied.length === 1) throw new Error("MCP is unavailable.");
      lastCommitted = await commit(plan, spec);
      return lastCommitted;
    },
  }).then(() => null, (reason: unknown) => reason);

  assert.ok(error instanceof SceneBatchError);
  assert.equal(error.batch, 2);
  assert.equal(error.committedBatches, 1);
  assert.match(error.message, /Scene batch 2 failed: MCP is unavailable\..*1 earlier batch/);
  assert.equal(lastCommitted.revision, 1);
  assert.equal(lastCommitted.objects.length, 12);
});

test("a truncated batch is never applied, is skipped, and the scene continues", async () => {
  const provider = new MockLLMProvider([TRUNCATED_KITCHEN, batchPlan(1, 12), TRUNCATED_KITCHEN, batchPlan(13, 5), DONE]);
  const applied: ModelPlan[] = [];

  const outcome = await generateScene({ provider, request: "a full kitchen", modelSpec: EMPTY_SPEC, applyPlan: fakeCommit(applied) });

  assert.equal(outcome.status, "applied");
  assert.deepEqual(applied.map((plan) => plan.operations.length), [12, 5]);
  if (outcome.status === "applied") {
    assert.equal(outcome.batches, 2);
    assert.deepEqual(outcome.skippedBatches.map(({ batch }) => batch), [2]);
    assert.match(outcome.skippedBatches[0]?.reason ?? "", /output limit/);
  }
});

test("two consecutive failed batches stop the request with the exact batch", async () => {
  const provider = new MockLLMProvider([TRUNCATED_KITCHEN, batchPlan(1, 12), TRUNCATED_KITCHEN, TRUNCATED_KITCHEN]);
  const applied: ModelPlan[] = [];

  const error = await generateScene({ provider, request: "a full kitchen", modelSpec: EMPTY_SPEC, applyPlan: fakeCommit(applied) })
    .then(() => null, (reason: unknown) => reason);

  assert.ok(error instanceof SceneBatchError);
  assert.equal(error.batch, 3);
  assert.equal(error.committedBatches, 1);
  assert.ok(error.cause instanceof ModelPlanTruncatedError);
  assert.equal(applied.length, 1);
});

test("explicit displacement opt-in permits a final apply asking the backend to separate parts", async () => {
  const provider = new MockLLMProvider(Array.from({ length: MAX_APPLY_REPAIRS + 1 }, () => batchPlan(1, 4)));
  const requests: boolean[] = [];
  const counters = createSceneGenerationCounters();

  const outcome = await generateScene({
    provider,
    request: "four cabinets",
    allowOverlapResolution: true,
    modelSpec: EMPTY_SPEC,
    counters,
    describeRepairableApplyError: () => "UNINTENDED_OVERLAP: 'Cabinet 1' (cabinet_1) intersects 'Cabinet 2' (cabinet_2)",
    applyPlan: async (plan, spec, { resolveOverlaps }) => {
      requests.push(resolveOverlaps);
      if (!resolveOverlaps) throw new Error("overlap");
      return fakeCommit([])(plan, spec);
    },
  });

  assert.equal(outcome.status, "applied");
  assert.deepEqual(requests, [false, false, false, true]);
  assert.equal(counters.applyRepairs, MAX_APPLY_REPAIRS);
  assert.equal(counters.overlapResolutions, 1);
  assert.equal(provider.calls.length, MAX_APPLY_REPAIRS + 1);
});

test("explicit no-overlap mode never asks the backend to displace parts", async () => {
  const provider = new MockLLMProvider(Array.from({ length: MAX_APPLY_REPAIRS + 1 }, () => batchPlan(1, 4)));
  const requests: boolean[] = [];
  const counters = createSceneGenerationCounters();

  await assert.rejects(generateScene({
    provider,
    request: "four cabinets without overlap",
    modelSpec: EMPTY_SPEC,
    counters,
    allowOverlapResolution: false,
    describeRepairableApplyError: () => "UNINTENDED_OVERLAP",
    applyPlan: async (_plan, _spec, { resolveOverlaps }) => {
      requests.push(resolveOverlaps);
      throw new Error("overlap");
    },
  }), /overlap/);

  assert.deepEqual(requests, [false, false, false, false]);
  assert.equal(counters.overlapResolutions, 0);
});

test("an apply rejection inside a batch gets one regeneration with the diagnostic", async () => {
  const provider = new MockLLMProvider([TRUNCATED_KITCHEN, batchPlan(1, 2), batchPlan(1, 2), DONE]);
  const applied: ModelPlan[] = [];
  const commit = fakeCommit(applied);
  let rejected = false;
  const counters = createSceneGenerationCounters();

  const outcome = await generateScene({
    provider,
    request: "two cabinets in a big kitchen",
    modelSpec: EMPTY_SPEC,
    counters,
    describeRepairableApplyError: (error) => (error instanceof Error ? `UNINTENDED_OVERLAP: ${error.message}` : null),
    applyPlan: async (plan, spec) => {
      if (!rejected) {
        rejected = true;
        throw new Error("cabinet_1 intersects cabinet_2");
      }
      return commit(plan, spec);
    },
  });

  assert.equal(outcome.status, "applied");
  assert.equal(counters.applyRepairs, 1);
  const repairMessages = provider.calls[2]?.messages ?? [];
  assert.match(repairMessages.at(-1)?.content ?? "", /UNINTENDED_OVERLAP.*keep every other operation/s);
  assert.equal(repairMessages.at(-2)?.role, "assistant");
  assert.match(repairMessages.at(-3)?.content ?? "", /built in several steps/);
});

test("cancellation between batches keeps committed batches and stops asking the provider", async () => {
  const provider = new MockLLMProvider([TRUNCATED_KITCHEN, batchPlan(1, 12), batchPlan(13, 12)]);
  const applied: ModelPlan[] = [];
  const commit = fakeCommit(applied);
  const cancellation = new AbortController();

  const outcome = await generateScene({
    provider,
    request: "a full kitchen",
    modelSpec: EMPTY_SPEC,
    signal: cancellation.signal,
    applyPlan: async (plan, spec) => {
      const committed = await commit(plan, spec);
      cancellation.abort();
      return committed;
    },
    onProgress: (progress) => {
      if (progress.batch === 2) assert.fail("no batch may start after cancellation");
    },
  });

  assert.deepEqual(outcome.status === "cancelled" && [outcome.batches, outcome.modelSpec.revision], [1, 1]);
  assert.equal(applied.length, 1);
  assert.equal(provider.calls.length, 2);
});

test("continuation stops at the documented batch limit", async () => {
  const responses = [TRUNCATED_KITCHEN, ...Array.from({ length: MAX_SCENE_BATCHES }, (_u, i) => batchPlan(i * 12 + 1, 12))];
  const provider = new MockLLMProvider(responses);

  const outcome = await generateScene({ provider, request: "an enormous kitchen", modelSpec: EMPTY_SPEC, applyPlan: fakeCommit([]) });

  assert.deepEqual(outcome.status === "applied" && [outcome.batches, outcome.complete], [MAX_SCENE_BATCHES, false]);
  assert.equal(provider.calls.length, MAX_SCENE_BATCHES + 1);
});

test("a single plan that fits is applied once, exactly as before", async () => {
  const provider = new MockLLMProvider([batchPlan(1, 4)]);
  const applied: ModelPlan[] = [];
  const counters = createSceneGenerationCounters();

  const outcome = await generateScene({ provider, request: "four cabinets", modelSpec: EMPTY_SPEC, applyPlan: fakeCommit(applied), counters });

  assert.deepEqual(outcome.status === "applied" && [outcome.batches, outcome.complete], [0, true]);
  assert.equal(applied.length, 1);
  assert.equal(counters.continued, false);
});

test("a plan over the per-plan limit is corrected to its most important operations", async () => {
  const provider = new MockLLMProvider([batchPlan(1, MAX_PLAN_OPERATIONS + 20), batchPlan(1, MAX_PLAN_OPERATIONS)]);

  const plan = await generateModelPlan({ provider, request: "a very detailed kitchen", modelSpec: EMPTY_SPEC });

  assert.equal(plan.operations.length, MAX_PLAN_OPERATIONS);
  const repair = provider.calls[1]?.messages.at(-1)?.content ?? "";
  assert.match(repair, /emit at most 100, structural parts first -- the remaining parts will be requested next/);
  assert.match(repair, /Return this plan with at most 100 operations/);
});

test("a single plan that reaches the per-plan limit continues with the remaining parts in batches", async () => {
  const provider = new MockLLMProvider([batchPlan(1, MAX_PLAN_OPERATIONS), batchPlan(101, 20), DONE]);
  const applied: ModelPlan[] = [];
  const counters = createSceneGenerationCounters();

  const outcome = await generateScene({ provider, request: "a very detailed kitchen", modelSpec: EMPTY_SPEC, applyPlan: fakeCommit(applied), counters });

  assert.deepEqual(applied.map((plan) => plan.operations.length), [MAX_PLAN_OPERATIONS, 20]);
  assert.equal(outcome.status, "applied");
  assert.equal(outcome.modelSpec.objects.length, 120);
  assert.equal(counters.continued, true);
  assert.match(provider.calls[1]?.messages[0]?.content ?? "", /cabinet_100/);
});
