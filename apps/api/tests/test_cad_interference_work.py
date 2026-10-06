import cadquery as cq
import pytest
from domain.cad_assembly import CadAssemblySpec
from domain.cad_program import CadProgramSpec

from api.cad_adapter import CadGeometryError
from api.cad_assembly_adapter import (
    CadAssemblyInterferenceError,
    _broad_bounds,
    _check_interference,
)
from api.cad_program_adapter import build_program_solid

ZERO = {"x": 0, "y": 0, "z": 0}


def assembly():
    return {"schemaVersion": "4.0", "units": "mm", "partId": "work", "components": [
        {"id": name, "position": {**ZERO, "x": x}, "steps": [
            {"id": "body", "op": "base", "shape": "box", "width": 10, "depth": 10,
             "height": 10, "position": ZERO, "rotation": ZERO}]} for name, x in [("a", 0), ("b", 5), ("c", 100)]]}


def test_fixed_collision_is_calculated_once_and_reported_at_every_motion_pose(monkeypatch):
    raw = assembly()
    raw["components"][2]["motion"] = {"kind": "slider", "axis": "x", "minimum": -5, "maximum": 5, "value": 0}
    original = cq.Shape.intersect
    intersections = []

    def count(self, other, *args, **kwargs):
        intersections.append((self, other))
        return original(self, other, *args, **kwargs)

    monkeypatch.setattr(cq.Shape, "intersect", count)
    with pytest.raises(CadAssemblyInterferenceError) as failed:
        _check_interference(CadAssemblySpec.model_validate(raw), cq)
    assert len(intersections) == 1
    assert len(failed.value.diagnostics.collisions) == 6
    assert {item.pose for item in failed.value.diagnostics.collisions} == {
        "current", "minimum", "quarter", "middle", "three_quarters", "maximum"}
    assert all(item.overlapVolumeMm3 == pytest.approx(500) for item in failed.value.diagnostics.collisions)


def test_separated_solids_do_not_calculate_exact_bounds(monkeypatch):
    raw = assembly()
    raw["components"][1]["position"]["x"] = 50

    def unexpected(*args, **kwargs):
        raise AssertionError("Exact bounds are unnecessary for a separated pair")

    monkeypatch.setattr(cq.Shape, "BoundingBox", unexpected)
    assert len(_check_interference(CadAssemblySpec.model_validate(raw), cq)) == 3


@pytest.mark.parametrize("shape", [cq.Solid.makeCylinder(8, 31), cq.Solid.makeCone(9, 3, 25), cq.Solid.makeTorus(20, 4)])
def test_conservative_bounds_contain_exact_rotated_curved_geometry(shape):
    solid = shape.rotate((0, 0, 0), (1, 2, 3), 37).translate((17, -23, 11))
    broad, exact = _broad_bounds(solid, cq), solid.BoundingBox()
    for axis in ("x", "y", "z"):
        assert getattr(broad, axis + "min") <= getattr(exact, axis + "min") + 1e-6
        assert getattr(broad, axis + "max") >= getattr(exact, axis + "max") - 1e-6


def test_valid_boolean_program_does_not_compute_error_diagnostics(monkeypatch):
    body = assembly()["components"][0]["steps"][0]
    raw = {"schemaVersion": "3.0", "units": "mm", "partId": "cut", "steps": [body,
           {"id": "bore", "op": "cut", "shape": "cylinder", "diameter": 4, "height": 12,
            "position": ZERO, "rotation": ZERO}]}

    def unexpected(*args, **kwargs):
        raise AssertionError("Exact bounds are needed only for a rejected Boolean step")

    monkeypatch.setattr(cq.Shape, "BoundingBox", unexpected)
    solid = build_program_solid(CadProgramSpec.model_validate(raw), cq).solids().val()
    assert solid.isValid()
    assert solid.Volume() == pytest.approx(1000 - 40 * 3.141592653589793)


@pytest.mark.parametrize(("volume", "valid"), [(float("nan"), True), (float("inf"), True), (-1, True), (0, False)])
def test_invalid_intersection_cannot_be_treated_as_a_collision_free_assembly(monkeypatch, volume, valid):
    class InvalidIntersection:
        def Volume(self):
            return volume

        def isValid(self):
            return valid

    monkeypatch.setattr(cq.Shape, "intersect", lambda *args, **kwargs: InvalidIntersection())
    with pytest.raises(CadGeometryError, match="invalid geometry or volume"):
        _check_interference(CadAssemblySpec.model_validate(assembly()), cq)
