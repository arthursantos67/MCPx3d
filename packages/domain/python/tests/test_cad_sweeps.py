import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.cad_program import CadProgramSpec

ROOT = Path(__file__).resolve().parents[4]
FEATURES = json.loads((ROOT / "packages/domain/fixtures/cad-program/features.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("part_id,patch", [
    ("pipe_bend", {"bendRadius": 6}), ("pipe_bend", {"innerDiameter": 12}), ("pipe_bend", {"bendAngle": 360}),
    ("helical_spring", {"pitch": 2}), ("helical_spring", {"turns": 33}), ("helical_spring", {"meanDiameter": 2}),
    ("sweep", {"innerDiameter": 6}), ("sweep", {"path": [{"x": 0, "y": 0, "z": 0}] * 2}),
    ("sweep", {"path": [{"x": 0, "y": 0, "z": 0}]}), ("sweep", {"path": [{"x": 0, "y": 0, "z": 0}, {"x": 0, "z": 20}]}),
])
def test_sweep_parameter_limits_match_typescript(part_id, patch):
    spec = copy.deepcopy(next(item for item in FEATURES if item["partId"] == part_id))
    spec["steps"][0].update(patch)
    with pytest.raises(ValidationError):
        CadProgramSpec.model_validate(spec)


@pytest.mark.parametrize("part_id,count,limit", [("helical_spring", 32, "64 spring turns"), ("sweep", 64, "128 sweep segments")])
def test_sweep_budgets_include_patterns(part_id, count, limit):
    spec = copy.deepcopy(next(item for item in FEATURES if item["partId"] == part_id))
    spec["steps"].append({**spec["steps"][0], "id": "repeated", "op": "union",
                         "pattern": {"kind": "linear", "count": count, "offset": {"x": 10, "y": 0, "z": 0}}})
    with pytest.raises(ValidationError, match=limit):
        CadProgramSpec.model_validate(spec)


def test_finish_region_is_strict_and_ordered():
    spec = copy.deepcopy(next(item for item in FEATURES if item["partId"] == "chamfer"))
    region = {"min": {"x": 19, "y": 14, "z": -1}, "max": {"x": 21, "y": 16, "z": 1}}
    spec["steps"][-1]["selectionBox"] = region
    assert CadProgramSpec.model_validate(spec).steps[-1].selectionBox is not None
    spec["steps"][-1]["selectionBox"] = {"min": region["max"], "max": region["min"]}
    with pytest.raises(ValidationError, match="selectionBox"):
        CadProgramSpec.model_validate(spec)
