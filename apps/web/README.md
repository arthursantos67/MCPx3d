## Local AI runtime (`src/ai`) -- unused Phase-0 spike, not the real integration

[`src/ai/webgpu-capability.ts`](src/ai/webgpu-capability.ts) (`detectWebGpuCapability`) checks whether the default local AI mode can run in this browser/device before anything downloads a model (PRD FE-04/FE-05, Issue #15) -- it reports `{ status: "ready" }` or `{ status: "unsupported", reason }`, and the reason text is scoped to AI-mode availability, never implying the 3D viewer itself is unsupported. [`src/ai/webllm-runtime.ts`](src/ai/webllm-runtime.ts) (`WebLlmRuntime`, `createWebLlmRuntime`) loads and runs [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) inside a Web Worker ([`src/ai/webllm.worker.ts`](src/ai/webllm.worker.ts)) so model init/inference never blocks the main thread (PRD §3.1/§3.6, FR-28, Issue #16); it runs WebGPU detection first, exposes `idle`/`unsupported`/`loading` (with progress)/`ready`/`error` status via `getStatus()`/`onStatusChange()`, and supports cancellation through `interruptGenerate` where the loaded engine offers it (FR-33). [`src/ai/useWebLlmRuntime.ts`](src/ai/useWebLlmRuntime.ts) exposes that status as React state via `useSyncExternalStore`. Second-load model caching is handled by `@mlc-ai/web-llm` itself (browser Cache Storage) -- nothing here implements a custom cache. [`src/ai/model-config.ts`](src/ai/model-config.ts) holds the single default model id (`DEFAULT_WEBLLM_MODEL_ID`); it's provisional pending Issue #17's benchmark-based model selection.

**This module stays unused.** It was Phase-0 spike code (PRD §14.1) written before `packages/agent` existed. PRD §3.7 assigns "the provider package" (`packages/agent`) as the only place allowed to call WebLLM directly, so the real chat integration (Issue #27, below) depends on `packages/agent`'s `WebLLMProvider` instead of this. Retiring this directory is open follow-up, not done as part of #27.

## Chat (`src/chat`, Issues #26/#27)

`ChatPanel.tsx` (+ `MessageList.tsx`/`GenerationProgress.tsx`/`PromptComposer.tsx`/`ChatPanel.css`) is the presentational half; `ChatController.ts` is a framework-agnostic state machine (no React) that a user prompt flows through: `packages/agent`'s `generateModelPlan` (against a `WebLLMProvider`, adapted to this module's own `AgentProvider`/`AgentStatus` shape by `useChatController.ts`'s `toAgentProvider`) → a pure-`clarify` plan short-circuits to an assistant question instead of being POSTed (it would otherwise be rejected by the backend as `422 AMBIGUOUS_TARGET`) → otherwise `apps/web/src/api/client.ts`'s `applyPlan` POSTs it to `apps/api`, and `modelSpec`/`revision`/`previewUrl` only update on success. `useChatController.ts` is the `useSyncExternalStore` React wrapper, called once in `WorkspaceShell` (not inside `ChatPanel`), since the viewer needs the same controller's `previewUrl`. See `PRD-AI-Web3D-Modeler-v1.0.md` §10.1/§10.5's Issue #26/#27 implementation notes for the full detail, including why `packages/agent/src/schemas.ts` needed a fix before any of this could run in a browser at all.

## Viewer (`src/viewer`, Issue #28)

`X3DPreviewFrame.tsx` fetches the current revision's standalone HTML from the backend and embeds it via a Blob URL in a sandboxed `<iframe sandbox="allow-scripts">` -- never `srcDoc`/`dangerouslySetInnerHTML` with the raw HTML (PRD §11.4). `objectUrl.ts`'s `BlobUrlTracker` revokes the previous Blob URL only after a new one replaces it. See `PRD-AI-Web3D-Modeler-v1.0.md` §9.1/§10.3's Issue #28 implementation note, including the backend route (`GET /api/projects/{id}/artifacts/html`) this component needed that didn't exist yet.

## Cross-package imports (`packages/agent`, `packages/domain`)

This repository has no npm-workspaces root, so `src/chat` and `src/api` import `packages/agent/src/*` and `packages/domain/ts/src/*` by relative path (e.g. `../../../../packages/agent/src/provider.ts`), the same convention `packages/agent` already uses to reach `packages/domain` (see `packages/agent/README.md`). `vite.config.ts` sets `server.fs.allow` to the repository root so the dev server can serve those files -- without it, Vite's default `fs.allow` (derived from the nearest workspace root, which would otherwise resolve to `apps/web` itself) 403s them.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
