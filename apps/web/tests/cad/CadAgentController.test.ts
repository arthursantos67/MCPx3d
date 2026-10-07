import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRequestError } from '../../../../packages/agent/src/provider.ts';
import { MockLLMProvider, type MockResponse } from "../../../../packages/agent/src/mock-provider.ts";
import { ApiError } from "../../src/api/client.ts";
import { CadAgentController } from "../../src/cad/CadAgentController.ts";
import type { AgentProvider } from "../../src/chat/ChatController.ts";
import type { AgentStatus } from "../../src/chat/types.ts";
import type { CadProgramSpec } from "../../../../packages/domain/ts/src/cad-program.ts";
import type { CadAssemblySpec } from "../../../../packages/domain/ts/src/cad-assembly.ts";
import { CadActionBudgetError } from '../../../../packages/agent/src/cad-action-budget.ts';

function makeFakeProvider(
  responses: readonly MockResponse[],
  initialState: AgentStatus = { phase: "ready" },
): { provider: AgentProvider; mock: MockLLMProvider } {
  const mock = new MockLLMProvider(responses);
  const state = initialState;
  const listeners = new Set<(next: AgentStatus) => void>();
  const provider: AgentProvider = {
    id: mock.id,
    isAvailable: () => mock.isAvailable(),
    initialize: () => mock.initialize(),
    generateStructured: (messages, schema, options) => mock.generateStructured(messages, schema, options),
    cancel: () => mock.cancel(),
    getState: () => state,
    onStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { provider, mock };
}

test('repairing an existing assembly skips classification, planning and rebuilding for both provider modes', async () => {
  const zero = { x: 0, y: 0, z: 0 }
  const spec: CadAssemblySpec = { schemaVersion: '4.0', units: 'mm', partId: 'existing', components:
    ['left', 'right'].map((id, i) => ({ id, position: { ...zero, x: i * 100 }, steps: [
      { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 20, depth: 20, height: 20 },
    ] })) }
  for (const native of [true, false]) {
    const { provider, mock } = makeFakeProvider([])
    if (native) Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } })
    let partChecks = 0, assemblyChecks = 0
    const controller = new CadAgentController(provider, {
      checkCadProgram: async () => { partChecks++; return null },
      checkCadAssembly: async (candidate) => { assemblyChecks++; assert.deepEqual(candidate, spec); return null },
    })
    const outcome = await controller.repairCadAssembly(spec)
    assert.ok(outcome.kind === 'create')
    assert.deepEqual(outcome.spec, spec)
    assert.equal(mock.calls.length, 0)
    assert.equal(partChecks, 0)
    assert.equal(assemblyChecks, 1)
  }
})

test("CAD generation stops when the geometry checker is unreachable", async () => {
  const program = {
    schemaVersion: "3.0", units: "mm", partId: "block",
    steps: [{ id: "body", op: "base", shape: "box", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 40, depth: 20, height: 10 }],
  };
  const { provider } = makeFakeProvider([{ decision: "create", spec: program, question: "", assumptions: [] }]);
  const checked: unknown[] = [];
  const controller = new CadAgentController(provider, {
    checkCadProgram: async (spec) => { checked.push(spec); throw new ApiError(503, { code: "CAD_ENGINE_UNAVAILABLE", message: "offline" }); },
    checkCadAssembly: async () => null,
  });

  await assert.rejects(controller.planCadProgram("Crie um bloco"), /offline/);
  assert.deepEqual(checked, [program]);
});

test("CAD design routes a moving mechanism to a checked assembly", async () => {
  const zero = { x: 0, y: 0, z: 0 };
  const fixed = { kind: "fixed", axis: "z", minimum: 0, maximum: 0, value: 0, pitch: 0, group: "" };
  const rotary = { kind: "rotary", axis: "x", minimum: 0, maximum: 360, value: 0, pitch: 0, group: "" };
  const box = (id: string) => ({ decision: "create", question: "", assumptions: [], spec: {
    schemaVersion: "3.0", units: "mm", partId: id,
    steps: [{ id: "body", op: "base", shape: "box", position: zero, rotation: zero, width: 50, depth: 30, height: 20 }],
  } });
  const { provider, mock } = makeFakeProvider([
    { kind: "assembly", reason: "fixed housing and rotating rotor" },
    { decision: "create", partId: "drive", question: "", assumptions: [], components: [
      { id: "housing", action: "build", description: "Fixed housing.", position: zero, motion: fixed },
      { id: "rotor", action: "build", description: "Rotating rotor.", position: zero, motion: rotary },
    ] },
    box("housing"), box("rotor"),
  ]);
  const checkedParts: string[] = [];
  const progress: string[] = [];
  let checkedAssembly = false;
  const controller = new CadAgentController(provider, {
    checkCadProgram: async (spec) => { checkedParts.push(spec.partId); return null; },
    checkCadAssembly: async () => { checkedAssembly = true; return null; },
  });

  const result = await controller.planCadDesign("Crie um motor com rotor móvel", undefined,
    (event) => progress.push(`${event.phase}:${event.completed}/${event.components.length}`));

  assert.equal(result.mode, "assembly");
  assert.equal(result.outcome.kind, "create");
  if (result.outcome.kind === "create") assert.equal(result.outcome.spec.components.length, 2);
  assert.deepEqual(checkedParts, ["housing", "rotor"]);
  assert.equal(checkedAssembly, true);
  assert.equal(mock.calls.length, 4);
  assert.deepEqual(progress, [
    "planning:0/0", "building:0/2", "checking-component:0/2",
    "building:1/2", "checking-component:1/2", "checking-assembly:2/2", "complete:2/2",
  ]);
});

test('completed native geometry can retry saving without another inference, while external generation remains fresh', async () => {
  const spec = {
    schemaVersion: '3.0', units: 'mm', partId: 'support', steps: [{
      id: 'body', op: 'base', shape: 'box', position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }, width: 50, depth: 30, height: 20,
    }],
  };
  const response = { decision: 'create', question: '', assumptions: [], spec };
  for (const native of [true, false]) {
    const { provider, mock } = makeFakeProvider([response, response, response]);
    if (native) Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false, maxCadRepairAttempts: 1 } });
    const controller = new CadAgentController(provider, { checkCadProgram: async () => null, checkCadAssembly: async () => null });
    const first = await controller.planCadProgram('Crie um suporte');
    if (first.kind === 'create') (first.spec.steps[0] as { width: number }).width = 999;
    const next = await controller.planCadProgram('Crie um suporte');
    assert.equal(next.kind, 'create');
    if (native && next.kind === 'create') assert.equal((next.spec.steps[0] as { width: number }).width, 50);
    assert.equal(mock.calls.length, native ? 1 : 2);
    controller.clearCompletedGeneration();
    await controller.planCadProgram('Crie um suporte');
    assert.equal(mock.calls.length, native ? 2 : 3);
  }
});

test("editing an existing part preserves its representation without another classifier request", async () => {
  const program: CadProgramSpec = {
    schemaVersion: '3.0', units: 'mm', partId: 'block', steps: [{
      id: 'body', op: 'base', shape: 'box', width: 40, depth: 20, height: 10,
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    }],
  };
  const revised = { ...program, steps: [{ ...program.steps[0], width: 60 }] };
  const { provider, mock } = makeFakeProvider([{ decision: 'create', spec: revised, question: '', assumptions: [] }]);
  const controller = new CadAgentController(provider, { checkCadProgram: async () => null, checkCadAssembly: async () => { throw new Error('Unexpected assembly'); } });
  const result = await controller.planCadDesign('Aumente a largura para 60 mm', program);
  assert.equal(result.mode, 'part');
  assert.equal(mock.calls.length, 1);
});

test("cancellation prevents geometry checks and later model calls after a pending completion", async () => {
  const { provider } = makeFakeProvider([]);
  let complete!: (response: unknown) => void;
  provider.generateStructured = <T>() => new Promise<T>((resolve) => { complete = (response) => resolve(response as T); });
  let checks = 0;
  const controller = new CadAgentController(provider, {
    checkCadProgram: async () => { checks++; return null; }, checkCadAssembly: async () => { checks++; return null; },
  });
  const pending = controller.planCadDesign('Crie um mecanismo');
  controller.cancelGeneration();
  complete({ kind: 'assembly', reason: 'Two bodies' });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(checks, 0);
});

test('changing provider after quota preserves the assembly plan and validated components', async () => {
  const zero = { x: 0, y: 0, z: 0 };
  const fixed = { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '' };
  const response = (id: string) => ({ decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: id, steps: [{ id: 'body', op: 'base', shape: 'box',
      position: zero, rotation: zero, width: 10, depth: 10, height: 10 }],
  } });
  const original = makeFakeProvider([
    { kind: 'assembly', reason: 'two bodies' },
    { decision: 'create', partId: 'test_resume', question: '', assumptions: [], components: [
      { id: 'support', action: 'build', description: 'support', position: zero, motion: fixed },
      { id: 'cover', action: 'build', description: 'cover', position: { ...zero, z: 20 }, motion: fixed },
    ] }, response('support'),
    () => { throw new ProviderRequestError('status 429', { limit: { kind: 'quota', code: 'RESOURCE_EXHAUSTED' } }); },
  ]);
  const replacement = makeFakeProvider([response('cover')]);
  const checked: string[] = [];
  const controller = new CadAgentController(original.provider, {
    checkCadProgram: async (candidate) => { checked.push(candidate.partId); return null; },
    checkCadAssembly: async () => null,
  });
  await assert.rejects(controller.planCadDesign('Two separate bodies'), (error: unknown) => {
    assert.ok(error instanceof ProviderRequestError);
    assert.equal(error.limit?.kind, 'quota');
    return true;
  });
  controller.setProvider(replacement.provider);
  const result = await controller.planCadDesign('Two separate bodies');
  assert.equal(result.mode, 'assembly');
  assert.equal(result.outcome.kind, 'create');
  assert.equal(original.mock.calls.length, 4);
  assert.equal(replacement.mock.calls.length, 1);
  assert.deepEqual(checked, ['support', 'cover']);
});

test('free design resolves a component question internally without rebuilding its support', async () => {
  const zero = { x: 0, y: 0, z: 0 };
  const fixed = { kind: 'fixed', axis: 'z', minimum: 0, maximum: 0, value: 0, pitch: 0, group: '', factor: 1 };
  const body = (id: string) => ({ decision: 'create', question: '', assumptions: [], spec: {
    schemaVersion: '3.0', units: 'mm', partId: id, steps: [{ id: 'body', op: 'base', shape: 'box',
      position: zero, rotation: zero, width: 10, depth: 10, height: 10 }],
  } });
  const { provider, mock } = makeFakeProvider([
    { kind: 'assembly', reason: 'support and shaft' },
    { decision: 'create', partId: 'clarification_resume', question: '', assumptions: [], components: [
      { id: 'support', action: 'build', description: 'support', position: zero, motion: fixed },
      { id: 'shaft', action: 'build', description: 'inferred shaft dimensions', position: { ...zero, x: 20 }, motion: fixed },
    ] }, body('support'), { decision: 'clarify', spec: null, question: 'Mover os munhões inferidos?', assumptions: [] }, body('shaft'),
  ]);
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false } });
  const checked: string[] = [];
  const controller = new CadAgentController(provider, {
    checkCadProgram: async (candidate) => { checked.push(candidate.partId); return null; }, checkCadAssembly: async () => null,
  });
  const request = 'Crie um suporte e um fuso com encaixes compatíveis';
  const result = await controller.planCadDesign(request);
  assert.equal(result.outcome.kind, 'create');
  assert.equal(mock.calls.length, 5);
  assert.deepEqual(checked, ['support', 'shaft']);
  await controller.planCadDesign(request);
  assert.equal(mock.calls.length, 5);
});

test('a single-part clarification is resolved internally before caching the validated generation', async () => {
  const zero = { x: 0, y: 0, z: 0 };
  const { provider, mock } = makeFakeProvider([
    { decision: 'clarify', spec: null, question: 'Qual objeto?', assumptions: [] },
    { decision: 'create', question: '', assumptions: [], spec: { schemaVersion: '3.0', units: 'mm', partId: 'plate', steps: [
      { id: 'body', op: 'base', shape: 'box', position: zero, rotation: zero, width: 40, depth: 20, height: 5 },
    ] } },
  ]);
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false } });
  const controller = new CadAgentController(provider, { checkCadProgram: async () => null, checkCadAssembly: async () => null });
  assert.equal((await controller.planCadProgram('Crie uma placa')).kind, 'create');
  assert.equal(mock.calls.length, 2);
  await controller.planCadProgram('Crie uma placa');
  assert.equal(mock.calls.length, 2);
});

const budgetSpec: CadProgramSpec = { schemaVersion: '3.0', units: 'mm', partId: 'limited', steps: [{ id: 'body', op: 'base',
  shape: 'box', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, width: 20, depth: 20, height: 10 }] };
const budgetResponse = { decision: 'create', question: '', assumptions: [], spec: budgetSpec };

test('all correction strategies share an AI budget and preserve the rejected draft', async () => {
  const { provider, mock } = makeFakeProvider([budgetResponse, budgetResponse]);
  const drafts: unknown[] = [];
  const controller = new CadAgentController(provider, { checkCadProgram: async () => 'CAD step body failed', checkCadAssembly: async () => null },
    { aiCalls: 1, cadChecks: 4, durationMs: 1000 });
  controller.setDraftListener((draft) => drafts.push(draft));
  await assert.rejects(controller.planCadProgram('Make a block'), /atingiu 1 chamadas/);
  assert.equal(mock.calls.length, 1);
  assert.ok(drafts.length > 0);
  assert.match((drafts.at(-1) as { issue: string }).issue, /orçamento limitado/);
});

test('distinct geometry checks cannot exceed the action limit even when the model improves its candidate', async () => {
  const { provider, mock } = makeFakeProvider([budgetResponse, { decision: 'edit', partId: 'limited',
    replaceSteps: [{ ...budgetSpec.steps[0], width: 30 }], insertSteps: [], removeStepIds: [], question: '', assumptions: [] }]);
  Object.assign(provider, { generationPolicy: { retryInvalidStructuredOutput: false } });
  let checks = 0;
  const controller = new CadAgentController(provider, { checkCadProgram: async () => { checks++; return 'CAD step body failed' }, checkCadAssembly: async () => null },
    { aiCalls: 4, cadChecks: 1, durationMs: 1000 });
  await assert.rejects(controller.planCadProgram('Make a block'), /atingiu 1 verificações/);
  assert.equal(checks, 1);
  assert.equal(mock.calls.length, 2);
});

test('an action deadline releases an unresponsive checker and allows the next generation', async () => {
  const { provider } = makeFakeProvider([budgetResponse, budgetResponse]);
  let checks = 0;
  const controller = new CadAgentController(provider, { checkCadProgram: async () => {
    checks++;
    return checks === 1 ? new Promise<string | null>(() => {}) : null;
  }, checkCadAssembly: async () => null }, { aiCalls: 3, cadChecks: 3, durationMs: 40 });
  await assert.rejects(controller.planCadProgram('Make a block'), CadActionBudgetError);
  assert.equal((await controller.planCadProgram('Make a block')).kind, 'create');
  assert.equal(checks, 2);
});

test('reordered JSON fields reuse a previously checked geometric candidate', async () => {
  const reordered = { steps: budgetSpec.steps, partId: budgetSpec.partId, units: budgetSpec.units, schemaVersion: budgetSpec.schemaVersion };
  const { provider, mock } = makeFakeProvider([budgetResponse, { ...budgetResponse, spec: reordered }]);
  let checks = 0;
  const controller = new CadAgentController(provider, { checkCadProgram: async () => { checks++; return null }, checkCadAssembly: async () => null });
  await controller.planCadProgram('Make a block');
  await controller.planCadProgram('Make the same block');
  assert.equal(mock.calls.length, 2);
  assert.equal(checks, 1);
});

