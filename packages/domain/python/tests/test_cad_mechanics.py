import copy
import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from domain.cad_assembly import CadAssemblySpec

ROOT = Path(__file__).resolve().parents[4]
STAGE = json.loads((ROOT / "examples/cad/functional_linear_stage.json").read_text())


def test_mechanical_contract_and_shared_schema():
    schema = json.loads((ROOT / "packages/domain/schemas/cad-assembly.v4.schema.json").read_text())
    jsonschema.validate(STAGE, schema)
    assert len(CadAssemblySpec.model_validate(STAGE).mechanics.connections) == 12
    legacy = copy.deepcopy(STAGE)
    del legacy["mechanics"]
    assert CadAssemblySpec.model_validate(legacy).mechanics is None


@pytest.mark.parametrize("failure", ["ground", "feature", "graph", "id", "fastener", "clearance", "one_feature", "unknown_field"])
def test_invalid_mechanical_contract(failure):
    raw = copy.deepcopy(STAGE)
    mechanics = raw["mechanics"]
    if failure == "ground": mechanics["grounded"] = "screw"
    if failure == "feature": mechanics["connections"][0]["firstFeature"] = "missing"
    if failure == "graph": mechanics["connections"] = mechanics["connections"][:1]
    if failure == "id": mechanics["connections"][1]["id"] = mechanics["connections"][0]["id"]
    if failure == "fastener": mechanics["connections"][0]["fastenerDiameter"] = 0
    if failure == "clearance": mechanics["connections"][0]["maxClearance"] = 24
    if failure == "one_feature": mechanics["connections"][0]["firstFeature"] = ""
    if failure == "unknown_field": mechanics["connections"][0]["trustMe"] = True
    with pytest.raises(ValidationError):
        CadAssemblySpec.model_validate(raw)
