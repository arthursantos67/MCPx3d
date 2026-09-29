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

## Reusable recipes

The API keeps a local SQLite catalog at `apps/api/data/recipes.sqlite3` (override with `RECIPE_DATABASE_PATH`). It starts with a validated nine-part dining table and a 65-part kitchen with a separate island, two pendants, cabinet and refrigerator handles, a recessed sink, a stove and its hood. Open **Recipes** in the workspace to apply a saved recipe to an empty project or save the current validated model. Generic requests such as “quero uma mesa” or “crie uma cozinha completa, sem sobreposição, com puxadores, torneira e lustres” use the catalog directly; requests with custom dimensions, layout, appliances or colors still use the AI planner. Recipe application passes through the same X3D validation and revision commit as any other plan.

Recipes survive API restarts; active projects still use temporary in-memory sessions. The catalog is shared by everyone who can access this API, so run this deployment as a private workspace until account ownership and authorization are implemented. Recipes describe the current primitive-based Web3D model, not manufacturing-ready CAD features. See [`docs/cad-readiness.md`](docs/cad-readiness.md) for the next-stage contract.

## Experimental CAD parts

Start the API with `uv run --extra cad api` from `apps/api`, then select **CAD** in the workspace. **Construção livre** is the default editor: describe a part, inspect the rotatable 3D preview, adjust individual construction steps, save a revision and download STEP. The program combines positioned and rotated boxes, cylinders, spheres, cones and extruded polygon profiles using union and cut operations. Repeated shapes and cuts can be arranged in circular or linear patterns for teeth, bolt circles, ribs and hole rows. The [example program](examples/cad/construction_program.json) and [STEP](examples/cad/construction_program.step) passed an independent FreeCAD import check. The earlier mounting plate, L bracket, rounded plate, circular flange and composite part editors remain under **Moldes**. CAD projects use a separate SQLite store (`CAD_DATABASE_PATH`, default `apps/api/data/cad.sqlite3`) and do not change Web3D scenes or its recipe catalog. See [`docs/cad-readiness.md`](docs/cad-readiness.md) for the exact geometry limits and remaining mechanical features.

For a new CAD project, enter a request in **Construção CAD**. Try “Crie um suporte mecânico em L com base de 80 × 50 × 10 mm, ressalto cilíndrico Ø30 com altura 10 mm, furo central Ø12 atravessando a base e o ressalto, e dois furos transversais Ø6”. The provider proposes a complete construction sequence and lists inferred dimensions. The server verifies one connected solid and checks its STEP round trip before saving. The 3D preview is a mesh of that geometry; the STEP is the exchange artifact for FreeCAD. Native constrained sketches, fillets, true threads, assemblies and manufacturing tolerances are not yet supported.

## Project recovery

Reloading the page reconnects to the last live project session in the same browser. Use **Download → MANIFEST** to keep a portable JSON copy; **Import** restores it into the current session after schema, domain and X3D validation. Importing replaces the current model and conversation after confirmation. Browser reload recovery lasts only while the API session is alive; keep a manifest for longer-term storage.

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
uv run api
```

Serves at `http://localhost:8001` (interactive docs at `/docs`).

### 3. Frontend (`apps/web`)

```bash
npm install
npm run dev:web
```

Serves at `http://localhost:5173`. Open this in a browser to use the app.
