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

Serves at `http://localhost:5173`.

### 2. API (`apps/api`)

```bash
cd apps/api
cp .env.example .env  # optional, defaults work out of the box
uv run uvicorn api.main:app --reload --port 8001
```

Serves at `http://localhost:8001` (interactive docs at `/docs`). Configuration (MCP base URL, timeouts, session TTL, default units/display scale, complexity limits, CORS origins) is typed and validated at startup — see [`apps/api/src/api/config.py`](apps/api/src/api/config.py) and `apps/api/.env.example`. `GET /api/health` reports API liveness; `GET /api/health/mcp` reports `x3d_mcp` reachability separately. [`apps/api/src/api/mcp_client.py`](apps/api/src/api/mcp_client.py) (`X3DMcpClient`) wraps the `x3d_mcp` Streamable HTTP tool surface (scene create/reset, primitive creation, schema/semantic validation, X3DOM page generation) behind typed methods and errors, per PRD §9.5. [`apps/api/src/api/mutation.py`](apps/api/src/api/mutation.py) deterministically applies a `ModelPlan` to a `ModelSpec` (PRD §8.4, Issue #7). [`apps/api/src/api/projects.py`](apps/api/src/api/projects.py) (`ProjectSessionService`) owns in-memory project/session state, TTL expiry, and revision-checked commits (PRD §9.1, Issue #8). [`apps/api/src/api/x3d_adapter.py`](apps/api/src/api/x3d_adapter.py) renders a `ModelSpec` to X3D through `X3DMcpClient` (PRD §10.6, Issue #9). [`apps/api/src/api/x3d_validation.py`](apps/api/src/api/x3d_validation.py) runs the full build → schema/semantic validate → autofix → revalidate pipeline and only ever returns a result for a valid candidate, raising otherwise (PRD FR-14/15/16, Issue #10). [`apps/api/src/api/artifacts.py`](apps/api/src/api/artifacts.py) builds the downloadable standalone-HTML, X3D XML, and `.x3dj`/`.x3dv` conversion artifacts for a validated revision, rejecting stale revision requests (PRD FR-18/19/20/21/22, Issues #11, #12, and #13). `.x3dj` conversion currently always raises `ArtifactConversionError`: the pinned `x3d_mcp` commit's `convert_x3d(to_encoding="json")` has a pre-existing upstream serialization bug that never produces well-formed JSON (see that class's docstring); `.x3dv` conversion works. None of these route AI-produced content through `eval`/`exec`/raw XML — see PRD §11.2.

### 3. `x3d_mcp` (`services/x3d-mcp`)

```bash
git submodule update --init --recursive services/x3d-mcp/vendor
./services/x3d-mcp/run.sh
```

Serves at `http://localhost:8000` (`/pulse` health check, `/mcp` MCP endpoint). See [`services/x3d-mcp/README.md`](services/x3d-mcp/README.md) and [`docs/x3d-mcp.md`](docs/x3d-mcp.md) for the pinned commit and a required dependency pin.

### 4. Shared domain schemas (`packages/domain`)

Not a running service — the `ModelSpec`/`ModelPlan` v1 JSON Schemas and their TypeScript/Python type mirrors that `apps/web`, `apps/api`, and `packages/agent` build on. See [`packages/domain/README.md`](packages/domain/README.md).

## Lint and typecheck

| | Lint | Typecheck |
| --- | --- | --- |
| `apps/web` | `npm run lint` | `npm run typecheck` |
| `apps/api` | `uv run ruff check .` | `uv run mypy` |
| `packages/domain/ts` | — | `npm run typecheck` |
| `packages/domain/python` | `uv run ruff check .` | `uv run mypy` |

## Tests

- `apps/api`: `uv run pytest` (includes an `X3DMcpClient` integration test that runs the real `services/x3d-mcp` server as a subprocess; skipped automatically if `uv` or the vendor submodule isn't available)
- `packages/domain/ts`: `npm test`
- `packages/domain/python`: `uv run pytest`

## Product limitations

AI Web3D Modeler is a Web3D modeling system, **not** a mechanical CAD system. It does not promise STEP export, manufacturing tolerances, or guaranteed-manifold geometry. See PRD §1.2 for the full non-goals list.
