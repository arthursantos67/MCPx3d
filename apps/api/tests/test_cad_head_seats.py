import pytest
from domain.cad_program import CadProgramSpec

from api.cad_program_adapter import build_program_solid

ZERO = {"x": 0, "y": 0, "z": 0}


@pytest.mark.parametrize("axis,rotation", [("z", ZERO), ("x", {**ZERO, "y": 90}), ("y", {**ZERO, "x": -90})])
def test_socket_head_counterbore_has_exposed_entrance_and_material_under_the_seat(axis, rotation):
    spec = CadProgramSpec.model_validate({"schemaVersion": "3.0", "units": "mm", "partId": "head_seat", "steps": [
        {"id": "stock", "op": "base", "shape": "box", "width": 20, "depth": 20, "height": 20,
         "position": ZERO, "rotation": ZERO},
        {"id": "mount", "op": "cut", "shape": "hole", "diameter": 5.5, "height": 20.5,
         "holeType": "counterbore", "headDiameter": 9.5, "headDepth": 5.3,
         "position": {**ZERO, axis: 10}, "rotation": rotation}]})
    solid = build_program_solid(spec).val()
    axes = ["x", "y", "z"]
    radial = next(value for value in axes if value != axis)

    def point(axial, radius):
        coordinates = {**ZERO, axis: axial, radial: radius}
        return tuple(coordinates[value] for value in axes)

    assert solid.isValid()
    assert not solid.isInside(point(9.5, 4))
    assert not solid.isInside(point(5, 4))
    assert solid.isInside(point(4, 4))
    assert not solid.isInside(point(-9, 0))
    assert solid.isInside(point(9, 5))
