import struct

import cadquery as cq
import pytest
from fastapi.testclient import TestClient

from api.cad_adapter import CadArtifactTooLargeError
from api.cad_projects import CadProjectStore
from api.cad_stl import stl_artifact_from_shape
from api.config import Settings, get_settings
from api.main import app
from api.routes.cad_projects import get_cad_project_store


def test_adaptive_stl_keeps_absolute_linear_deflection_and_source_geometry():
    shape = cq.Workplane("XY").sphere(20).val()
    volume = shape.Volume()
    fine = stl_artifact_from_shape(shape, 64_000_000)
    smaller = stl_artifact_from_shape(shape, len(fine.data) // 2)
    assert smaller.report()["adaptive"] is True
    assert len(smaller.data) <= len(fine.data) // 2
    assert smaller.triangles < fine.triangles
    assert smaller.linear_deflection_mm == fine.linear_deflection_mm == 0.1
    assert smaller.angular_deflection_rad > fine.angular_deflection_rad
    assert shape.isValid() and shape.Volume() == pytest.approx(volume)
    assert len(smaller.data) == 84 + 50 * int.from_bytes(smaller.data[80:84], "little")


def test_workplane_stl_contains_every_independent_body():
    shape = cq.Workplane("XY").newObject([cq.Workplane("XY").box(10, 10, 10).val(),
        cq.Workplane("XY").box(10, 10, 10).translate((100, 0, 0)).val()])
    artifact = stl_artifact_from_shape(shape, 1_000_000)
    vertices_x = [struct.unpack_from("<f", artifact.data, 84 + triangle * 50 + 12 + vertex * 12)[0]
                  for triangle in range(artifact.triangles) for vertex in range(3)]
    assert min(vertices_x) == pytest.approx(-5)
    assert max(vertices_x) == pytest.approx(105)


def test_impossible_stl_cap_stops_after_four_bounded_attempts(monkeypatch):
    shape = cq.Workplane("XY").sphere(20).val()
    export = cq.Shape.exportStl
    calls = []

    def capture(self, *args, **kwargs):
        calls.append(kwargs)
        return export(self, *args, **kwargs)

    monkeypatch.setattr(cq.Shape, "exportStl", capture)
    with pytest.raises(CadArtifactTooLargeError, match="four bounded"):
        stl_artifact_from_shape(shape, 134)
    assert len(calls) == 4
    assert all(call["relative"] is False and call["tolerance"] == .1 for call in calls)


def test_saved_stl_uses_its_own_limit_and_exposes_meshing_metadata(tmp_path):
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    try:
        client = TestClient(app)
        created = client.post("/api/cad/projects", json={"spec": {
            "schemaVersion": "3.0", "units": "mm", "partId": "saved_box", "steps": [{
                "id": "body", "op": "base", "shape": "box", "position": {"x": 0, "y": 0, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0}, "width": 10, "depth": 10, "height": 10}]}})
        assert created.status_code == 201
        url = f"/api/cad/projects/{created.json()['projectId']}/revisions/0/stl"
        app.dependency_overrides[get_settings] = lambda: Settings(max_artifact_bytes=100, max_cad_stl_bytes=1000)
        response = client.get(url)
        assert response.status_code == 200
        assert len(response.content) == 684
        assert response.headers["x-cad-stl-triangles"] == "12"
        assert response.headers["x-cad-stl-linear-deflection-mm"] == "0.1"
        app.dependency_overrides[get_settings] = lambda: Settings(max_cad_stl_bytes=100)
        assert client.get(url).status_code == 413
    finally:
        app.dependency_overrides.pop(get_settings, None)
        app.dependency_overrides.pop(get_cad_project_store, None)
