import copy
import json
import runpy
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from domain.cad_assembly import CadAssemblySpec
from domain.cad_program import CadProgramSpec

ROOT = Path(__file__).resolve().parents[4]
FEATURES = json.loads((ROOT / "packages/domain/fixtures/cad-program/features.json").read_text())
DRIVE = json.loads((ROOT / "examples/cad/threaded_drive.json").read_text())


@pytest.mark.parametrize("raw", FEATURES, ids=[item["partId"] for item in FEATURES])
def test_feature_contracts_accept_the_same_portable_program(raw) -> None:
    schema = json.loads((ROOT / "packages/domain/schemas/cad-program.v3.schema.json").read_text())
    jsonschema.validate(raw, schema)
    assert CadProgramSpec.model_validate(raw).partId == raw["partId"]


@pytest.mark.parametrize("model,filename", [(CadProgramSpec, "cad-program.v3.schema.json"), (CadAssemblySpec, "cad-assembly.v4.schema.json")])
def test_shared_schema_matches_python_contract(model, filename) -> None:
    portable = runpy.run_path(str(ROOT / "scripts/generate-cad-schemas.py"))["portable_schema"]
    expected = {"$schema": "https://json-schema.org/draft/2020-12/schema", **portable(model.model_json_schema())}
    assert json.loads((ROOT / "packages/domain/schemas" / filename).read_text()) == expected


@pytest.mark.parametrize("part_id,field,value", [("tube", "innerDiameter", 20), ("torus", "minorRadius", 10), ("slot", "width", 20),
    ("counterbore", "headDiameter", 5), ("thread_metric_right", "pitch", 20), ("thread_metric_right", "clearance", 0.1),
    ("thread_metric_right", "height", 200), ("thread_metric_right", "starts", 5), ("shell", "selector", "all"), ("fillet", "op", "cut")])
def test_impossible_feature_parameters_are_rejected(part_id, field, value) -> None:
    raw = copy.deepcopy(next(item for item in FEATURES if item["partId"] == part_id))
    raw["steps"][-1][field] = value
    with pytest.raises(ValidationError):
        CadProgramSpec.model_validate(raw)


def test_linked_motion_accepts_rotation_and_translation_with_explicit_factors() -> None:
    assert CadAssemblySpec.model_validate(DRIVE).components[1].motion.factor == -180
    raw = copy.deepcopy(DRIVE)
    del raw["components"][2]["motion"]["factor"]
    with pytest.raises(ValidationError, match="share range and value"):
        CadAssemblySpec.model_validate(raw)
    raw = copy.deepcopy(DRIVE)
    raw["components"][1]["motion"]["factor"] = 0
    with pytest.raises(ValidationError, match="nonzero"):
        CadAssemblySpec.model_validate(raw)


def test_finish_placement_and_loft_section_order_are_not_silently_ignored() -> None:
    raw = copy.deepcopy(next(item for item in FEATURES if item["partId"] == "fillet"))
    raw["steps"][1]["position"]["x"] = 1
    with pytest.raises(ValidationError, match="position and rotation must be zero"):
        CadProgramSpec.model_validate(raw)
    raw = copy.deepcopy(next(item for item in FEATURES if item["partId"] == "loft"))
    raw["steps"][0]["sections"].reverse()
    with pytest.raises(ValidationError, match="increasing z"):
        CadProgramSpec.model_validate(raw)
