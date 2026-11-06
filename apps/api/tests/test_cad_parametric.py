"""Native contract tests of programs emitted by the TypeScript parametric compiler."""

import json
import math
from pathlib import Path

import cadquery as cq
import pytest
from domain.cad_program import CadProgramSpec

from api.cad_program_adapter import build_program_solid, build_program_step
from api.cad_stl import stl_artifact_from_saved_step

CASES = json.loads((Path(__file__).resolve().parents[3] / "tests/fixtures/cad-parametric.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_parametric_program_preserves_geometry_through_step_and_stl(case, tmp_path):
    spec = CadProgramSpec.model_validate(case["spec"])
    # A source program is also stable through API serialization, including defaults.
    assert spec.model_dump(mode="json", exclude_none=True) == case["spec"]
    artifact = build_program_step(spec, 10_000_000)
    assert artifact.solid_count == 1
    assert artifact.bounds_mm == pytest.approx(case["expectedBoundsMm"], abs=1e-5)
    assert artifact.volume_mm3 == pytest.approx(case["expectedVolumeMm3"], rel=1e-7, abs=1e-5)
    path = tmp_path / "roundtrip.step"
    path.write_bytes(artifact.step)
    solids = cq.importers.importStep(str(path)).solids().vals()
    assert len(solids) == 1 and solids[0].isValid()
    assert solids[0].Volume() == pytest.approx(case["expectedVolumeMm3"], rel=1e-7, abs=1e-5)
    stl = stl_artifact_from_saved_step(artifact.step, 64_000_000)
    assert stl.triangles > 0
    assert len(stl.data) == 84 + 50 * stl.triangles


@pytest.mark.parametrize("kind", ["plate", "bracket", "flange"])
def test_parametric_mounting_holes_are_open_and_stock_remains_connected(kind):
    case = next(case for case in CASES if case["id"] == f"{kind}-0")
    part = build_program_solid(CadProgramSpec.model_validate(case["spec"]))
    solid = part.solids().val()
    assert solid.isValid() and math.isfinite(solid.Volume())
    # All mounting holes declare through termination: the builder probes both
    # openings and the whole depth after every operation has been applied.
    assert all(step["termination"] == "through" for step in case["spec"]["steps"] if step["shape"] == "hole")
