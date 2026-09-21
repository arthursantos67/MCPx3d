"""Validates the shared ModelSpec fixtures in packages/domain/fixtures/model-spec
against packages/domain/schemas/model-spec.v1.schema.json. The TypeScript package
runs the same fixtures against the same schema file (see
packages/domain/ts/tests/model-spec-schema-fixtures.test.ts) -- both language
runtimes agreeing on pass/fail for one shared fixture set validated against one
shared schema is how "TS and Python shapes are tested for compatibility"
(Issue #5) is satisfied without a bespoke cross-language harness.
"""

import json
from pathlib import Path

from jsonschema import Draft202012Validator


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_model_spec_valid_fixture_passes_schema(schemas_dir: Path, fixtures_dir: Path) -> None:
    schema = _load(schemas_dir / "model-spec.v1.schema.json")
    instance = _load(fixtures_dir / "model-spec" / "valid.json")

    Draft202012Validator(schema).validate(instance)


def test_model_spec_negative_dimension_fails_schema(schemas_dir: Path, fixtures_dir: Path) -> None:
    schema = _load(schemas_dir / "model-spec.v1.schema.json")
    instance = _load(fixtures_dir / "model-spec" / "invalid-negative-dimension.json")

    assert not Draft202012Validator(schema).is_valid(instance)


def test_model_spec_duplicate_id_fixture_passes_schema_but_is_a_domain_error(
    schemas_dir: Path, fixtures_dir: Path
) -> None:
    """Uniqueness of object IDs isn't expressible in JSON Schema, so this fixture
    is schema-valid; ModelSpec's own domain validator is what rejects it
    (see test_model_spec.test_duplicate_object_id_is_rejected)."""
    schema = _load(schemas_dir / "model-spec.v1.schema.json")
    instance = _load(fixtures_dir / "model-spec" / "invalid-duplicate-id.json")

    Draft202012Validator(schema).validate(instance)
