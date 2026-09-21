# packages/agent

`LLMProvider` abstraction for the local AI agent runtime (PRD §3.7, Issue #18).

```bash
cd packages/agent
npm install
npm test
npm run typecheck
```

## `LLMProvider` abstraction (Issue #18)

[`src/provider.ts`](src/provider.ts) defines the `LLMProvider` interface (PRD §3.7): `isAvailable()`, `initialize()`, `generateStructured<T>(messages, schema, options?)`, and an optional `cancel()`. Nothing outside this package calls a specific LLM SDK directly (FR-27) -- every consumer depends only on this interface.

- [`src/webllm-provider.ts`](src/webllm-provider.ts) (`WebLLMProvider`, `createWebLLMProvider`) is the required implementation (PRD §3.6). It runs [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) in a Web Worker ([`src/webllm.worker.ts`](src/webllm.worker.ts)), detects WebGPU support before ever creating a worker or downloading a model, and implements structured generation with WebLLM's own `response_format: { type: "json_object", schema }` JSON mode. Its own richer status (`getState()`/`onStateChange()`, phases `idle`/`unsupported`/`loading`/`ready`/`generating`/`error`) goes beyond the `LLMProvider` interface, satisfying "provider exposes availability/init/structured-generation state." `detectWebGpu`/`createWorker`/`createEngine` are constructor-injected so it is unit-tested without a browser, GPU, or model download.

  This is a separate implementation from `apps/web/src/ai/webllm-runtime.ts` (Issue #16), not a reuse of it: that was Phase-0 spike code (PRD §14.1) written before this package existed and is still not wired into any UI. FR-27 assigns "the provider package" (this one, per the root README's repository layout table) as the only place allowed to call WebLLM directly, so future chat UI work (Issue #27) should depend on `WebLLMProvider` here, not on the `apps/web` spike. Retiring or re-pointing the `apps/web` copy is unstarted follow-up work, not part of this issue.
- [`src/mock-provider.ts`](src/mock-provider.ts) (`MockLLMProvider`) is a deterministic provider for tests: scripted responses (a value, a JSON string -- so a test can script malformed JSON, or a function of the call's messages/schema) are consumed in order, one per call.
- [`src/model-config.ts`](src/model-config.ts) holds `DEFAULT_WEBLLM_MODEL_ID`. **Issue #17** (benchmark candidate models against actual `ModelPlan` quality and pick a real default plus a documented smaller fallback) **was explicitly skipped for this pass, at the user's request** -- there is no browser with WebGPU or GPU available to run a real benchmark in this environment, and fabricating quality/latency numbers was rejected as dishonest. This constant therefore still carries the same provisional id `apps/web`'s Issue #16 spike used. A real benchmark, `docs/model-benchmark.md`, and any resulting change to this id remain open work.

## A TypeScript note: `moduleResolution`

`tsconfig.json` uses `"moduleResolution": "bundler"`, not `"NodeNext"` like `packages/domain/ts`. Under `NodeNext`, TypeScript fails to resolve `@mlc-ai/web-llm`'s OpenAI-shaped types (e.g. `ChatCompletionMessageParam`) through its extensionless `export *` re-export chain, even though `node --test`'s actual runtime module resolution (which this setting does not affect) loads the package fine either way.
