#!/usr/bin/env bash
# Runs the pinned x3d_mcp vendor commit in Streamable HTTP mode.
#
# The pinned server imports mcp.server.fastmcp and requires mcp<2.
# Apply that constraint without modifying the upstream submodule.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/vendor"

export MCP_TRANSPORT="${MCP_TRANSPORT:-streamable-http}"
export PORT="${PORT:-8000}"
export HOST="${HOST:-0.0.0.0}"

cd "$VENDOR_DIR"
exec uv run --with "mcp<2" python src/server.py
