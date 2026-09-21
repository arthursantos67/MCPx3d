#!/usr/bin/env bash
# Runs the pinned x3d_mcp vendor commit in Streamable HTTP mode.
#
# The vendored commit declares "mcp>=1.7" with no upper bound; a plain
# `uv sync`/`uv run` there can resolve mcp 2.x, which renamed FastMCP and
# breaks src/server.py. `--with "mcp<2"` pins the working version for this
# run without modifying the vendored submodule.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/vendor"

export MCP_TRANSPORT="${MCP_TRANSPORT:-streamable-http}"
export PORT="${PORT:-8000}"
export HOST="${HOST:-0.0.0.0}"

cd "$VENDOR_DIR"
exec uv run --with "mcp<2" python src/server.py
