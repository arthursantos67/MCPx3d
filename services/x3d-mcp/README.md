# services/x3d-mcp

Runs the upstream [Web3D Consortium `x3d_mcp`](https://github.com/Web3DConsortium/x3d_mcp) server as a pinned, reproducible dependency in Streamable HTTP mode.

- `vendor/` — git submodule pinned to a tested upstream commit (see `docs/x3d-mcp.md`). Do not edit files inside it; changes belong upstream.
- `run.sh` — executable POSIX entrypoint that starts the server with the correct transport/env and a working dependency pin.
- `.env.example` — copy to `.env` and adjust `PORT`/`HOST` if needed.

## Setup

```bash
git submodule update --init --recursive services/x3d-mcp/vendor
```

## Run

```bash
./services/x3d-mcp/run.sh
```

Defaults: `MCP_TRANSPORT=streamable-http`, `PORT=8000`, `HOST=0.0.0.0`.

- Health check: `GET http://localhost:8000/pulse` → `{"status":"ok"}`
- Server info: `GET http://localhost:8000/`
- MCP endpoint: `http://localhost:8000/mcp` (Streamable HTTP; a bare `GET` correctly returns `406` — connect with an MCP client, not a browser/curl GET)

## Known pin: `mcp<2`

The vendored commit declares `mcp>=1.7` with no upper bound. A plain `uv sync`/`uv run` inside `vendor/` resolves `mcp` 2.x, which renamed `FastMCP` to `MCPServer` and breaks `vendor/src/server.py` (`ModuleNotFoundError: mcp.server.fastmcp`). `run.sh` uses `uv run --with "mcp<2"` to pin a working version for the run without modifying the vendored submodule. If the pinned commit is ever bumped and upstream tightens its own `mcp` constraint, this override can be dropped.

## Updating the pinned commit

1. Inspect and test the new upstream commit independently first.
2. `cd services/x3d-mcp/vendor && git fetch && git checkout <new-commit-sha>`
3. Re-verify `./services/x3d-mcp/run.sh` starts, `/pulse` responds, and an MCP client can `initialize()`/`list_tools()` against `/mcp`.
4. Commit the updated submodule pointer and update the commit SHA recorded in `docs/x3d-mcp.md`.

Do not track a branch (e.g. `main`) directly — the submodule must always point at an explicit, tested commit.
