import copy
import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from domain.cad_part import CadPartSpec

_SCHEMA = Path(__file__).resolve().parents[2] / "schemas" / "cad-part.v2.schema.json"
_FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "cad-part" / "valid-plate.json"
_PART = json.loads(_FIXTURE.read_text(encoding="utf-8"))


def test_valid_part_matches_json_schema() -> None:
    jsonschema.validate(_PART, json.loads(_SCHEMA.read_text(encoding="utf-8")))
    assert CadPartSpec.model_validate(_PART).partId == "plate_1"


@pytest.mark.parametrize("x,y,diameter", [(45, 0, 12), (0, 35, 12), (0, 0, 80)])
def test_hole_requires_edge_clearance(x: float, y: float, diameter: float) -> None:
    part = copy.deepcopy(_PART)
    part["features"] = [{"kind": "through_hole", "x": x, "y": y, "diameter": diameter}]

    with pytest.raises(ValidationError, match="0.1 mm"):
        CadPartSpec.model_validate(part)


def test_mounting_plate_schema_and_domain_rules() -> None:
    root = _SCHEMA.parent.parent
    part = json.loads((root / "fixtures/cad-part/valid-mounting-plate.json").read_text(encoding="utf-8"))
    schema = json.loads((root / "schemas/cad-part.v2.1.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(part, schema)
    assert len(CadPartSpec.model_validate(part).features) == 4

    overlapping = copy.deepcopy(part)
    overlapping["features"][1]["x"] = -40
    with pytest.raises(ValidationError, match="1 mm"):
        CadPartSpec.model_validate(overlapping)

    near_chamfer = copy.deepcopy(part)
    near_chamfer["features"][0].update({"x": -56.9, "y": -36.9, "diameter": 4})
    with pytest.raises(ValidationError, match="corner chamfer"):
        CadPartSpec.model_validate(near_chamfer)

    duplicate = copy.deepcopy(part)
    duplicate["features"][1]["id"] = "hole_1"
    with pytest.raises(ValidationError, match="unique"):
        CadPartSpec.model_validate(duplicate)


def test_l_bracket_schema_and_cross_face_clearances() -> None:
    root = _SCHEMA.parent.parent
    part = json.loads((root / "fixtures/cad-part/valid-l-bracket.json").read_text(encoding="utf-8"))
    schema = json.loads((root / "schemas/cad-part.v2.2.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(part, schema)
    assert len(CadPartSpec.model_validate(part).upright.holes) == 2

    base_clash = copy.deepcopy(part)
    base_clash["features"][0]["y"] = 30
    with pytest.raises(ValidationError, match="upright wall"):
        CadPartSpec.model_validate(base_clash)

    wall_clash = copy.deepcopy(part)
    wall_clash["upright"]["holes"][0]["z"] = 10
    with pytest.raises(ValidationError, match="above the base"):
        CadPartSpec.model_validate(wall_clash)

    duplicate = copy.deepcopy(part)
    duplicate["upright"]["holes"][0]["id"] = "hole_1"
    with pytest.raises(ValidationError, match="unique"):
        CadPartSpec.model_validate(duplicate)


@pytest.mark.parametrize("name", ["valid-rounded-plate.json", "valid-round-flange.json"])
def test_curved_profiles_validate_and_reject_holes_outside_outline(name: str) -> None:
    root = _SCHEMA.parent.parent
    part = json.loads((root / "fixtures/cad-part" / name).read_text(encoding="utf-8"))
    schema = json.loads((root / "schemas/cad-part.v2.3.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(part, schema)
    CadPartSpec.model_validate(part)
    invalid = copy.deepcopy(part)
    invalid["features"][0].update({"x": part["base"]["width"] / 2 - 5, "y": part["base"]["depth"] / 2 - 5})
    with pytest.raises(ValidationError):
        CadPartSpec.model_validate(invalid)
    invalid = copy.deepcopy(part)
    invalid["base"]["depth"] += 1
    if part["base"]["kind"] == "extruded_disc":
        with pytest.raises(ValidationError, match="equal width and depth"):
            CadPartSpec.model_validate(invalid)


def test_composite_bosses_and_through_cuts_validate() -> None:
    root = _SCHEMA.parent.parent
    part = json.loads((root / "fixtures/cad-part/valid-composite-part.json").read_text(encoding="utf-8"))
    schema = json.loads((root / "schemas/cad-part.v2.4.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(part, schema)
    CadPartSpec.model_validate(part)
    crossing = copy.deepcopy(part)
    crossing["features"][0]["x"] = 18
    with pytest.raises(ValidationError, match="inside or outside"):
        CadPartSpec.model_validate(crossing)
    outside = copy.deepcopy(part)
    outside["bosses"][0]["x"] = 50
    with pytest.raises(ValidationError, match="fit entirely"):
        CadPartSpec.model_validate(outside)
    duplicate = copy.deepcopy(part)
    duplicate["bosses"][0]["id"] = "hole_1"
    with pytest.raises(ValidationError, match="unique"):
        CadPartSpec.model_validate(duplicate)
