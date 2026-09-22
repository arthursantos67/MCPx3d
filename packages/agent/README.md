# packages/agent

`LLMProvider` abstraction, prompt composition, and structured `ModelPlan` generation (including ambiguity/clarification handling) for the local AI agent runtime (PRD §3.7 and §10.5, Issues #18, #19, and #20).

```bash
cd packages/agent
npm install
npm test
npm run typecheck
```

## `LLMProvider` abstraction (Issue #18)

[`src/provider.ts`](src/provider.ts) defines the `LLMProvider` interface (PRD §3.7): `isAvailable()`, `initialize()`, `generateStructured<T>(messages, schema, options?)`, and an optional `cancel()`. Nothing outside this package calls a specific LLM SDK directly (FR-27) -- every consumer, including this package's own [`generateModelPlan`](src/generate-model-plan.ts), depends only on this interface.

- [`src/webllm-provider.ts`](src/webllm-provider.ts) (`WebLLMProvider`, `createWebLLMProvider`) is the required implementation (PRD §3.6). It runs [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) in a Web Worker ([`src/webllm.worker.ts`](src/webllm.worker.ts)), detects WebGPU support before ever creating a worker or downloading a model, and implements structured generation with WebLLM's own `response_format: { type: "json_object", schema }` JSON mode. Its own richer status (`getState()`/`onStateChange()`, phases `idle`/`unsupported`/`loading`/`ready`/`generating`/`error`) goes beyond the `LLMProvider` interface, satisfying "provider exposes availability/init/structured-generation state." `detectWebGpu`/`createWorker`/`createEngine` are constructor-injected so it is unit-tested without a browser, GPU, or model download.

  This is a separate implementation from `apps/web/src/ai/webllm-runtime.ts` (Issue #16), not a reuse of it: that was Phase-0 spike code (PRD §14.1) written before this package existed and remains unwired/unused. FR-27 assigns "the provider package" (this one, per the root README's repository layout table) as the only place allowed to call WebLLM directly -- as of Issue #27, `apps/web/src/chat/useChatController.ts` depends on `createWebLLMProvider()` here (adapted into that module's own `AgentProvider` shape), not on the `apps/web` spike. Retiring or re-pointing the `apps/web` copy remains unstarted follow-up work.
- [`src/mock-provider.ts`](src/mock-provider.ts) (`MockLLMProvider`) is a deterministic provider for tests: scripted responses (a value, a JSON string -- so a test can script malformed JSON, or a function of the call's messages/schema) are consumed in order, one per call.
- [`src/model-config.ts`](src/model-config.ts) holds `DEFAULT_WEBLLM_MODEL_ID`. **Issue #17** (benchmark candidate models against actual `ModelPlan` quality and pick a real default plus a documented smaller fallback) **was explicitly skipped for this pass, at the user's request** -- there is no browser with WebGPU or GPU available to run a real benchmark in this environment, and fabricating quality/latency numbers was rejected as dishonest. This constant therefore still carries the same provisional id `apps/web`'s Issue #16 spike used. A real benchmark, `docs/model-benchmark.md`, and any resulting change to this id remain open work.

## Structured `ModelPlan` generation (Issue #19)

[`src/generate-model-plan.ts`](src/generate-model-plan.ts) (`generateModelPlan`) converts a user request + the current `ModelSpec` into a schema-constrained `ModelPlan` (PRD §3.9/§3.10, FR-29/FR-30/FR-31):

1. Compose messages: a system prompt ([`src/system-prompt.ts`](src/system-prompt.ts), Appendix D's contract plus the allowed operation set, coordinate convention, unit rules, and a [`ModelSpec` summary](src/model-spec-summary.ts)), any prior chat turns, and the user's request (with prior validation diagnostics appended, when given).
2. Ask the provider for structured output against `packages/domain`'s `model-plan.v1.schema.json` ([`src/schemas.ts`](src/schemas.ts) imports it directly from `packages/domain/schemas` via a static `with { type: "json" }` import, so this package and `packages/domain` never hold two copies that can drift; see the Issue #27 note below on why this is a static import and not `readFileSync`).
3. Validate the parsed result: JSON Schema (ajv) -> domain rules (`packages/domain/ts`'s `validateModelPlanDomainRules`) -> a heuristic check that every operation's `target` is a known object id (either already in the `ModelSpec`, or introduced earlier in the same plan by `create_object.id`/`duplicate_object.newId`).
4. Any failure gets **exactly one** format-repair retry (FR-30): a follow-up user message states what was wrong and asks for a corrected JSON-only response. A second failure raises `ModelPlanGenerationError` with the concrete reason instead of guessing.

The unknown-target check in step 3 is a heuristic, non-order-sensitive pre-check meant only to give the model a chance to self-correct before a plan is even sent toward the backend -- it is not the authoritative integrity boundary for PRD §8.4's "same atomic plan first creates it, and ordering is explicitly supported" rule. That remains `apps/api/src/api/mutation.py`'s job (Issue #7), which enforces true creation order and is unaffected by this package.

`summarizeModelSpec` (`src/model-spec-summary.ts`) is deliberately minimal -- just enough context for this generation loop. Issue #34 replaces it with a bounded, more complete summarizer; callers should not depend on its exact text format.

## Ambiguity/clarification handling (Issue #20)

§8.4's implementation note (Issue #7) explicitly left "keeping `clarify` apart from mutating operations" as prompt/agent-layer policy rather than a mutation-engine invariant. This package is that policy layer (FR-08, UC-05):

- Step 3 of `generateModelPlan`'s validation above also rejects a plan that combines a `clarify` operation with any other operation (mutating or not). Like any other invalid output, that goes through the same one-shot repair retry before `ModelPlanGenerationError` -- so a plan this function returns is always either a pure `clarify` (exactly one operation, nothing else) or contains no `clarify` at all, never a guess mixed with a question.
- [`buildClarificationFollowUp(question, answer)`](src/generate-model-plan.ts) turns a `clarify` operation's `question` and the user's next reply into the two `AgentMessage`s (`assistant` then `user`) a caller passes as `recentMessages` on the next `generateModelPlan` call, so that call sees its own prior question and the user's answer as context (FR-31). `recentMessages` already existed from Issue #19; this is the one piece of glue a caller needs to thread a clarification round trip through it.
- [`tests/clarification.test.ts`](tests/clarification.test.ts) covers 6 ambiguous-prompt scenarios that each produce a pure `clarify` plan, a mixed clarify+mutation plan being rejected then repaired, one that still mixes them after repair throwing instead of guessing, and the full clarify -> `buildClarificationFollowUp` -> disambiguated second call round trip.

`apps/api/src/api/routes/plans.py` (Issue #22) does not trust this package's guarantee from an untrusted caller and re-enforces "a `clarify`-containing plan never commits" as the authoritative boundary at the API layer.

## Why `packages/domain` is imported by relative path, not as an npm dependency

This package's source imports `packages/domain/ts/src/*` and `packages/domain/schemas/*.json` directly by relative path, the same way `packages/domain/ts/tests/support.ts` already does, rather than depending on a `@ai-web3d-modeler/domain` npm package. No package in this repository is set up to be installed/published outside this monorepo checkout (every `package.json` here is `"private": true`, and there is no npm workspaces configuration linking these folders), so a relative import is simpler and exactly as portable as an unpublished `file:` dependency would be, without inventing new packaging plumbing this repository doesn't otherwise use. As of Issue #27, `apps/web` reaches into *this* package's `src/*` the same way, for the same reason (see `apps/web/README.md`).

## Consumed by `apps/web` as of Issue #27

`generateModelPlan`/`createWebLLMProvider` were written and tested against `node --test` only until this issue actually imported them into a Vite/browser bundle (`apps/web/src/chat/`). That surfaced one real portability gap this package's own test suite could not: [`src/schemas.ts`](src/schemas.ts) previously loaded the ModelPlan JSON Schema via `node:fs`/`node:path`/`node:url` `readFileSync` at module-eval time -- fine under Node, fatal in a browser bundle (those modules have no browser implementation, so importing `generateModelPlan` into `apps/web` would throw immediately). Fixed by switching to the static JSON import described above; behavior and the single-source-of-truth intent are unchanged, only the loading mechanism is. This package's own test suite and typecheck were re-verified unaffected by the fix.

## A TypeScript note: `moduleResolution`

`tsconfig.json` uses `"moduleResolution": "bundler"`, not `"NodeNext"` like `packages/domain/ts`. Under `NodeNext`, TypeScript fails to resolve `@mlc-ai/web-llm`'s OpenAI-shaped types (e.g. `ChatCompletionMessageParam`) through its extensionless `export *` re-export chain, even though `node --test`'s actual runtime module resolution (which this setting does not affect) loads the package fine either way.
