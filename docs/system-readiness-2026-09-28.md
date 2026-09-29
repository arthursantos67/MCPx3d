# System readiness review — 2026-09-28

## Verified foundation

- The web/API/domain flow uses typed `ModelPlan` commands and an authoritative `ModelSpec`; candidate scenes go through schema and semantic X3D validation before commit.
- The API test suite exercises the pinned MCP server, and the CI workflow runs workspace tests, Python tests, lint and type checks. The MCP launcher is committed executable (`100755`).
- Revision artifacts are cached by exact revision. The browser can resume a live session, and a downloaded manifest can be imported after validation. A local SQLite catalog reuses validated construction plans.

## Work remaining before real mechanical CAD

| Priority | Gap | Exit evidence |
| --- | --- | --- |
| 1 | `ModelSpec` v1 has primitives and transforms but no sketches, dimensional constraints, solid features or assembly relationships. | Versioned `ParametricModel` v2 with unit-aware parameters and stable references; migration rules for supported v1 geometry. |
| 2 | CAD 2.1 now supports identified through-holes and corner chamfers with typed chat edits; general sketches and assembly relationships are absent. | Extend the versioned CAD model to additional constrained features and part relationships. |
| 3 | Every saved plate revision retains its verified STEP file, and a four-hole mounting plate has passed import checks in FreeCAD 1.1.3; general mechanical projects remain unsupported. | Extend independent STEP verification to additional feature types and assemblies. |
| 4 | Recipe memory stores fixed primitive plans and currently seeds one furniture type. | Parameterized, versioned CAD recipes plus more validated Web3D categories; variants must not be selected by a loose text match. |
| 5 | The maintained golden benchmark requires a configured provider and live runtime; unit/integration tests alone do not measure prompt success or visual fidelity. | Run the 32-case provider benchmark and meet the PRD validity thresholds on a reference environment. |
| 6 | Sessions remain in memory and the recipe catalog is shared by all API callers. | Before multi-user/public deployment, add project ownership, recipe authorization, persistent project storage and request-rate limits. |

The next engineering milestone is a constrained multi-part assembly, 3D CAD preview and parameterized CAD recipe. Browser X3D remains the Web3D preview path; the CAD editor currently has a top-view drawing, solid inspection and STEP download without a 3D CAD preview.
