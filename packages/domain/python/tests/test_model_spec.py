import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.model_spec import ModelSpec


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_valid_model_spec_parses(fixtures_dir: Path) -> None:
    spec = ModelSpec.model_validate(_load(fixtures_dir / "model-spec" / "valid.json"))

    assert spec.schemaVersion == "1.0"
    assert len(spec.objects) == 2


def test_negative_dimension_is_rejected(fixtures_dir: Path) -> None:
    with pytest.raises(ValidationError):
        ModelSpec.model_validate(_load(fixtures_dir / "model-spec" / "invalid-negative-dimension.json"))


def test_duplicate_object_id_is_rejected(fixtures_dir: Path) -> None:
    with pytest.raises(ValidationError, match="duplicate object id"):
        ModelSpec.model_validate(_load(fixtures_dir / "model-spec" / "invalid-duplicate-id.json"))


def test_schema_version_is_explicit_and_fixed(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir / "model-spec" / "valid.json")
    payload["schemaVersion"] = "2.0"

    with pytest.raises(ValidationError):
        ModelSpec.model_validate(payload)


def test_unknown_top_level_field_is_rejected(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir / "model-spec" / "valid.json")
    payload["script"] = "rm -rf /"

    with pytest.raises(ValidationError):
        ModelSpec.model_validate(payload)


def test_nonzero_scale_required(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir / "model-spec" / "valid.json")
    payload["objects"][0]["transform"]["scale"] = [0, 1, 1]

    with pytest.raises(ValidationError):
        ModelSpec.model_validate(payload)


def test_infinite_dimension_is_rejected(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir / "model-spec" / "valid.json")
    payload["objects"][0]["dimensions"]["width"] = float("inf")

    with pytest.raises(ValidationError):
        ModelSpec.model_validate(payload)


def test_nan_dimension_is_rejected(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir / "model-spec" / "valid.json")
    payload["objects"][0]["dimensions"]["width"] = float("nan")

    with pytest.raises(ValidationError):
        ModelSpec.model_validate(payload)


def test_infinite_position_is_rejected(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir / "model-spec" / "valid.json")
    payload["objects"][0]["transform"]["position"] = [float("inf"), 0, 0]

    with pytest.raises(ValidationError):
        ModelSpec.model_validate(payload)


def test_nan_display_scale_is_rejected(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir / "model-spec" / "valid.json")
    payload["scene"]["displayScale"] = float("nan")

    with pytest.raises(ValidationError):
        ModelSpec.model_validate(payload)
