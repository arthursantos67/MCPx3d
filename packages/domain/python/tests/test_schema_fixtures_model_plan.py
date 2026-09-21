"""Validates the shared ModelPlan fixtures in packages/domain/fixtures/model-plan
against packages/domain/schemas/model-plan.v1.schema.json. The TypeScript package
runs the same fixtures against the same schema file (see
packages/domain/ts/tests/model-plan-schema-fixtures.test.ts) -- both language
runtimes agreeing on pass/fail for one shared fixture set validated against one
shared schema is how "TS and Python shapes are tested for compatibility"
(Issue #6) is satisfied without a bespoke cross-language harness.
"""

import json
from pathlib import Path

from jsonschema import Draft202012Validator


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_model_plan_valid_fixtures_pass_schema(schemas_dir: Path, fixtures_dir: Path) -> None:
    schema = _load(schemas_dir / "model-plan.v1.schema.json")
    validator = Draft202012Validator(schema)

    validator.validate(_load(fixtures_dir / "model-plan" / "valid-create.json"))
    validator.validate(_load(fixtures_dir / "model-plan" / "valid-modify.json"))


def test_model_plan_unknown_operation_fails_schema(schemas_dir: Path, fixtures_dir: Path) -> None:
    schema = _load(schemas_dir / "model-plan.v1.schema.json")
    instance = _load(fixtures_dir / "model-plan" / "invalid-unknown-operation.json")

    assert not Draft202012Validator(schema).is_valid(instance)
