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

Serves at `http://localhost:8001` (interactive docs at `/docs`). Configuration (MCP base URL, timeouts, session TTL, complexity limits, CORS origins) is typed and validated at startup — see [`apps/api/src/api/config.py`](apps/api/src/api/config.py) and `apps/api/.env.example`. `GET /api/health` reports API liveness; `GET /api/health/mcp` reports `x3d_mcp` reachability separately.

### 3. `x3d_mcp` (`services/x3d-mcp`)

```bash
git submodule update --init --recursive services/x3d-mcp/vendor
./services/x3d-mcp/run.sh
```

Serves at `http://localhost:8000` (`/pulse` health check, `/mcp` MCP endpoint). See [`services/x3d-mcp/README.md`](services/x3d-mcp/README.md) and [`docs/x3d-mcp.md`](docs/x3d-mcp.md) for the pinned commit and a required dependency pin.

## Lint and typecheck

| | Lint | Typecheck |
| --- | --- | --- |
| `apps/web` | `npm run lint` | `npm run typecheck` |
| `apps/api` | `uv run ruff check .` | `uv run mypy src` |

## Tests

- `apps/api`: `uv run pytest`

## Product limitations

AI Web3D Modeler is a Web3D modeling system, **not** a mechanical CAD system. It does not promise STEP export, manufacturing tolerances, or guaranteed-manifold geometry. See PRD §1.2 for the full non-goals list.
