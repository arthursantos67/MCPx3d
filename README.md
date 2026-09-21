# AI Web3D Modeler

A web app where a user describes a 3D object in chat, a local in-browser AI agent turns that into a structured `ModelPlan`, the app applies it to a renderer-independent `ModelSpec`, and X3D generation/validation/rendering is delegated to the `x3d_mcp` tool service.

- Product/architecture baseline: [`PRD-AI-Web3D-Modeler-v1.0.md`](PRD-AI-Web3D-Modeler-v1.0.md)
- Implementation plan: [`ISSUES-AI-Web3D-Modeler-v1.0.md`](ISSUES-AI-Web3D-Modeler-v1.0.md)

## Repository layout

| Path | Runtime | Responsibility |
| --- | --- | --- |
| `apps/web` | React + TypeScript + Vite | Chat workspace, WebLLM runtime, 3D viewer, downloads, local project cache |
| `apps/api` | Python 3.12+ / FastAPI | Session/project orchestration, ModelPlan validation, `x3d_mcp` client, artifact endpoints |
| `packages/domain` | TS/Python schema mirror | Shared `ModelSpec`/`ModelPlan` types + JSON Schema |
| `packages/agent` | TypeScript | `LLMProvider` abstraction, prompt composition, JSON parsing/repair loop |
| `packages/viewer` | TypeScript | Sandboxed preview iframe, camera reset, scene reload |
| `services/` | Python 3.12+ | Pinned upstream `x3d_mcp` dependency/service (Web3D Consortium) |
| `tests/golden` | JSON/Markdown | Golden prompts and their expected structural properties |
| `docs/` | Markdown | Architecture, ADRs, setup, model support, roadmap |

## Prerequisites

- Node.js current LTS (tested with Node v24)
- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/) (`python -m pip install uv`, or see the official installer; ensure its install location is on `PATH`, e.g. `%APPDATA%\Python\Python3XX\Scripts` on Windows)
- Git
- A browser with WebGPU support (for the default local AI mode)

No AI API key is required for the default local setup.

## Startup

### 1. Frontend (`apps/web`)

```bash
cd apps/web
npm install
npm run dev
```

Serves at `http://localhost:5173`. [`apps/web/src/ai/webgpu-capability.ts`](apps/web/src/ai/webgpu-capability.ts) detects whether the default local AI mode can run before any model download starts (Issue #15); [`apps/web/src/ai/webllm-runtime.ts`](apps/web/src/ai/webllm-runtime.ts) loads and runs WebLLM in a Web Worker so model init/inference never blocks the UI thread, exposing status/progress to React via [`apps/web/src/ai/useWebLlmRuntime.ts`](apps/web/src/ai/useWebLlmRuntime.ts) (Issue #16). See [`apps/web/README.md`](apps/web/README.md) for details. Neither is wired into a chat/workspace UI yet -- that's FE-01, a separate not-yet-implemented issue.

### 2. API (`apps/api`)

```bash
cd apps/api
cp .env.example .env  # optional, defaults work out of the box
uv run uvicorn api.main:app --reload --port 8001
```

Serves at `http://localhost:8001` (interactive docs at `/docs`). Configuration (MCP base URL, timeouts, session TTL, default units/display scale, complexity limits, CORS origins) is typed and validated at startup — see [`apps/api/src/api/config.py`](apps/api/src/api/config.py) and `apps/api/.env.example`. `GET /api/health` reports API liveness; `GET /api/health/mcp` reports `x3d_mcp` reachability separately. [`apps/api/src/api/mcp_client.py`](apps/api/src/api/mcp_client.py) (`X3DMcpClient`) wraps the `x3d_mcp` Streamable HTTP tool surface (scene create/reset, primitive creation, schema/semantic validation, X3DOM page generation) behind typed methods and errors, per PRD §9.5. [`apps/api/src/api/mutation.py`](apps/api/src/api/mutation.py) deterministically applies a `ModelPlan` to a `ModelSpec` (PRD §8.4, Issue #7). [`apps/api/src/api/projects.py`](apps/api/src/api/projects.py) (`ProjectSessionService`) owns in-memory project/session state, TTL expiry, and revision-checked commits (PRD §9.1, Issue #8). [`apps/api/src/api/x3d_adapter.py`](apps/api/src/api/x3d_adapter.py) renders a `ModelSpec` to X3D through `X3DMcpClient` (PRD §10.6, Issue #9). [`apps/api/src/api/x3d_validation.py`](apps/api/src/api/x3d_validation.py) runs the full build → schema/semantic validate → autofix → revalidate pipeline and only ever returns a result for a valid candidate, raising otherwise (PRD FR-14/15/16, Issue #10). [`apps/api/src/api/artifacts.py`](apps/api/src/api/artifacts.py) builds the downloadable standalone-HTML, X3D XML, `.x3dj`/`.x3dv` conversion, and ModelSpec manifest artifacts for a validated revision, rejecting stale revision requests (PRD FR-18/19/20/21/22/36, Issues #11, #12, #13, and #14). `.x3dj` conversion currently always raises `ArtifactConversionError`: the pinned `x3d_mcp` commit's `convert_x3d(to_encoding="json")` has a pre-existing upstream serialization bug that never produces well-formed JSON (see that class's docstring); `.x3dv` conversion works. None of these route AI-produced content through `eval`/`exec`/raw XML — see PRD §11.2.

[`apps/api/src/api/routes/projects.py`](apps/api/src/api/routes/projects.py) wires `ProjectSessionService` to HTTP: `POST /api/projects`, `GET /api/projects/{id}`, `DELETE /api/projects/{id}` (PRD §9.1, Issue #21). Error responses across routes follow PRD §9.4's standardized `{code, message, details, correlationId}` body via [`apps/api/src/api/errors.py`](apps/api/src/api/errors.py)'s `api_error` helper.

[`apps/api/src/api/routes/plans.py`](apps/api/src/api/routes/plans.py)'s `POST /api/projects/{id}/plans` is the central mutation transaction (PRD §9.2/§9.3, Issue #22): validate the request → reject a `clarify`-containing plan as `422 AMBIGUOUS_TARGET` before touching MCP → check the expected revision → `apply_plan` → build/validate the candidate as X3D → commit → describe available artifacts, all through the modules above.

### 3. `x3d_mcp` (`services/x3d-mcp`)

```bash
git submodule update --init --recursive services/x3d-mcp/vendor
./services/x3d-mcp/run.sh
```

Serves at `http://localhost:8000` (`/pulse` health check, `/mcp` MCP endpoint). See [`services/x3d-mcp/README.md`](services/x3d-mcp/README.md) and [`docs/x3d-mcp.md`](docs/x3d-mcp.md) for the pinned commit and a required dependency pin.

### 4. Shared domain schemas (`packages/domain`)

Not a running service — the `ModelSpec`/`ModelPlan` v1 JSON Schemas and their TypeScript/Python type mirrors that `apps/web`, `apps/api`, and `packages/agent` build on. See [`packages/domain/README.md`](packages/domain/README.md).

### 5. Agent runtime (`packages/agent`)

Not a running service — the `LLMProvider` abstraction (`isAvailable`/`initialize`/`generateStructured`/`cancel`, PRD §3.7, FR-27, Issue #18), its required `WebLLMProvider` implementation, and `generateModelPlan` (Issue #19), which turns a user request + the current `ModelSpec` into a schema-validated `ModelPlan` with a one-shot repair retry on invalid output (FR-29/FR-30). `generateModelPlan` also rejects (and retries) a plan that combines a `clarify` with any other operation, and `buildClarificationFollowUp` threads a clarify question and the user's answer into the next call's `recentMessages` (PRD FR-08/UC-05, Issue #20). See [`packages/agent/README.md`](packages/agent/README.md). Not wired into a chat UI yet -- that's Issue #27. **Issue #17** (benchmarking candidate WebLLM models and picking a real default) **was explicitly skipped for this pass**, at the user's request, since this environment has no browser with WebGPU to run a real benchmark on; see `packages/agent/README.md` for what that leaves open.

## Lint and typecheck

| | Lint | Typecheck |
| --- | --- | --- |
| `apps/web` | `npm run lint` | `npm run typecheck` |
| `apps/api` | `uv run ruff check .` | `uv run mypy` |
| `packages/domain/ts` | — | `npm run typecheck` |
| `packages/domain/python` | `uv run ruff check .` | `uv run mypy` |
| `packages/agent` | — | `npm run typecheck` |

## Tests

- `apps/api`: `uv run pytest` (includes an `X3DMcpClient` integration test that runs the real `services/x3d-mcp` server as a subprocess; skipped automatically if `uv` or the vendor submodule isn't available)
- `apps/web`: `npm test` (`src/ai`'s WebGPU/WebLLM logic against injected fakes -- no browser, GPU, or model download involved; see `apps/web/README.md`)
- `packages/domain/ts`: `npm test`
- `packages/domain/python`: `uv run pytest`
- `packages/agent`: `npm test` (provider/generation logic against injected fakes and a `MockLLMProvider` -- no browser, GPU, or model download involved; see `packages/agent/README.md`)

## Product limitations

AI Web3D Modeler is a Web3D modeling system, **not** a mechanical CAD system. It does not promise STEP export, manufacturing tolerances, or guaranteed-manifold geometry. See PRD §1.2 for the full non-goals list.
