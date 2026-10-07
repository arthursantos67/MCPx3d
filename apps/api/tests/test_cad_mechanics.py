import copy
import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from domain.cad_assembly import CadAssemblySpec
from fastapi.testclient import TestClient

from api.cad_assembly_adapter import (
    CadAssemblyMechanicalError,
    _check_interference,
    _component_solid,
    _position_component,
    build_assembly_step,
)
from api.cad_mechanics import check_mechanics
from api.cad_program_adapter import _engine
from api.cad_projects import CadProjectStore
from api.main import app
from api.routes.cad_projects import get_cad_project_store

ROOT = Path(__file__).resolve().parents[3]
STAGE = json.loads((ROOT / "examples/cad/functional_linear_stage.json").read_text())
ZERO = {"x": 0, "y": 0, "z": 0}


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "mechanics.sqlite3")
    try:
        with TestClient(app) as http:
            yield http
    finally:
        app.dependency_overrides.pop(get_cad_project_store, None)


def mounting():
    def component(name, height, origin):
        return {"id": name, "position": {**ZERO, "z": origin}, "steps": [
            {"id": "body", "op": "base", "shape": "box", "position": {**ZERO, "z": height / 2}, "rotation": ZERO,
             "width": 20, "depth": 30, "height": height},
            {"id": "mount", "op": "cut", "shape": "hole", "position": {**ZERO, "y": -8, "z": height}, "rotation": ZERO,
             "height": height + 2, "diameter": 4.4, "holeType": "plain", "headDiameter": 0, "headDepth": 0,
             "pattern": {"kind": "linear", "count": 2, "offset": {**ZERO, "y": 16}}},
        ]}
    return {"schemaVersion": "4.0", "units": "mm", "partId": "bolted_mount", "components": [component("base", 4, 0), component("support", 20, 4)],
            "mechanics": {"grounded": "base", "connections": [{"id": "mount", "kind": "fixed", "first": "support", "second": "base",
                "firstFeature": "mount", "secondFeature": "mount", "maxClearance": 0.3, "minEngagement": 4, "fastening": "bolted", "fastenerDiameter": 4}]}}


def test_real_bolted_contact_is_verified_and_exported():
    artifact = build_assembly_step(CadAssemblySpec.model_validate(mounting()), 1_000_000)
    assert artifact.solid_count == 2
    assert len(artifact.step) > 1000


def patterned_receiver():
    receiver = {"id": "receiver", "position": ZERO, "steps": [
        {"id": "body", "op": "base", "shape": "box", "position": {**ZERO, "z": 5}, "rotation": ZERO,
         "width": 30, "depth": 30, "height": 10},
        {"id": "bores", "op": "cut", "shape": "hole", "position": {**ZERO, "x": -8, "z": 10}, "rotation": ZERO,
         "height": 12, "diameter": 4.4, "holeType": "plain", "headDiameter": 0, "headDepth": 0,
         "pattern": {"kind": "linear", "count": 2, "offset": {**ZERO, "x": 16}}},
    ]}
    shafts = [{"id": name, "position": {**ZERO, "x": x, "z": 5}, "steps": [
        {"id": "shaft", "op": "base", "shape": "cylinder", "position": ZERO, "rotation": ZERO,
         "height": 12, "diameter": 4},
    ]} for name, x in (("left", -8), ("right", 8))]
    return {"schemaVersion": "4.0", "units": "mm", "partId": "patterned_receiver", "components": [receiver, *shafts],
            "mechanics": {"grounded": "receiver", "connections": [
                {"id": name + "_fit", "kind": "fixed", "first": name, "second": "receiver",
                 "firstFeature": "shaft", "secondFeature": "bores", "maxClearance": 0.3,
                 "minEngagement": 10, "fastening": "bonded", "fastenerDiameter": 0} for name in ("left", "right")]}}


def test_separate_shafts_can_reference_unique_coaxial_instances_of_a_receiving_pattern():
    artifact = build_assembly_step(CadAssemblySpec.model_validate(patterned_receiver()), 1_000_000)
    assert artifact.solid_count == 3


@pytest.mark.parametrize("failure", ["missing_instance", "ambiguous_instances", "insufficient_engagement", "removed_wall"])
def test_patterned_receivers_keep_alignment_engagement_and_material_checks(failure):
    raw = patterned_receiver()
    bore = raw["components"][0]["steps"][1]
    if failure == "missing_instance":
        raw["components"][1]["position"]["x"] = 0
    elif failure == "ambiguous_instances":
        bore["pattern"]["offset"] = {**ZERO, "z": -4}
        bore["height"] = 6
    elif failure == "insufficient_engagement":
        raw["components"][1]["position"]["z"] = 10
    else:
        raw["components"][0]["steps"][0]["width"] = 20
    spec = CadAssemblySpec.model_validate(raw)
    cq = _engine()
    solids = [_component_solid(component, cq) for component in spec.components]
    issues = check_mechanics(spec, cq, [("current", list(spec.components), solids)])
    assert issues
    expected = {"missing_instance": "found 0", "ambiguous_instances": "found 2",
                "insufficient_engagement": "insufficient engagement", "removed_wall": "lacks surrounding material"}
    assert expected[failure] in issues[0]["message"]


@pytest.mark.parametrize("hole_type", ["counterbore", "countersink"])
def test_real_bolted_mount_accepts_exposed_head_recesses_with_material_around_their_profile(hole_type):
    raw = mounting()
    raw["components"][1]["steps"][1].update(holeType=hole_type, headDiameter=8, headDepth=4.3)
    artifact = build_assembly_step(CadAssemblySpec.model_validate(raw), 1_000_000)
    assert artifact.solid_count == 2


@pytest.mark.parametrize("failure", ["no_seat", "open_wall", "filled_head", "outside_head"])
def test_head_recesses_do_not_hide_missing_stock_or_a_removed_recess(failure):
    raw = mounting()
    head = raw["components"][1]["steps"][1]
    head.update(holeType="counterbore", headDiameter=8, headDepth=4.3)
    if failure == "no_seat":
        head["headDepth"] = 20.5
    elif failure == "open_wall":
        head["headDiameter"] = 18
    elif failure == "outside_head":
        head["position"] = {**head["position"], "z": 25}
        head["height"] = 30
    else:
        raw["components"][1]["steps"].extend([
            {"id": "head_plug", "op": "union", "shape": "cylinder", "position": {**ZERO, "y": -8, "z": 18},
             "rotation": ZERO, "height": 4, "diameter": 8.2},
            {"id": "reopened_bore", "op": "cut", "shape": "cylinder", "position": {**ZERO, "y": -8, "z": 18},
             "rotation": ZERO, "height": 5, "diameter": 4.4},
        ])
    with pytest.raises(CadAssemblyMechanicalError):
        build_assembly_step(CadAssemblySpec.model_validate(raw), 1_000_000)


@pytest.mark.parametrize("failure", ["floating", "misaligned", "fastener", "erased_bore", "blind_bore"])
def test_collision_free_mounting_errors_are_rejected(failure):
    raw = mounting()
    if failure == "floating":
        raw["components"][1]["position"]["z"] += 2
    elif failure == "misaligned":
        raw["components"][1]["steps"][1]["position"]["x"] = 3
    elif failure == "fastener":
        raw["mechanics"]["connections"][0]["fastenerDiameter"] = 5
    elif failure == "blind_bore":
        raw["components"][1]["steps"][1]["height"] = 8
    else:
        raw["components"][0]["steps"].append({"id": "plug", "op": "union", "shape": "cylinder", "position": {**ZERO, "y": -8, "z": 2},
                                             "rotation": ZERO, "height": 4, "diameter": 4.4})
    with pytest.raises(CadAssemblyMechanicalError) as caught:
        build_assembly_step(CadAssemblySpec.model_validate(raw), 1_000_000)
    assert caught.value.diagnostics["issues"][0]["connectionId"] == "mount"


def test_invalid_mount_cannot_be_saved_or_create_a_revision(client):
    raw = mounting()
    saved = client.post("/api/cad/projects", json={"spec": raw})
    assert saved.status_code == 201
    assert saved.json()["inspection"]["mechanicalStatus"] == "verified"
    project = saved.json()["projectId"]
    raw["components"][1]["position"]["z"] += 2
    failed = client.post(f"/api/cad/projects/{project}/spec", json={"expectedRevision": 0, "spec": raw})
    assert failed.status_code == 422
    assert failed.json()["code"] == "CAD_MECHANICS_INVALID"
    assert client.get(f"/api/cad/projects/{project}").json()["revision"] == 0


def test_legacy_separated_fixed_bodies_are_explicitly_unverified(client):
    raw = mounting()
    del raw["mechanics"]
    raw["components"][1]["position"]["z"] += 24
    result = client.post("/api/cad/assemblies/mechanics", json=raw)
    assert result.status_code == 200
    report = result.json()
    assert report["status"] == "unverified"
    assert len(report["separatedFixedComponents"]) == 2
    assert report["separatedFixedComponents"][0]["gapMm"] == pytest.approx(24)


@pytest.fixture(scope="module")
def stage_geometry():
    spec = CadAssemblySpec.model_validate(STAGE)
    cq = _engine()
    solids = _check_interference(spec, cq)
    locals_ = [solid.translate(tuple(-value for value in (component.position.x, component.position.y, component.position.z)))
               for component, solid in zip(spec.components, solids, strict=True)]
    return cq, spec, solids, locals_


def stage_issues(raw, geometry):
    cq, _, _, locals_ = geometry
    spec = CadAssemblySpec.model_validate(raw)
    poses = []
    for name, fraction in [("current", None)]:
        components = [component.model_copy(update={"motion": component.motion.model_copy(update={"value": component.motion.minimum + (component.motion.maximum - component.motion.minimum) * fraction})})
                      if component.motion and fraction is not None else component for component in spec.components]
        poses.append((name, components, [_position_component(component, solid) for component, solid in zip(components, locals_, strict=True)]))
    return check_mechanics(spec, cq, poses)


def test_complete_stage_threads_guides_bearings_and_step(stage_geometry, monkeypatch):
    cq, spec, solids, _ = stage_geometry
    monkeypatch.setattr("api.cad_assembly_adapter._check_interference", lambda candidate, engine: solids if candidate == spec and engine == cq else pytest.fail("unexpected assembly"))
    artifact = build_assembly_step(spec, 10_000_000)
    assert artifact.solid_count == 8
    assert len(artifact.step) > 1_000_000


@pytest.mark.parametrize("failure", ["wrong_lead", "no_antirotation", "no_bearings", "wrong_local_offset", "unsupported_screw"])
def test_stage_requires_mechanical_constraints_beyond_animation(failure, stage_geometry):
    raw = copy.deepcopy(STAGE)
    components = {component["id"]: component for component in raw["components"]}
    joints = raw["mechanics"]["connections"]
    if failure == "wrong_lead":
        components["screw"]["motion"]["factor"] = -100
    elif failure == "no_antirotation":
        joints[:] = [joint for joint in joints if joint["id"] != "slide_rear"]
    elif failure == "no_bearings":
        joints[:] = [joint for joint in joints if joint["kind"] != "rotary"]
    elif failure == "wrong_local_offset":
        components["support_left"]["position"]["z"] += 12
    else:
        components["screw"]["motion"].update(kind="screw", pitch=3, factor=1)
    issues = stage_issues(raw, stage_geometry)
    assert issues
    assert any(issue["message"].startswith("CAD mechanical") for issue in issues)


def test_round_nut_cavity_does_not_prove_antirotation():
    raw = {"schemaVersion": "4.0", "units": "mm", "partId": "loose_nut", "components": [
        {"id": "receiver", "position": ZERO, "steps": [
            {"id": "body", "op": "base", "shape": "box", "position": ZERO, "rotation": ZERO, "width": 20, "depth": 20, "height": 20},
            {"id": "cavity", "op": "cut", "shape": "cylinder", "position": ZERO, "rotation": {**ZERO, "y": 90}, "diameter": 10.4, "height": 8.4}]},
        {"id": "nut", "position": ZERO, "steps": [
            {"id": "body", "op": "base", "shape": "cylinder", "position": ZERO, "rotation": {**ZERO, "y": 90}, "diameter": 10, "height": 8}]},
    ], "mechanics": {"grounded": "receiver", "connections": [{"id": "nut_capture", "kind": "fixed", "first": "nut", "second": "receiver",
        "firstFeature": "", "secondFeature": "", "maxClearance": .3, "minEngagement": 2, "fastening": "captured", "fastenerDiameter": 0}]}}
    with pytest.raises(CadAssemblyMechanicalError, match="antirotation"):
        _check_interference(CadAssemblySpec.model_validate(raw), _engine())


def rotating_stop_spec():
    axial = {**ZERO, "y": 90}
    raw = {"schemaVersion": "4.0", "units": "mm", "partId": "rotating_stop", "components": [
        {"id": "bearing", "position": ZERO, "steps": [
            {"id": "body", "op": "base", "shape": "box", "position": ZERO, "rotation": ZERO, "width": 10, "depth": 20, "height": 20},
            {"id": "bore", "op": "cut", "shape": "cylinder", "position": ZERO, "rotation": axial, "diameter": 6.4, "height": 12},
            {"id": "blind_diagonal_slot", "op": "cut", "shape": "box", "position": {**ZERO, "x": 4.5}, "rotation": {**ZERO, "x": 45}, "width": 1.2, "depth": 24, "height": 2.4}]},
        {"id": "shaft", "position": ZERO, "motion": {"kind": "rotary", "axis": "x", "minimum": 0, "maximum": 90, "value": 0}, "steps": [
            {"id": "journal", "op": "base", "shape": "cylinder", "position": ZERO, "rotation": axial, "diameter": 6, "height": 12},
            {"id": "left_collar", "op": "union", "shape": "cylinder", "position": {**ZERO, "x": -5.3}, "rotation": axial, "diameter": 12, "height": .6},
            {"id": "right_tab", "op": "union", "shape": "box", "position": {**ZERO, "x": 5.3}, "rotation": ZERO, "width": .6, "depth": 16, "height": 2}]},
    ], "mechanics": {"grounded": "bearing", "connections": [{"id": "bearing_fit", "kind": "rotary", "first": "shaft", "second": "bearing",
        "firstFeature": "journal", "secondFeature": "bore", "maxClearance": .3, "minEngagement": 8, "fastening": "none", "fastenerDiameter": 0}]}}
    return raw


def test_axial_stop_must_retain_the_shaft_after_rotation():
    with pytest.raises(CadAssemblyMechanicalError) as caught:
        raw = rotating_stop_spec()
        _check_interference(CadAssemblySpec.model_validate(raw), _engine())
    issues = caught.value.diagnostics["issues"]
    assert any(issue["pose"] == "middle" and "axial stops" in issue["message"] for issue in issues)
    assert not any(issue["pose"] == "current" for issue in issues)


def test_equivalent_full_turn_poses_reuse_retention_checks(monkeypatch):
    from api import cad_mechanics as mechanics

    raw = rotating_stop_spec()
    raw["components"][0]["steps"].pop()
    shaft = raw["components"][1]
    shaft["motion"]["maximum"] = 1440
    shaft["steps"][-1] = {**shaft["steps"][1], "id": "right_collar", "position": {**ZERO, "x": 5.3}}
    original = mechanics._blocked
    calls = []
    def tracked(first, second):
        calls.append((first, second))
        return original(first, second)
    monkeypatch.setattr(mechanics, "_blocked", tracked)
    assert len(_check_interference(CadAssemblySpec.model_validate(raw), _engine())) == 2
    assert len(calls) == 2


@pytest.mark.parametrize("wrong_factor", [False, True])
def test_removable_shoulder_retains_a_verified_rigid_rotary_cluster(wrong_factor):
    raw = rotating_stop_spec()
    raw["components"][0]["steps"].pop()
    shaft = raw["components"][1]
    shaft["motion"].update(group="drive", factor=1)
    shoulder = shaft["steps"].pop(1)
    shaft["steps"][-1] = {**copy.deepcopy(shoulder), "id": "right_collar", "position": {**ZERO, "x": 5.3}}
    wheel = {"id": "wheel", "position": ZERO, "motion": {**shaft["motion"], "factor": 2 if wrong_factor else 1}, "steps": [
        {**shoulder, "op": "base", "id": "body"},
        {**shoulder, "op": "cut", "id": "bore", "diameter": 6.4, "height": .8}]}
    raw["components"].append(wheel)
    raw["mechanics"]["connections"].append({"id": "wheel_fixation", "kind": "fixed", "first": "shaft", "second": "wheel",
        "firstFeature": "journal", "secondFeature": "bore", "maxClearance": .3, "minEngagement": .5, "fastening": "bonded", "fastenerDiameter": 0})
    spec = CadAssemblySpec.model_validate(raw)
    if wrong_factor:
        with pytest.raises(CadAssemblyMechanicalError, match="equal rigid motion"):
            _check_interference(spec, _engine())
    else:
        assert len(_check_interference(spec, _engine())) == 3


def test_material_classifier_is_reused_without_changing_point_answers(monkeypatch):
    from types import SimpleNamespace

    from api import cad_mechanics as mechanics

    original_import = mechanics.import_module
    constructor = original_import("OCP.BRepClass3d").BRepClass3d_SolidClassifier
    calls = []
    def factory(solid):
        calls.append(solid)
        return constructor(solid)
    monkeypatch.setattr(mechanics, "import_module", lambda name: SimpleNamespace(BRepClass3d_SolidClassifier=factory) if name == "OCP.BRepClass3d" else original_import(name))
    solid = _engine().Workplane("XY").box(20, 20, 20).val()
    checker = mechanics.MaterialChecks()
    for point in [(0, 0, 0), (5, 5, 5), (30, 0, 0), (0, 0, 10)]:
        assert checker.inside(solid, point) == solid.isInside(point, 1e-6)
    assert len(calls) == 1


@pytest.mark.parametrize("journal_center", [105, 102])
def test_reported_journal_intervals_distinguish_engagement_from_actual_interference(journal_center):
    from domain.cad_assembly import CadMechanicalConnection

    from api.cad_mechanics import MaterialChecks, _fit

    axial = {**ZERO, "y": 90}
    support = lambda sign: {"id": "left" if sign < 0 else "right", "position": {"x": sign * 102, "y": 0, "z": 30}, "steps": [
        {"id": "body", "op": "base", "shape": "box", "position": ZERO, "rotation": ZERO, "width": 14, "depth": 20, "height": 20},
        {"id": "bore", "op": "cut", "shape": "hole", "position": {**ZERO, "x": 7}, "rotation": axial,
         "diameter": 10.2, "height": 14, "holeType": "plain", "headDiameter": 0, "headDepth": 0}]}
    shaft = {"id": "shaft", "position": {**ZERO, "z": 30}, "motion": {"kind": "rotary", "axis": "x", "minimum": 0, "maximum": 360, "value": 0}, "steps": [
        {"id": "core", "op": "base", "shape": "cylinder", "position": ZERO, "rotation": axial, "diameter": 8, "height": 228},
        *[{"id": "left_journal" if sign < 0 else "right_journal", "op": "union", "shape": "cylinder", "position": {**ZERO, "x": sign * journal_center},
           "rotation": axial, "diameter": 10, "height": 14} for sign in (-1, 1)]]}
    spec = CadAssemblySpec.model_validate({"schemaVersion": "4.0", "units": "mm", "partId": "journal_intervals", "components": [support(-1), support(1), shaft]})
    solids = _check_interference(spec, _engine())
    for index, name in enumerate(("left", "right")):
        joint = CadMechanicalConnection.model_validate({"id": name + "_bearing", "kind": "rotary", "first": "shaft", "second": name,
            "firstFeature": name + "_journal", "secondFeature": "bore", "maxClearance": .2, "minEngagement": 12, "fastening": "none", "fastenerDiameter": 0})
        if journal_center == 105:
            with pytest.raises(ValueError, match="insufficient engagement: 11.000"):
                _fit(joint, spec.components[2], spec.components[index], solids[2], solids[index], MaterialChecks())
        else:
            _fit(joint, spec.components[2], spec.components[index], solids[2], solids[index], MaterialChecks())


@pytest.mark.parametrize("profile,handedness,starts,rotation", [
    ("metric", "right", 1, ZERO), ("metric", "left", 2, {**ZERO, "x": 90}),
    ("trapezoidal", "right", 3, {**ZERO, "y": 90}), ("trapezoidal", "left", 4, {"x": 25, "y": 35, "z": 15}),
])
def test_thread_evidence_uses_real_helix_on_transformed_axes(profile, handedness, starts, rotation):
    from domain.cad_assembly import CadMechanicalConnection

    from api.cad_assembly_adapter import build_assembly_solids
    from api.cad_mechanics import MaterialChecks, _fit

    thread = {"id": "thread", "shape": "thread", "position": ZERO, "rotation": rotation, "diameter": 8,
              "pitch": 1, "height": 6, "profile": profile, "handedness": handedness, "starts": starts, "clearance": 0}
    components = [{"id": "male", "position": {"x": 14, "y": -7, "z": 22}, "steps": [{**thread, "op": "base"}]},
                  {"id": "female", "position": {"x": 14, "y": -7, "z": 22}, "steps": [
                      {"id": "body", "op": "base", "shape": "cylinder", "position": ZERO, "rotation": rotation, "diameter": 16, "height": 6},
                      {**thread, "op": "cut", "height": 8, "clearance": .1}]}]
    connection = {"id": "thread_fit", "kind": "thread", "first": "male", "second": "female", "firstFeature": "thread", "secondFeature": "thread",
                  "maxClearance": .3, "minEngagement": 4, "fastening": "none", "fastenerDiameter": 0}
    spec = CadAssemblySpec.model_validate({"schemaVersion": "4.0", "units": "mm", "partId": "thread_evidence", "components": components})
    solids = build_assembly_solids(spec)
    _fit(CadMechanicalConnection.model_validate(connection), spec.components[0], spec.components[1], *solids, MaterialChecks())
    if profile == "metric" and starts == 1:
        damaged = copy.deepcopy(components)
        root = 8 - 2 * .613434654
        damaged[0]["steps"].append({"id": "erase_crest", "op": "cut", "shape": "tube", "position": ZERO, "rotation": rotation,
                                    "diameter": 8.2, "innerDiameter": root - .02, "height": 8})
        broken = spec.model_copy(update={"components": CadAssemblySpec.model_validate({"schemaVersion": "4.0", "units": "mm", "partId": "damaged", "components": damaged}).components})
        with pytest.raises(ValueError, match="male thread crest/valley"):
            _fit(CadMechanicalConnection.model_validate(connection), *broken.components, *build_assembly_solids(broken), MaterialChecks())


        damaged = copy.deepcopy(components)
        damaged[1]["steps"].append({"id": "erase_internal_crest", "op": "cut", "shape": "cylinder", "position": ZERO, "rotation": rotation, "diameter": 8.2, "height": 8})
        broken = CadAssemblySpec.model_validate({"schemaVersion": "4.0", "units": "mm", "partId": "damaged", "components": damaged})
        with pytest.raises(ValueError, match="female thread has no exposed"):
            _fit(CadMechanicalConnection.model_validate(connection), *broken.components, *build_assembly_solids(broken), MaterialChecks())


@pytest.mark.parametrize("length", [208, 216])
def test_reported_guide_length_is_adjusted_without_changing_validated_supports(length):
    from domain.cad_assembly import CadMechanicalConnection

    from api.cad_mechanics import MaterialChecks, _fit

    axial = {**ZERO, "y": 90}
    supports = [{"id": "left" if sign < 0 else "right", "position": {"x": sign * 102, "y": 0, "z": 30}, "steps": [
        {"id": "body", "op": "base", "shape": "box", "position": ZERO, "rotation": ZERO, "width": 12, "depth": 20, "height": 20},
        {"id": "bore", "op": "cut", "shape": "hole", "position": {**ZERO, "x": 6}, "rotation": axial,
         "diameter": 8.4, "height": 12, "holeType": "plain", "headDiameter": 0, "headDepth": 0}]} for sign in (-1, 1)]
    guide = {"id": "guide", "position": {**ZERO, "z": 30}, "steps": [
        {"id": "shaft", "op": "base", "shape": "cylinder", "position": ZERO, "rotation": axial, "diameter": 8, "height": length}]}
    spec = CadAssemblySpec.model_validate({"schemaVersion": "4.0", "units": "mm", "partId": "guide_engagement", "components": [*supports, guide]})
    solids = _check_interference(spec, _engine())
    for index, support in enumerate(spec.components[:2]):
        joint = CadMechanicalConnection.model_validate({"id": support.id + "_fix", "kind": "fixed", "first": "guide", "second": support.id,
            "firstFeature": "shaft", "secondFeature": "bore", "maxClearance": .3, "minEngagement": 12, "fastening": "bonded", "fastenerDiameter": 0})
        if length == 208:
            with pytest.raises(ValueError, match="insufficient engagement: 8.000"):
                _fit(joint, spec.components[2], support, solids[2], solids[index], MaterialChecks())
        else:
            _fit(joint, spec.components[2], support, solids[2], solids[index], MaterialChecks())


def test_carriage_cavity_keeps_its_axis_with_more_height_and_mounts_outside_the_cavity():
    from domain.cad_program import CadProgramSpec

    from api.cad_program_adapter import build_program_solid, build_program_step

    spec = CadProgramSpec.model_validate({"schemaVersion": "3.0", "units": "mm", "partId": "carriage_decision", "steps": [
        {"id": "body", "op": "base", "shape": "box", "position": ZERO, "rotation": ZERO, "width": 50, "depth": 80, "height": 50},
        {"id": "cavity", "op": "cut", "shape": "hole", "position": {"x": 25, "y": 0, "z": -10}, "rotation": {**ZERO, "y": 90},
         "diameter": 22.4, "height": 52, "holeType": "plain", "headDiameter": 0, "headDepth": 0},
        {"id": "mount", "op": "cut", "shape": "hole", "position": {"x": 25, "y": -18, "z": -10}, "rotation": {**ZERO, "y": 90},
         "diameter": 5.5, "height": 52, "holeType": "plain", "headDiameter": 0, "headDepth": 0,
         "pattern": {"kind": "linear", "count": 2, "offset": {**ZERO, "y": 36}}}]})
    solid = build_program_solid(spec).val()
    assert solid.isInside((0, 0, -24))
    assert not solid.isInside((0, 0, -10))
    for sign in (-1, 1):
        assert not solid.isInside((0, sign * 18, -10))
        assert solid.isInside((0, sign * 14, -10))
    assert build_program_step(spec, 1_000_000).solid_count == 1
