"""Validates the ModelPlan fixtures shared with TypeScript against the same JSON Schema."""

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


def test_named_background_plan_fails_schema(schemas_dir: Path) -> None:
    schema = _load(schemas_dir / "model-plan.v1.schema.json")
    instance = {"intent": "background", "operations": [{"op": "set_scene", "background": "blue"}]}
    assert not Draft202012Validator(schema).is_valid(instance)
