# AI Web3D Modeler

A web app where a user describes a 3D object in chat, a local in-browser AI agent turns that into a structured `ModelPlan`, the app applies it to a renderer-independent `ModelSpec`, and X3D generation/validation/rendering is delegated to the `x3d_mcp` tool service.

- Product/architecture baseline: [`PRD-AI-Web3D-Modeler-v1.0.md`](PRD-AI-Web3D-Modeler-v1.0.md)
- Implementation plan: [`ISSUES-AI-Web3D-Modeler-v1.0.md`](ISSUES-AI-Web3D-Modeler-v1.0.md)

## Prerequisites

- Node.js current LTS (tested with Node v24)
- Python 3.12+
- [`uv`](https://docs.astral.sh/uv/) (`python -m pip install uv`, or see the official installer; ensure its install location is on `PATH`, e.g. `%APPDATA%\Python\Python3XX\Scripts` on Windows)
- Git
- A browser with WebGPU support (for the default local AI mode) -- or an API key from an OpenAI-compatible provider (e.g. Groq) if not, see `apps/web`'s "AI Provider" settings

No AI API key is required for the default local setup.

## Startup

Start these in order -- `apps/api` needs `x3d_mcp` reachable, and `apps/web` needs `apps/api` reachable.

### 1. `x3d_mcp` (`services/x3d-mcp`)

```bash
git submodule update --init --recursive services/x3d-mcp/vendor
./services/x3d-mcp/run.sh
```

Serves at `http://localhost:8000`.

### 2. API (`apps/api`)

```bash
cd apps/api
cp .env.example .env  # optional, defaults work out of the box
uv run uvicorn api.main:app --reload --port 8001
```

Serves at `http://localhost:8001` (interactive docs at `/docs`).

### 3. Frontend (`apps/web`)

```bash
npm install
npm run dev:web
```

Serves at `http://localhost:5173`. Open this in a browser to use the app.
