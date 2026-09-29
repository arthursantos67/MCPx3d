import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from domain.cad_plan import CadEditPlan

_DOMAIN = Path(__file__).resolve().parents[2]


def test_cad_plan_fixtures_match_shared_schema() -> None:
    schema = json.loads((_DOMAIN / "schemas" / "cad-plan.v1.schema.json").read_text(encoding="utf-8"))
    valid = json.loads((_DOMAIN / "fixtures" / "cad-plan" / "valid-edit.json").read_text(encoding="utf-8"))
    invalid = json.loads((_DOMAIN / "fixtures" / "cad-plan" / "invalid-op.json").read_text(encoding="utf-8"))
    jsonschema.validate(valid, schema)
    CadEditPlan.model_validate(valid)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(invalid, schema)


def test_cad_plan_rejects_duplicate_parameters() -> None:
    with pytest.raises(ValidationError, match="at most once"):
        CadEditPlan.model_validate({
            "schemaVersion": "1.0",
            "operations": [
                {"op": "set_parameter", "parameter": "width", "value": 120},
                {"op": "set_parameter", "parameter": "width", "value": 140},
            ],
        })


def test_cad_plan_rejects_unknown_operation() -> None:
    with pytest.raises(ValidationError):
        CadEditPlan.model_validate({
            "schemaVersion": "1.0",
            "operations": [{"op": "run_code", "parameter": "width", "value": 120}],
        })


def test_mounting_edit_plan_schema_and_unique_targets() -> None:
    schema = json.loads((_DOMAIN / "schemas/cad-plan.v2.schema.json").read_text(encoding="utf-8"))
    valid = json.loads((_DOMAIN / "fixtures/cad-plan/valid-mounting-edit.json").read_text(encoding="utf-8"))
    jsonschema.validate(valid, schema)
    CadEditPlan.model_validate(valid)
    with pytest.raises(ValidationError, match="at most once"):
        CadEditPlan.model_validate({
            "schemaVersion": "2.0",
            "operations": [
                {"op": "upsert_hole", "holeId": "hole_2", "x": 1, "y": 2, "diameter": 3},
                {"op": "remove_hole", "holeId": "hole_2"},
            ],
        })


def test_bracket_edit_plan_schema_and_unique_wall_targets() -> None:
    schema = json.loads((_DOMAIN / "schemas/cad-plan.v3.schema.json").read_text(encoding="utf-8"))
    valid = json.loads((_DOMAIN / "fixtures/cad-plan/valid-bracket-edit.json").read_text(encoding="utf-8"))
    jsonschema.validate(valid, schema)
    CadEditPlan.model_validate(valid)
    with pytest.raises(ValidationError, match="at most once"):
        CadEditPlan.model_validate({"schemaVersion": "3.0", "operations": [
            {"op": "upsert_upright_hole", "holeId": "wall_hole_1", "x": 0, "z": 30, "diameter": 8},
            {"op": "remove_upright_hole", "holeId": "wall_hole_1"},
        ]})
    with pytest.raises(ValidationError, match="does not support upright"):
        CadEditPlan.model_validate({"schemaVersion": "2.0", "operations": valid["operations"]})


def test_curved_edit_plan_schema_and_version_gate() -> None:
    schema = json.loads((_DOMAIN / "schemas/cad-plan.v4.schema.json").read_text(encoding="utf-8"))
    valid = json.loads((_DOMAIN / "fixtures/cad-plan/valid-curved-edit.json").read_text(encoding="utf-8"))
    jsonschema.validate(valid, schema)
    CadEditPlan.model_validate(valid)
    with pytest.raises(ValidationError, match="require CAD plan 4.0"):
        CadEditPlan.model_validate({**valid, "schemaVersion": "3.0"})


def test_composite_edit_plan_schema_and_version_gate() -> None:
    schema = json.loads((_DOMAIN / "schemas/cad-plan.v5.schema.json").read_text(encoding="utf-8"))
    valid = json.loads((_DOMAIN / "fixtures/cad-plan/valid-composite-edit.json").read_text(encoding="utf-8"))
    jsonschema.validate(valid, schema)
    CadEditPlan.model_validate(valid)
    with pytest.raises(ValidationError, match="require CAD plan 5.0"):
        CadEditPlan.model_validate({**valid, "schemaVersion": "4.0"})
