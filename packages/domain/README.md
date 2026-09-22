# packages/domain

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

- `ModelObject.dimensions` keys are kind-specific by convention (not enforced per-kind in the schema, to stay renderer-independent): `box` → `width`/`height`/`depth`, `sphere` → `radius`, `cylinder` → `radius`/`height`, `cone` → `bottomRadius`/`height`. These match the `x3d_mcp` primitive tool parameters (`services/x3d-mcp/vendor/src/tools/workflow.py`). Enforced authoritatively for `create_object`/`set_dimensions` by `apps/api/src/api/mutation.py`'s `_DIMENSION_KEYS` (Issue #7); `packages/domain/ts/src/model-plan.ts`'s `validateModelPlanDomainRules` mirrors the same table as a client-side pre-check for `create_object` only (added after a real BYOK model emitted `{x,y,z}` for a box and burned its one repair retry against the backend instead of catching it locally) -- `set_dimensions` still relies on the backend alone, since the plan-level validator doesn't have the target's existing `kind` to check against.
- `Material.color` must be a normalized lowercase 6-digit hex string (`^#[0-9a-f]{6}$`); the PRD leaves the exact format open, this is the concrete decision.
- `ModelPlan` operations use `op` as their discriminator field and are closed (`additionalProperties: false` / no index signature in TS / `extra="forbid"` in pydantic), so no executable-code field (`script`, `code`, ...) can pass validation on any operation.
- `translate_object` / `rotate_object` / `scale_object` are relative to the target's current transform (`delta` / `factor`), not absolute sets — `set_dimensions` and `set_material` are the absolute-set operations.
