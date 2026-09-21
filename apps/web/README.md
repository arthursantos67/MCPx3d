## Local AI runtime (`src/ai`)

[`src/ai/webgpu-capability.ts`](src/ai/webgpu-capability.ts) (`detectWebGpuCapability`) checks whether the default local AI mode can run in this browser/device before anything downloads a model (PRD FE-04/FE-05, Issue #15) -- it reports `{ status: "ready" }` or `{ status: "unsupported", reason }`, and the reason text is scoped to AI-mode availability, never implying the 3D viewer itself is unsupported. [`src/ai/webllm-runtime.ts`](src/ai/webllm-runtime.ts) (`WebLlmRuntime`, `createWebLlmRuntime`) loads and runs [`@mlc-ai/web-llm`](https://github.com/mlc-ai/web-llm) inside a Web Worker ([`src/ai/webllm.worker.ts`](src/ai/webllm.worker.ts)) so model init/inference never blocks the main thread (PRD §3.1/§3.6, FR-28, Issue #16); it runs WebGPU detection first, exposes `idle`/`unsupported`/`loading` (with progress)/`ready`/`error` status via `getStatus()`/`onStatusChange()`, and supports cancellation through `interruptGenerate` where the loaded engine offers it (FR-33). [`src/ai/useWebLlmRuntime.ts`](src/ai/useWebLlmRuntime.ts) exposes that status as React state via `useSyncExternalStore`. Second-load model caching is handled by `@mlc-ai/web-llm` itself (browser Cache Storage) -- nothing here implements a custom cache. [`src/ai/model-config.ts`](src/ai/model-config.ts) holds the single default model id (`DEFAULT_WEBLLM_MODEL_ID`); it's provisional pending Issue #17's benchmark-based model selection. None of this is wired into UI yet -- `App.tsx` is still the unmodified Vite scaffold; that's FE-01's workspace layout, a separate not-yet-implemented issue.

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
