# packages/agent

`LLMProvider` abstraction, prompt composition, and structured `ModelPlan` generation for the local AI agent runtime (PRD §3.7 and §10.5, Issues #18 and #19).

```bash
cd packages/agent
npm install
npm test
npm run typecheck
```

## `LLMProvider` abstraction (Issue #18)

[`src/provider.ts`](src/provider.ts) defines the `LLMProvider` interface (PRD §3.7): `isAvailable()`, `initialize()`, `generateStructured<T>(messages, schema, options?)`, and an optional `cancel()`. Nothing outside this package calls a specific LLM SDK directly (FR-27) -- every consumer, including this package's own [`generateModelPlan`](src/generate-model-plan.ts), depends only on this interface.

- [`src/webllm-provider.ts`](src/webllm-provider.ts) (`WebLLMProvider`, `createWebLLMProvider`) is the required implementation (PRD §3.6). It runs [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) in a Web Worker ([`src/webllm.worker.ts`](src/webllm.worker.ts)), detects WebGPU support before ever creating a worker or downloading a model, and implements structured generation with WebLLM's own `response_format: { type: "json_object", schema }` JSON mode. Its own richer status (`getState()`/`onStateChange()`, phases `idle`/`unsupported`/`loading`/`ready`/`generating`/`error`) goes beyond the `LLMProvider` interface, satisfying "provider exposes availability/init/structured-generation state." `detectWebGpu`/`createWorker`/`createEngine` are constructor-injected so it is unit-tested without a browser, GPU, or model download.

  This is a separate implementation from `apps/web/src/ai/webllm-runtime.ts` (Issue #16), not a reuse of it: that was Phase-0 spike code (PRD §14.1) written before this package existed and is still not wired into any UI. FR-27 assigns "the provider package" (this one, per the root README's repository layout table) as the only place allowed to call WebLLM directly, so future chat UI work (Issue #27) should depend on `WebLLMProvider` here, not on the `apps/web` spike. Retiring or re-pointing the `apps/web` copy is unstarted follow-up work, not part of #18/#19.
- [`src/mock-provider.ts`](src/mock-provider.ts) (`MockLLMProvider`) is a deterministic provider for tests: scripted responses (a value, a JSON string -- so a test can script malformed JSON, or a function of the call's messages/schema) are consumed in order, one per call.
- [`src/model-config.ts`](src/model-config.ts) holds `DEFAULT_WEBLLM_MODEL_ID`. **Issue #17** (benchmark candidate models against actual `ModelPlan` quality and pick a real default plus a documented smaller fallback) **was explicitly skipped for this pass, at the user's request** -- there is no browser with WebGPU or GPU available to run a real benchmark in this environment, and fabricating quality/latency numbers was rejected as dishonest. This constant therefore still carries the same provisional id `apps/web`'s Issue #16 spike used. A real benchmark, `docs/model-benchmark.md`, and any resulting change to this id remain open work.

## Structured `ModelPlan` generation (Issue #19)

[`src/generate-model-plan.ts`](src/generate-model-plan.ts) (`generateModelPlan`) converts a user request + the current `ModelSpec` into a schema-constrained `ModelPlan` (PRD §3.9/§3.10, FR-29/FR-30/FR-31):

1. Compose messages: a system prompt ([`src/system-prompt.ts`](src/system-prompt.ts), Appendix D's contract plus the allowed operation set, coordinate convention, unit rules, and a [`ModelSpec` summary](src/model-spec-summary.ts)), any prior chat turns, and the user's request (with prior validation diagnostics appended, when given).
2. Ask the provider for structured output against `packages/domain`'s `model-plan.v1.schema.json` ([`src/schemas.ts`](src/schemas.ts) loads it at runtime from `packages/domain/schemas`, so this package and `packages/domain` never hold two copies that can drift).
3. Validate the parsed result: JSON Schema (ajv) -> domain rules (`packages/domain/ts`'s `validateModelPlanDomainRules`) -> a heuristic check that every operation's `target` is a known object id (either already in the `ModelSpec`, or introduced earlier in the same plan by `create_object.id`/`duplicate_object.newId`).
4. Any failure gets **exactly one** format-repair retry (FR-30): a follow-up user message states what was wrong and asks for a corrected JSON-only response. A second failure raises `ModelPlanGenerationError` with the concrete reason instead of guessing.

The unknown-target check in step 3 is a heuristic, non-order-sensitive pre-check meant only to give the model a chance to self-correct before a plan is even sent toward the backend -- it is not the authoritative integrity boundary for PRD §8.4's "same atomic plan first creates it, and ordering is explicitly supported" rule. That remains `apps/api/src/api/mutation.py`'s job (Issue #7), which enforces true creation order and is unaffected by this package.

`summarizeModelSpec` (`src/model-spec-summary.ts`) is deliberately minimal -- just enough context for this generation loop. Issue #34 replaces it with a bounded, more complete summarizer; callers should not depend on its exact text format.

## Why `packages/domain` is imported by relative path, not as an npm dependency

This package's source imports `packages/domain/ts/src/*` and reads `packages/domain/schemas/*.json` directly by relative path, the same way `packages/domain/ts/tests/support.ts` already does, rather than depending on a `@ai-web3d-modeler/domain` npm package. No package in this repository is set up to be installed/published outside this monorepo checkout (every `package.json` here is `"private": true`, and there is no npm workspaces configuration linking these folders), so a relative import is simpler and exactly as portable as an unpublished `file:` dependency would be, without inventing new packaging plumbing this repository doesn't otherwise use.

## A TypeScript note: `moduleResolution`

`tsconfig.json` uses `"moduleResolution": "bundler"`, not `"NodeNext"` like `packages/domain/ts`. Under `NodeNext`, TypeScript fails to resolve `@mlc-ai/web-llm`'s OpenAI-shaped types (e.g. `ChatCompletionMessageParam`) through its extensionless `export *` re-export chain, even though `node --test`'s actual runtime module resolution (which this setting does not affect) loads the package fine either way.
