# `x3d_mcp` dependency

**Upstream:** [github.com/Web3DConsortium/x3d_mcp](https://github.com/Web3DConsortium/x3d_mcp)
**Vendored as:** git submodule at `services/x3d-mcp/vendor`
**Pinned commit:** `74da0ec46f477f0048aee813ecfc5fc87e655537` (upstream `main`, tested 2026-09-21)
**License:** [Web3D Consortium Open-Source License](https://www.web3d.org/license) (BSD-style) — see `services/x3d-mcp/vendor/LICENSE`. Retain the upstream copyright/license notice in any redistribution.

Operational setup, running, and health-check details live in [`services/x3d-mcp/README.md`](../services/x3d-mcp/README.md).

## Why this commit

At the time of pinning, this was the tip of upstream `main`. It was verified to:

- start in Streamable HTTP mode (`MCP_TRANSPORT=streamable-http`);
- serve a dependency-free health check at `GET /pulse`;
- accept a real MCP client session at `/mcp` (`initialize()` + `list_tools()` returned 34 tools, matching the tool groups described in the PRD §3.5/Appendix C).

See `services/x3d-mcp/README.md` for the `mcp<2` dependency pin required to run this exact commit, and the procedure for updating the pin later.

## Known upstream limitation: `convert_x3d(to_encoding="json")` (found in Issue #13, 2026-09-21)

At this pinned commit, `convert_x3d`'s JSON target (`.x3dj`) never returns well-formed JSON -- confirmed even for an empty `<Scene/>`, so it isn't content-specific. The bug is in the vendored `x3d` pip package's `X3D.JSON()` serializer (invoked by `services/x3d-mcp/vendor/src/tools/convert.py`), not in this repository's code, and not something to patch inside the pinned submodule. It appears to have gone unnoticed upstream because the vendored server's own test suite (`tests/test_tools.py::test_convert_xml_to_json`) only asserts substrings like `"X3D" in json_out`, never that the result actually parses.

`apps/api` advertises `.x3dj` with `available: false` and rejects malformed conversion output, so the UI must not offer that download at this pin. `.x3dv` (ClassicVRML) continues to work. Revisit this note if the pinned commit is ever bumped past an upstream fix.
