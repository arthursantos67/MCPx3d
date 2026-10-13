from pathlib import Path

import pytest
from domain.cad_program import CadProgramSpec

from api.cad_adapter import CadGeometryError
from api.cad_program_adapter import (
    _engine,
    _one_solid,
    build_program_solid,
    build_program_step,
)

ZERO = {"x": 0, "y": 0, "z": 0}


def stock_with_finish(shape, selector, region, **size):
    return CadProgramSpec.model_validate({"schemaVersion": "3.0", "units": "mm", "partId": "local_finish", "steps": [
        {"id": "stock", "op": "base", "shape": "box", "width": 40, "depth": 30, "height": 12, "position": ZERO, "rotation": ZERO},
        {"id": "finish", "op": "modify", "shape": shape, "selector": selector, "selectionBox": region, "position": ZERO, "rotation": ZERO, **size}]})


@pytest.mark.parametrize("shape,size", [("chamfer", {"distance": 1}), ("fillet", {"radius": 1})])
def test_region_finishes_only_one_vertical_edge_and_survives_step(shape, size, tmp_path: Path):
    spec = stock_with_finish(shape, "parallel_z", {"min": {"x": 19, "y": 14, "z": -1}, "max": {"x": 21, "y": 16, "z": 1}}, **size)
    artifact = build_program_step(spec, 2_000_000)
    step = tmp_path / "local.step"
    step.write_bytes(artifact.step)
    solid = _one_solid(_engine().importers.importStep(str(step)))
    assert not solid.isInside((19.95, 14.95, 0), 1e-6)
    for point in ((-19.95, 14.95, 0), (-19.95, -14.95, 0), (19.95, -14.95, 0)):
        assert solid.isInside(point, 1e-6)
    assert artifact.volume_mm3 < 40 * 30 * 12
    assert artifact.volume_mm3 > 40 * 30 * 12 - 12


def test_empty_region_is_rejected_instead_of_omitting_the_requested_finish():
    spec = stock_with_finish("chamfer", "all", {"min": {"x": 100, "y": 100, "z": 100}, "max": {"x": 110, "y": 110, "z": 110}}, distance=1)
    with pytest.raises(CadGeometryError, match="selected no edges.*selectionBox"):
        build_program_solid(spec)


def test_region_filters_the_selector_instead_of_overriding_it():
    spec = stock_with_finish("chamfer", "top", {"min": {"x": 19, "y": 14, "z": -1}, "max": {"x": 21, "y": 16, "z": 1}}, distance=1)
    with pytest.raises(CadGeometryError, match="selected no edges"):
        build_program_solid(spec)
