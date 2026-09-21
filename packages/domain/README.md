# packages/domain

Shared `ModelSpec` / `ModelPlan` v1 definitions (PRD §8), as one source-of-truth JSON Schema pair plus TypeScript and Python mirrors.

```text
packages/domain/
  schemas/                    # source of truth: JSON Schema (2020-12), one file per type
    model-spec.v1.schema.json
  fixtures/                   # shared example payloads, used by both language test suites
    model-spec/
  ts/                         # TypeScript types + domain validators (packages/agent, apps/web)
  python/                     # Python types + domain validators (apps/api)
```

## Why two validation layers

JSON Schema (`schemas/`) checks structure and per-field constraints (types, ranges). It cannot express cross-field/cross-item rules, so those are enforced separately in each language — for `ModelSpec`, that's unique `ModelObject.id` within the model.

TypeScript: `validateModelSpecDomainRules` in `ts/src/model-spec.ts`. Python: `ModelSpec`'s pydantic model validator in `python/src/domain/model_spec.py`. Both assume the input already matches the schema's shape — run schema validation first for untrusted input (e.g. parsed LLM output).

## Cross-language compatibility

`fixtures/` holds one shared set of valid/invalid example payloads. `ts/tests/model-spec-schema-fixtures.test.ts` and `python/tests/test_schema_fixtures_model_spec.py` each validate the *same* fixture files against the *same* schema file; `ts/tests/model-spec.test.ts` and `python/tests/test_model_spec.py` each run the *same* fixtures through that language's own domain validators. Both suites passing on the same inputs is how TS/Python shape compatibility is verified (Issue #5), rather than a bespoke cross-language contract-testing harness.

## Working in each language

```bash
cd packages/domain/ts && npm install && npm test && npm run typecheck
cd packages/domain/python && uv sync && uv run pytest && uv run mypy && uv run ruff check .
```

## Conventions not obvious from the schema

- `ModelObject.dimensions` keys are kind-specific by convention (not enforced per-kind in the schema, to stay renderer-independent): `box` → `width`/`height`/`depth`, `sphere` → `radius`, `cylinder` → `radius`/`height`, `cone` → `bottomRadius`/`height`. These match the `x3d_mcp` primitive tool parameters (`services/x3d-mcp/vendor/src/tools/workflow.py`).
- `Material.color` must be a normalized lowercase 6-digit hex string (`^#[0-9a-f]{6}$`); the PRD leaves the exact format open, this is the concrete decision.
