import math
from pathlib import Path

import pytest
from domain.cad_program import CadProgramSpec

from api.cad_program_adapter import (
    _engine,
    _one_solid,
    build_program_solid,
    build_program_step,
)

ZERO = {"x": 0, "y": 0, "z": 0}


def program(shape, **fields):
    return CadProgramSpec.model_validate({"schemaVersion": "3.0", "units": "mm", "partId": shape,
        "steps": [{"id": "body", "op": "base", "shape": shape, "position": ZERO, "rotation": ZERO, **fields}]})


@pytest.mark.parametrize("angle,inner", [(45, 0), (90, 8), (180, 8), (270, 8)])
def test_bend_has_analytic_volume_and_open_bore_after_step(angle, inner, tmp_path: Path):
    spec = program("pipe_bend", diameter=12, innerDiameter=inner, bendRadius=24, bendAngle=angle)
    artifact = build_program_step(spec, 2_000_000)
    area = math.pi * (12 ** 2 - inner ** 2) / 4
    assert artifact.volume_mm3 == pytest.approx(area * 24 * math.radians(angle), rel=1e-5)
    path = tmp_path / "bend.step"
    path.write_bytes(artifact.step)
    solid = _one_solid(_engine().importers.importStep(str(path)))
    for phase in (.1, .5, .9):
        theta = math.radians(angle) * phase
        assert solid.isInside(((24 + 5) * math.cos(theta), (24 + 5) * math.sin(theta), 0), 1e-6)
        assert solid.isInside((24 * math.cos(theta), 24 * math.sin(theta), 0), 1e-6) == (inner == 0)


@pytest.mark.parametrize("hand,sign", [("right", 1), ("left", -1)])
def test_real_spring_preserves_fractional_turns_hand_and_volume_in_step(hand, sign, tmp_path: Path):
    spec = program("helical_spring", meanDiameter=20, wireDiameter=2, pitch=5, turns=2.25, handedness=hand)
    artifact = build_program_step(spec, 2_000_000)
    expected = math.pi * math.hypot(math.pi * 20, 5) * 2.25
    assert artifact.volume_mm3 == pytest.approx(expected, rel=2e-4)
    path = tmp_path / "spring.step"
    path.write_bytes(artifact.step)
    solid = _one_solid(_engine().importers.importStep(str(path)))
    assert solid.isInside((0, sign * 10, -5 * 2.25 / 2 + 5 / 4), 1e-5)
    assert not solid.isInside((0, -sign * 10, -5 * 2.25 / 2 + 5 / 4), 1e-5)
    assert not solid.isInside((0, 0, 0), 1e-5)


@pytest.mark.parametrize("inner", [0, 4])
def test_straight_3d_sweep_has_exact_volume_and_retains_local_placement(inner):
    spec = program("sweep", diameter=6, innerDiameter=inner,
                   path=[{"x": 2, "y": 3, "z": 4}, {"x": 14, "y": 3, "z": 20}])
    solid = _one_solid(build_program_solid(spec))
    assert solid.Volume() == pytest.approx(math.pi * (36 - inner ** 2) / 4 * 20, rel=1e-5)
    assert solid.isInside((8, 3, 12), 1e-6) == (inner == 0)
    assert solid.isInside((8, 5.5, 12), 1e-6)


def test_bent_sweep_exports_one_connected_hollow_solid():
    spec = program("sweep", diameter=6, innerDiameter=4,
                   path=[ZERO, {"x": 0, "y": 0, "z": 20}, {"x": 20, "y": 0, "z": 20}])
    artifact = build_program_step(spec, 2_000_000)
    assert artifact.solid_count == 1
    assert artifact.volume_mm3 > 500
    assert b"ISO-10303-21" in artifact.step
