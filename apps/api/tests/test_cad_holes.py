import copy
import json
from pathlib import Path

import pytest
from domain.cad_assembly import CadAssemblySpec
from domain.cad_program import CadProgramSpec

from api.cad_adapter import CadGeometryError
from api.cad_assembly_adapter import (
    CadAssemblyMechanicalError,
    _check_interference,
    build_assembly_step,
)
from api.cad_program_adapter import _engine, build_program_solid, build_program_step

ZERO = {"x": 0, "y": 0, "z": 0}
MOUNT = json.loads((Path(__file__).resolve().parents[3] / "examples/cad/threaded_blind_mount.json").read_text())


def plate(depth=6, termination="blind", floor=2):
    return {"schemaVersion": "3.0", "units": "mm", "partId": "blind_plate", "steps": [
        {"id": "stock", "op": "base", "shape": "box", "width": 30, "depth": 30, "height": 10, "position": ZERO, "rotation": ZERO},
        {"id": "bore", "op": "cut", "shape": "hole", "diameter": 5, "height": depth, "holeType": "plain", "headDiameter": 0, "headDepth": 0,
         "termination": termination, "minBottomThickness": floor, "position": {**ZERO, "z": 5}, "rotation": ZERO}]}


@pytest.mark.parametrize("rotation", [ZERO, {**ZERO, "x": 90}, {**ZERO, "y": 90}, {"x": 25, "y": 35, "z": 15}])
def test_blind_holes_keep_full_floors_in_transformed_stock_and_step(rotation):
    from api.cad_mechanics import AXES, rotate
    raw = plate()
    raw["steps"][0]["rotation"] = rotation
    raw["steps"][1]["rotation"] = rotation
    point = (0, 0, 5)
    for key in ("x", "y", "z"):
        point = rotate(point, AXES[key], rotation[key])
    raw["steps"][1]["position"] = dict(zip(("x", "y", "z"), point, strict=True))
    spec = CadProgramSpec.model_validate(raw)
    assert build_program_solid(spec).val().isValid()
    assert build_program_step(spec, 1_000_000).solid_count == 1


@pytest.mark.parametrize("depth,termination,floor", [(10.5, "blind", 1), (9, "blind", 2), (6, "through", 1)])
def test_hole_intent_rejects_breakthrough_thin_floor_and_closed_exit(depth, termination, floor):
    with pytest.raises(CadGeometryError, match="floor|closed exit"):
        build_program_solid(CadProgramSpec.model_validate(plate(depth, termination, floor)))


def test_later_cut_cannot_perforate_the_floor_even_off_axis():
    raw = plate()
    raw["steps"].append({"id": "later", "op": "cut", "shape": "cylinder", "diameter": 1, "height": 6,
                         "position": {"x": 1.5, "y": 0, "z": -3}, "rotation": ZERO})
    with pytest.raises(CadGeometryError, match="floor"):
        build_program_solid(CadProgramSpec.model_validate(raw))


def test_through_and_legacy_depths_remain_compatible():
    assert build_program_solid(CadProgramSpec.model_validate(plate(10.5, "through"))).val().isValid()
    assert build_program_solid(CadProgramSpec.model_validate(plate(10.5, "unspecified"))).val().isValid()


def test_pattern_checks_every_blind_floor():
    raw = plate(6, "blind", 2)
    raw["steps"][1]["pattern"] = {"kind": "linear", "count": 2, "offset": {**ZERO, "x": 8}}
    raw["steps"].append({"id": "later", "op": "cut", "shape": "cylinder", "diameter": 1, "height": 6,
                         "position": {"x": 8, "y": 0, "z": -3}, "rotation": ZERO})
    with pytest.raises(CadGeometryError, match="instance 2.*floor"):
        build_program_solid(CadProgramSpec.model_validate(raw))


def test_threaded_mount_is_verified_and_roundtripped_with_base_lower_face_closed():
    spec = CadAssemblySpec.model_validate(MOUNT)
    solids = _check_interference(spec, _engine())
    for x in (-8, 8):
        assert solids[0].isInside((x, 0, 1))
        assert not solids[0].isInside((x, 0, 10))
    assert build_assembly_step(spec, 2_000_000).solid_count == 2


@pytest.mark.parametrize("failure", ["nominal", "runout", "wrong_entry", "smooth", "filled", "unspecified", "profile"])
def test_threaded_mount_rejects_false_fastening_claims(failure):
    raw = copy.deepcopy(MOUNT)
    thread = raw["components"][0]["steps"][1]
    if failure == "nominal": raw["mechanics"]["connections"][0]["fastenerDiameter"] = 3
    if failure == "runout": raw["mechanics"]["connections"][0]["minEngagement"] = 8
    if failure == "wrong_entry":
        thread["rotation"]["x"] = 180
        thread["position"]["z"] = 3.75
    if failure == "smooth":
        thread.update(shape="cylinder", diameter=4.2)
        for field in ("pitch", "profile", "handedness", "clearance", "starts", "termination", "minBottomThickness"):
            del thread[field]
    if failure == "filled":
        raw["components"][0]["steps"].append({"id": "erase_thread", "op": "cut", "shape": "cylinder", "diameter": 4.2, "height": 8.5,
                                             "position": thread["position"], "rotation": thread["rotation"], "pattern": thread["pattern"]})
    if failure == "unspecified": thread["termination"] = "unspecified"
    if failure == "profile": thread["profile"] = "trapezoidal"
    with pytest.raises((CadAssemblyMechanicalError, CadGeometryError)):
        _check_interference(CadAssemblySpec.model_validate(raw), _engine())


def test_circular_threaded_patterns_match_by_axis_instead_of_list_order():
    raw = copy.deepcopy(MOUNT)
    for component in raw["components"]:
        step = component["steps"][1]
        step["pattern"] = {"kind": "circular", "count": 2, "axis": "z", "center": ZERO, "sweepAngle": 180}
    raw["components"][1]["steps"][1]["position"]["x"] = 8
    assert len(_check_interference(CadAssemblySpec.model_validate(raw), _engine())) == 2
