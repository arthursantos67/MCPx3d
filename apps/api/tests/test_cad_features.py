import copy
import json
import math
from pathlib import Path

import cadquery as cq
import pytest
from domain.cad_assembly import CadAssemblySpec
from domain.cad_program import CadProgramSpec
from fastapi.testclient import TestClient

from api.cad_adapter import CadGeometryError
from api.cad_assembly_adapter import _check_interference, build_assembly_step
from api.cad_mesh import preview_tessellation
from api.cad_program_adapter import build_program_solid, build_program_step
from api.cad_projects import CadProjectStore
from api.cad_threads import _thread_solid
from api.main import app
from api.routes.cad_projects import get_cad_project_store

ROOT = Path(__file__).resolve().parents[3]
FEATURES = json.loads((ROOT / "packages/domain/fixtures/cad-program/features.json").read_text())
DRIVE = json.loads((ROOT / "examples/cad/threaded_drive.json").read_text())


@pytest.mark.parametrize("raw", FEATURES, ids=[item["partId"] for item in FEATURES])
def test_features_keep_their_geometry_in_step(raw, tmp_path) -> None:
    spec = CadProgramSpec.model_validate(raw)
    source = build_program_solid(spec).solids().val()
    artifact = build_program_step(spec, 20_000_000)
    path = tmp_path / "feature.step"
    path.write_bytes(artifact.step)
    restored = cq.importers.importStep(str(path)).solids().val()
    assert restored.isValid()
    assert restored.Volume() == pytest.approx(source.Volume(), rel=1e-5)
    part_id = raw["partId"]
    if part_id.startswith("thread"):
        thread = raw["steps"][0]
        depth = thread["pitch"] * (0.613434654 if thread["profile"] == "metric" else 0.5)
        radius = thread["diameter"] / 2 - depth / 2
        sign = -1 if thread["handedness"] == "left" else 1
        angle = sign * math.pi / (2 * thread["starts"])
        crest = (radius * math.cos(angle), radius * math.sin(angle), thread["pitch"] / 4)
        root_angle = angle + math.pi / thread["starts"]
        root = (radius * math.cos(root_angle), radius * math.sin(root_angle), thread["pitch"] / 4)
        for solid in (source, restored):
            assert solid.isInside(crest)
            assert not solid.isInside(root)
            assert solid.isInside((radius, 0, 0))
            assert not solid.isInside((radius, 0, thread["pitch"] / 2))
    elif part_id in ("plain", "counterbore", "countersink"):
        assert not restored.isInside((0, 0, 0))
        assert restored.isInside((4, 0, 2))
        assert restored.isInside((3.8, 0, 4)) == (part_id == "plain")
    elif part_id == "shell":
        assert restored.Volume() == pytest.approx(40 * 30 * 12 - 36 * 26 * 10)
        assert restored.isInside((0, 0, -5))
        assert not restored.isInside((0, 0, 0))
    elif part_id == "fillet":
        assert restored.Volume() == pytest.approx(40 * 30 * 12 - (4 - math.pi) * 2 ** 2 * 12)
    elif part_id == "tube":
        assert restored.Volume() == pytest.approx(math.pi * (10 ** 2 - 8 ** 2) * 12)
    elif part_id == "torus":
        assert restored.Volume() == pytest.approx(2 * math.pi ** 2 * 10 * 2 ** 2)
    elif part_id == "slot":
        assert restored.Volume() == pytest.approx(((20 - 6) * 6 + math.pi * 3 ** 2) * 4)
    elif part_id == "chamfer":
        assert not restored.isInside((19.9, 0, 5.9))
        assert restored.isInside((19.9, 0, 4))
    elif part_id == "loft":
        assert restored.BoundingBox().zmin == pytest.approx(-5)
        assert restored.BoundingBox().zmax == pytest.approx(5)


@pytest.mark.parametrize("profile,handedness,starts", [("metric", "right", 1), ("metric", "left", 2), ("trapezoidal", "right", 1), ("trapezoidal", "left", 1)])
def test_threaded_nut_matches_rotating_shaft_through_fractional_travel(profile, handedness, starts) -> None:
    raw = copy.deepcopy(DRIVE)
    for component in raw["components"][1:]:
        component["steps"][1].update(profile=profile, handedness=handedness, starts=starts)
    raw["components"][1]["motion"]["factor"] = (-1 if handedness == "right" else 1) * 360 / (2 * starts)
    raw["components"][1]["motion"]["value"] = raw["components"][2]["motion"]["value"] = 1.7
    spec = CadAssemblySpec.model_validate(raw)
    solids = _check_interference(spec, cq)
    assert len(solids) == 3
    assert solids[1].intersect(solids[2]).Volume() <= 0.1
    assert solids[2].BoundingBox().zmin == pytest.approx(-3 + 1.7)


def test_threaded_project_exports_persisted_geometry_and_linked_motion(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    try:
        client = TestClient(app)
        created = client.post("/api/cad/projects", json={"spec": DRIVE})
        assert created.status_code == 201, created.text
        project = created.json()
        project_id = project["projectId"]
        assert project["inspection"]["solidCount"] == 3
        step = client.get(f"/api/cad/projects/{project_id}/revisions/0/step")
        assert step.status_code == 200
        path = tmp_path / "drive.step"
        path.write_bytes(step.content)
        solids = cq.importers.importStep(str(path)).solids().vals()
        assert len(solids) == 3 and all(s.isValid() for s in solids)
        assert not solids[1].isInside((5.5, 0, 1))
        stl = client.get(f"/api/cad/projects/{project_id}/revisions/0/stl")
        assert stl.status_code == 200, stl.text
        assert len(stl.content) == 84 + 50 * int.from_bytes(stl.content[80:84], "little")
        raw = copy.deepcopy(DRIVE)
        for component in raw["components"][1:]:
            component["motion"]["value"] = 2.3
        saved = client.post(f"/api/cad/projects/{project_id}/spec", json={"expectedRevision": 0, "spec": raw})
        assert saved.status_code == 200, saved.text
        assert saved.json()["spec"]["components"][1]["motion"]["factor"] == -180
        nut = client.get(f"/api/cad/projects/{project_id}/revisions/1/components/nut/step")
        assert nut.status_code == 200, nut.text
        path.write_bytes(nut.content)
        assert cq.importers.importStep(str(path)).solids().val().BoundingBox().zmin == pytest.approx(-0.7)
    finally:
        app.dependency_overrides.clear()


def test_impossible_finish_is_rejected_without_losing_the_feature() -> None:
    raw = copy.deepcopy(next(item for item in FEATURES if item["partId"] == "fillet"))
    raw["steps"][1]["radius"] = 100
    with pytest.raises(CadGeometryError, match="fillet.*selector"):
        build_program_solid(CadProgramSpec.model_validate(raw))


def test_assembly_step_keeps_the_threaded_bodies(tmp_path) -> None:
    artifact = build_assembly_step(CadAssemblySpec.model_validate(DRIVE), 20_000_000)
    path = tmp_path / "drive.step"
    path.write_bytes(artifact.step)
    solids = cq.importers.importStep(str(path)).solids().vals()
    assert len(solids) == 3
    assert solids[1].intersect(solids[2]).Volume() <= 0.1


def test_preview_budget_retains_all_eight_long_threaded_bodies_without_changing_solids() -> None:
    source = _thread_solid(12, 2, 32, "metric", "right", 0, 1)
    solids = [source.translate((index * 20, 0, 0)) for index in range(8)]
    volume = source.Volume()
    meshes = preview_tessellation(solids)
    assert len(meshes) == 8
    assert 0 < sum(len(triangles) for _, triangles in meshes) <= 50_000
    for solid, (vertices, triangles) in zip(solids, meshes, strict=True):
        assert solid.Volume() == pytest.approx(volume)
        assert solid.isValid()
        assert min(vertex.z for vertex in vertices) == pytest.approx(-16)
        assert max(vertex.z for vertex in vertices) == pytest.approx(16)
        assert all(0 <= index < len(vertices) for triangle in triangles for index in triangle)
