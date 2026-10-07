import copy
import io
import json
from zipfile import ZipFile

import cadquery as cq
import pytest
from fastapi.testclient import TestClient

from api.config import Settings, get_settings
from api.main import app

ZERO = {"x": 0, "y": 0, "z": 0}
BODY = {"id": "body", "op": "base", "shape": "box", "position": ZERO, "rotation": ZERO,
        "width": 20, "depth": 20, "height": 10}
PROGRAM = {"schemaVersion": "3.0", "units": "mm", "partId": "draft_plate", "steps": [BODY]}
BROKEN_FINISH = {"id": "finish", "op": "modify", "shape": "chamfer", "position": ZERO,
                 "rotation": ZERO, "selector": "all", "distance": 100}


def exported(request):
    response = TestClient(app).post("/api/cad/drafts/export", json=request)
    assert response.status_code == 200, response.text
    assert response.headers["x-cad-validation"] == "draft"
    archive = ZipFile(io.BytesIO(response.content))
    return archive, json.loads(archive.read("report.json"))


def import_step(archive, name, tmp_path):
    path = tmp_path / "draft.step"
    path.write_bytes(archive.read(name))
    return cq.importers.importStep(str(path)).solids().vals()


def test_unapproved_colliding_assembly_exports_independent_solids_and_does_not_save_a_revision(tmp_path):
    spec = {"schemaVersion": "4.0", "units": "mm", "partId": "overlap", "components": [
        {"id": name, "position": ZERO, "steps": [BODY]} for name in ["first", "second"]]}
    client = TestClient(app)
    assert client.post("/api/cad/assemblies/inspect", json=spec).status_code == 422
    archive, report = exported({"spec": spec, "issue": "Interferência pendente", "plannedComponentIds": ["first", "second"]})
    solids = import_step(archive, "overlap-draft.step", tmp_path)
    assert len(solids) == 2 and all(solid.isValid() for solid in solids)
    assert solids[0].intersect(solids[1]).Volume() == pytest.approx(4000)
    assert report["assemblyValidation"] == "not_run"
    assert report["geometryValidation"] == "step_roundtrip_verified"
    assert report["status"] == "draft" and not report["partial"]
    assert report["sourceIssue"] == "Interferência pendente"
    assert "components/first.step" in archive.namelist() and "components/second.stl" in archive.namelist()
    assert client.post("/api/cad/projects", json={"spec": spec}).status_code == 422


def test_failed_finish_exports_only_the_valid_prefix_and_keeps_the_original_recipe(tmp_path):
    spec = {**PROGRAM, "steps": [BODY, BROKEN_FINISH, {**BODY, "id": "later", "op": "union"}]}
    original = copy.deepcopy(spec)
    archive, report = exported({"spec": spec})
    assert spec == original
    assert json.loads(archive.read("original-draft.json")) == original
    assert report["partial"]
    assert report["components"][0]["completedStepIds"] == ["body"]
    assert report["components"][0]["omittedStepIds"] == ["finish", "later"]
    assert "chamfer" in report["components"][0]["issue"]
    solids = import_step(archive, "draft_plate-draft.step", tmp_path)
    assert len(solids) == 1 and solids[0].Volume() == pytest.approx(4000)
    stl = archive.read("draft_plate-draft.stl")
    assert len(stl) == 84 + 50 * int.from_bytes(stl[80:84], "little")


def test_partial_assembly_can_export_one_component_and_report_the_unbuilt_ones(tmp_path):
    spec = {"schemaVersion": "4.0", "units": "mm", "partId": "unfinished", "components": [
        {"id": "base", "position": ZERO, "steps": [BODY]}]}
    archive, report = exported({"spec": spec, "plannedComponentIds": ["base", "shaft", "wheel"], "pendingComponentId": "shaft"})
    assert len(import_step(archive, "unfinished-draft.step", tmp_path)) == 1
    assert report["missingPlannedComponents"] == ["shaft", "wheel"]
    assert report["partial"]


def test_draft_preview_ignores_assembly_approval_and_uses_current_motion_pose():
    spec = {"schemaVersion": "4.0", "units": "mm", "partId": "moving", "components": [
        {"id": "car", "position": {**ZERO, "x": 50}, "steps": [BODY],
         "motion": {"kind": "slider", "axis": "x", "minimum": 0, "maximum": 10, "value": 7}}]}
    response = TestClient(app).post("/api/cad/drafts/mesh", json={"spec": spec})
    assert response.status_code == 200, response.text
    mesh = response.json()
    assert min(point[0] for point in mesh["vertices"]) == pytest.approx(47)
    assert max(point[0] for point in mesh["vertices"]) == pytest.approx(67)
    assert mesh["draftReport"]["assemblyValidation"] == "not_run"


def test_empty_invalid_base_has_no_fake_step_or_stl():
    spec = {**PROGRAM, "steps": [{"id": "bad", "op": "base", "shape": "polygon_prism", "position": ZERO,
        "rotation": ZERO, "height": 10, "points": [{"x": 0, "y": 0}, {"x": 40, "y": 30}, {"x": 0, "y": 30}, {"x": 30, "y": 0}]}]}
    response = TestClient(app).post("/api/cad/drafts/export", json={"spec": spec})
    assert response.status_code == 422
    assert response.json()["code"] == "CAD_DRAFT_EMPTY"
    assert response.json()["details"][0]["components"][0]["status"] == "omitted"


def test_draft_reports_an_invalid_component_without_losing_the_other_solids():
    bad = {"id": "bad", "position": ZERO, "steps": [{**BODY, "shape": "polygon_prism", "height": 10,
        "points": [{"x": 0, "y": 0}, {"x": 40, "y": 30}, {"x": 0, "y": 30}, {"x": 30, "y": 0}]}]}
    for field in ["width", "depth"]:
        bad["steps"][0].pop(field)
    spec = {"schemaVersion": "4.0", "units": "mm", "partId": "mixed", "components": [
        {"id": "good", "position": ZERO, "steps": [BODY]}, bad]}
    _, report = exported({"spec": spec, "plannedComponentIds": ["good", "bad"]})
    assert report["components"][1]["status"] == "omitted"
    assert report["missingPlannedComponents"] == ["bad"]


def test_draft_export_respects_size_limits_and_rejects_invalid_structured_input():
    app.dependency_overrides[get_settings] = lambda: Settings(max_artifact_bytes=100)
    try:
        response = TestClient(app).post("/api/cad/drafts/export", json={"spec": PROGRAM})
        assert response.status_code == 413
    finally:
        app.dependency_overrides.pop(get_settings)
    for invalid in [{**PROGRAM, "code": "print('not executable')"}, {**PROGRAM, "steps": []}]:
        assert TestClient(app).post("/api/cad/drafts/export", json={"spec": invalid}).status_code == 400


def test_draft_rejects_excessive_total_steps_before_kernel_work():
    steps = [{**BODY, "id": f"step_{index}", "op": "base" if index == 0 else "union"} for index in range(32)]
    spec = {"schemaVersion": "4.0", "units": "mm", "partId": "excessive", "components": [
        {"id": f"body_{index}", "position": ZERO, "steps": steps} for index in range(5)]}
    response = TestClient(app).post("/api/cad/drafts/export", json={"spec": spec})
    assert response.status_code == 400
    assert "128 construction steps" in response.json()["message"]


def test_draft_keeps_step_and_reports_stl_omissions_when_meshing_cannot_fit(tmp_path):
    app.dependency_overrides[get_settings] = lambda: Settings(max_cad_stl_bytes=100)
    try:
        archive, report = exported({"spec": PROGRAM})
        assert len(import_step(archive, "draft_plate-draft.step", tmp_path)) == 1
        assert "draft_plate-draft.stl" not in archive.namelist()
        assert "draft_plate-draft.stl" in report["stl"]["omitted"]
        assert report["geometryValidation"] == "step_roundtrip_verified"
    finally:
        app.dependency_overrides.pop(get_settings)


def test_draft_uses_a_separate_bundle_limit():
    app.dependency_overrides[get_settings] = lambda: Settings(max_cad_draft_bundle_bytes=100)
    try:
        response = TestClient(app).post("/api/cad/drafts/export", json={"spec": PROGRAM})
        assert response.status_code == 413
    finally:
        app.dependency_overrides.pop(get_settings)
