# packages/domain

The experimental `cad-part.v2.schema.json` describes one millimeter-based extruded rectangle with a through-hole. `domain.cad_part.CadPartSpec` enforces cross-field edge clearance and is the backend contract for the separate CAD plate API. It is not a general replacement for ModelSpec v1.

`cad-plan.v1.schema.json` describes the bounded parameter edits accepted by CAD projects. Python and TypeScript validators reject duplicate parameter changes; the API rebuilds and verifies the resulting CAD solid before committing a revision.

Shared `ModelSpec` / `ModelPlan` v1 definitions (PRD §8), as one source-of-truth JSON Schema pair plus TypeScript and Python mirrors.

```text
packages/domain/
  schemas/                    # source of truth: JSON Schema (2020-12), one file per type
    model-spec.v1.schema.json
    model-plan.v1.schema.json
  fixtures/                   # shared example payloads, used by both language test suites
    model-spec/
    model-plan/
  ts/                         # TypeScript types + domain validators (packages/agent, apps/web)
  python/                     # Python types + domain validators (apps/api)
```

## Why two validation layers

JSON Schema (`schemas/`) checks structure and per-field constraints (types, ranges, the closed set of `ModelPlan` operations). It cannot express cross-field/cross-item rules, so those are enforced separately in each language:

- unique `ModelObject.id` within a `ModelSpec`;
- `set_material` / `set_scene` requiring at least one of their optional fields.

TypeScript: `validateModelSpecDomainRules` / `validateModelPlanDomainRules` in `ts/src/`. Python: `ModelSpec` / `ModelPlan` pydantic model validators in `python/src/domain/`. Both assume the input already matches the schema's shape — run schema validation first for untrusted input (e.g. parsed LLM output).

## Cross-language compatibility

`fixtures/` holds one shared set of valid/invalid example payloads. `ts/tests/*-schema-fixtures.test.ts` and `python/tests/test_schema_fixtures_*.py` each validate the *same* fixture files against the *same* schema files; `ts/tests/model-*.test.ts` and `python/tests/test_model_*.py` each run the *same* fixtures through that language's own domain validators. Both suites passing on the same inputs is how TS/Python shape compatibility is verified (Issue #5), rather than a bespoke cross-language contract-testing harness.

## Working in each language

```bash
cd packages/domain/ts && npm install && npm test && npm run typecheck
cd packages/domain/python && uv sync && uv run pytest && uv run mypy && uv run ruff check .
```

## Conventions not obvious from the schema

The experimental CAD contract is separate from Web3D `ModelSpec`. `cad-part.v2.schema.json` retains the single-hole legacy shape. `cad-part.v2.1.schema.json` adds identified through-holes and a corner chamfer; cross-field clearances and hole-ID uniqueness are enforced in both Python and TypeScript. `cad-plan.v1.schema.json` retains the six legacy parameter edits, while `cad-plan.v2.schema.json` adds closed hole upsert/removal and chamfer operations. Shared fixtures for both versions live under `fixtures/cad-part/` and `fixtures/cad-plan/`.

`cad-part.v2.2.schema.json` adds a fused L bracket with holes in its base and upright wall. `cad-part.v2.3.schema.json` adds a rounded rectangular plate and a circular flange, each with a true curved solid outline and axial through-holes. `cad-plan.v3.schema.json` adds upright wall edits; `cad-plan.v4.schema.json` adds typed corner-radius and disc-diameter edits. Both Python and TypeScript enforce curved-edge clearance before CadQuery builds a STEP revision.

`cad-part.v2.4.schema.json` adds a bounded union of up to four cylindrical bosses with a base and axial through cuts. `cad-plan.v5.schema.json` adds typed boss edits. Domain checks keep bosses within the base and prevent partial hole/boss intersections; the API verifies the resulting single solid and exact STEP revision.

- `ModelObject.dimensions` keys are kind-specific by convention (not enforced per-kind in the schema, to stay renderer-independent): `box` → `width`/`height`/`depth`, `sphere` → `radius`, `cylinder` → `radius`/`height`, `cone` → `bottomRadius`/`height`. These match the `x3d_mcp` primitive tool parameters (`services/x3d-mcp/vendor/src/tools/workflow.py`). Enforced authoritatively for `create_object`/`set_dimensions` by `apps/api/src/api/mutation.py`'s `_DIMENSION_KEYS` (Issue #7); `packages/domain/ts/src/model-plan.ts`'s `validateModelPlanDomainRules` mirrors the same table as a client-side pre-check for `create_object` only (added after a real BYOK model emitted `{x,y,z}` for a box and burned its one repair retry against the backend instead of catching it locally) -- `set_dimensions` still relies on the backend alone, since the plan-level validator doesn't have the target's existing `kind` to check against.
- `Material.color` and `Scene.background` must be normalized lowercase 6-digit hex strings (`^#[0-9a-f]{6}$`), which the X3D adapter converts to RGB values.
- `ModelPlan` operations use `op` as their discriminator field and are closed (`additionalProperties: false` / no index signature in TS / `extra="forbid"` in pydantic), so no executable-code field (`script`, `code`, ...) can pass validation on any operation.
- `translate_object` / `rotate_object` / `scale_object` are relative to the target's current transform (`delta` / `factor`), not absolute sets — `set_dimensions` and `set_material` are the absolute-set operations.
