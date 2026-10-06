import copy
import json
import math
import subprocess
from pathlib import Path

import cadquery as cq
import pytest
from domain.cad_assembly import CadAssemblySpec

from api.cad_assembly_adapter import (
    CadAssemblyInterferenceError,
    _check_interference,
    build_assembly_step,
)


@pytest.mark.parametrize(("axis", "profile", "handedness", "starts"), [
    ("x", "metric", "right", 1), ("y", "metric", "left", 2),
    ("z", "trapezoidal", "right", 2), ("inclined", "trapezoidal", "left", 1)])
def test_thread_fit_preserves_profiles_journals_and_fractional_travel(axis, profile, handedness, starts, tmp_path):
    zero = {"x": 0, "y": 0, "z": 0}
    rotation = {"x": -90 if axis == "y" else 0, "y": 90 if axis == "x" else 0, "z": 0}
    if axis == "inclined":
        rotation = {"x": 17, "y": 38, "z": 29}
    def rotated(point):
        vector = cq.Vector(*point)
        for angle, direction in zip(rotation.values(), [(1, 0, 0), (0, 1, 0), (0, 0, 1)], strict=True):
            vector = cq.Vertex.makeVertex(*vector.toTuple()).rotate((0, 0, 0), direction, angle).Center()
        return vector

    vector = rotated((0, 0, 1))

    def along(value):
        return dict(zip(("x", "y", "z"), (v * value for v in vector.toTuple()), strict=True))

    thread = {"id": "male_thread", "op": "union", "shape": "thread", "diameter": 12, "pitch": 2,
              "height": 16, "profile": profile, "handedness": handedness, "starts": starts, "clearance": 0,
              "position": along(5), "rotation": rotation}
    core = {"id": "journal", "op": "base", "shape": "cylinder", "diameter": 11, "height": 20,
            "position": along(5), "rotation": rotation}
    receiver = {"id": "body", "op": "base", "shape": "cylinder", "diameter": 22, "height": 6,
                "position": along(5), "rotation": rotation}
    raw = {"schemaVersion": "4.0", "units": "mm", "partId": "arbitrary_names", "components": [
        {"id": "external_part", "position": along(-5), "steps": [core, thread]},
        {"id": "internal_part", "position": along(-2), "steps": [receiver,
            {**thread, "id": "female_thread", "op": "cut", "clearance": 0.15, "height": 6, "position": along(8)}]},
        {"id": "reference", "position": {"x": 100, "y": 100, "z": 100}, "steps": [
            {"id": "block", "op": "base", "shape": "box", "width": 5, "depth": 5, "height": 5,
             "position": zero, "rotation": zero}]},
    ]}
    if axis != "inclined":
        common = {"axis": axis, "minimum": -0.7, "maximum": 0.7, "value": 0.25, "group": "drive"}
        raw["components"][0]["motion"] = {**common, "kind": "rotary",
            "factor": (-1 if handedness == "right" else 1) * 360 / (2 * starts)}
        raw["components"][1]["motion"] = {**common, "kind": "slider", "factor": 1}
    original = copy.deepcopy(raw)
    with pytest.raises(CadAssemblyInterferenceError) as failed:
        _check_interference(CadAssemblySpec.model_validate(raw), cq)
    root = Path(__file__).resolve().parents[3]
    proposed = subprocess.run(["node", str(root / "tests/fixtures/propose-threaded-fit.mjs")], text=True,
        input=json.dumps({"spec": raw, "collision": failed.value.diagnostics.collisions[0].model_dump(mode="json")}),
        capture_output=True, check=True, timeout=15)
    fixed = json.loads(proposed.stdout)
    assert fixed is not None
    assert fixed["components"][0]["steps"][0] == core
    assert fixed["components"][0]["steps"][-1] == thread
    assert fixed["components"][0]["steps"][1]["shape"] == "tube"
    assert fixed["components"][0]["steps"][1]["innerDiameter"] == pytest.approx(12 - 4 * (0.613434654 if profile == "metric" else 0.5) - 0.002)
    for before, after in zip(original["components"], fixed["components"], strict=True):
        assert before["position"] == after["position"]
        assert before.get("motion") == after.get("motion")
    artifact = build_assembly_step(CadAssemblySpec.model_validate(fixed), 20_000_000)
    path = tmp_path / "fit.step"
    path.write_bytes(artifact.step)
    restored = cq.importers.importStep(str(path)).solids().vals()
    assert len(restored) == 3 and all(s.isValid() and s.Volume() > 0 for s in restored)
    assert restored[0].intersect(restored[1]).Volume() <= 0.1
    source = restored[0]
    for end in (-9, 9):
        assert source.isInside((vector * end + rotated((5.3, 0, 0))).toTuple())
    radius = (12 - 2 * (0.613434654 if profile == "metric" else 0.5)) / 2
    angle = (-1 if handedness == "left" else 1) * math.pi / (2 * starts)
    for theta, expected in [(angle, True), (angle + math.pi / starts, False)]:
        point = rotated((radius * math.cos(theta), radius * math.sin(theta), 0.5))
        if axis != "inclined":
            turn = raw["components"][0]["motion"]["factor"] * 0.25
            point = cq.Vertex.makeVertex(*point.toTuple()).rotate((0, 0, 0), vector.toTuple(), turn).Center()
        assert source.isInside(point.toTuple()) is expected
    assert math.isfinite(artifact.volume_mm3)
