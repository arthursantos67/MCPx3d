import math

import cadquery as cq
import pytest
from domain.cad_program import CadProgramSpec

from api.cad_adapter import CadGeometryError
from api.cad_material_change import changes_material
from api.cad_program_adapter import build_program_solid, build_program_step


def small_feature(op, x=500):
    zero = {"x": 0, "y": 0, "z": 0}
    return CadProgramSpec.model_validate({"schemaVersion": "3.0", "units": "mm", "partId": "small_feature", "steps": [
        {"id": "stock", "op": "base", "shape": "box", "position": zero, "rotation": zero, "width": 1000, "depth": 1000, "height": 1000},
        {"id": "detail", "op": op, "shape": "box", "position": {"x": x, "y": 0, "z": 0}, "rotation": zero, "width": 0.5, "depth": 0.5, "height": 0.5},
    ]})


@pytest.mark.parametrize("op,sign", [("cut", -1), ("union", 1)])
def test_small_details_are_not_rejected_relative_to_large_stock(op, sign):
    # Previously both operations failed as no-ops: 0.0625 mm³ is below the old
    # 1 mm³ threshold obtained from this stock's 1e9 mm³ total volume.
    solid = build_program_solid(small_feature(op)).solids().val()
    assert solid.isValid()
    assert solid.Volume() == pytest.approx(1_000_000_000 + sign * 0.0625, abs=1e-5, rel=0)
    if op == "union":
        assert solid.BoundingBox().xmax == pytest.approx(500.25)


@pytest.mark.parametrize("op,x", [("cut", 510), ("union", 0)])
def test_genuine_noops_on_large_stock_remain_errors(op, x):
    with pytest.raises(CadGeometryError, match="detail instance 1 does not change the solid"):
        build_program_solid(small_feature(op, x))


def test_small_edge_finishes_use_actual_removed_material():
    # A small boss on large stock: finishing its rim changes far less than the
    # previous relative-volume threshold, but must still count as a real finish.
    stock = cq.Workplane("XY").box(1000, 1000, 1000)
    boss = cq.Workplane("XY").box(1, 1, 1).translate((0, 0, 500))
    before = stock.union(boss)
    after = before.edges(">Z").fillet(0.1)
    assert changes_material(before.solids().val(), after.solids().val(), "cut")
    assert not changes_material(before.solids().val(), before.solids().val(), "cut")


def test_small_blind_drilling_survives_validation_and_step_roundtrip(tmp_path):
    raw = small_feature("cut").model_dump(mode="json", exclude_none=True)
    raw["steps"][1] = {
        "id": "drilling", "op": "cut", "shape": "hole", "diameter": 0.5, "height": 1,
        "holeType": "plain", "headDiameter": 0, "headDepth": 0,
        "termination": "blind", "minBottomThickness": 1,
        "position": {"x": 0, "y": 0, "z": 500}, "rotation": {"x": 0, "y": 0, "z": 0},
    }
    artifact = build_program_step(CadProgramSpec.model_validate(raw), 2_000_000)
    assert artifact.volume_mm3 == pytest.approx(1e9 - math.pi * 0.25 ** 2, abs=1e-5, rel=0)
    target = tmp_path / "blind.step"
    target.write_bytes(artifact.step)
    solid = cq.importers.importStep(str(target)).solids().val()
    assert solid.isValid()
    assert not solid.isInside((0, 0, 499.5), 1e-6)
    assert solid.isInside((0, 0, 498.5), 1e-6)
