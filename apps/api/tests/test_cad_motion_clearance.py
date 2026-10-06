from __future__ import annotations

import copy
import json
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

ZERO = {"x": 0, "y": 0, "z": 0}


@pytest.mark.parametrize(("axis", "factor", "kind"), [("x", -120, "rotary"), ("y", 120, "rotary"),
                                                       ("z", -120, "rotary"), ("x", -1, "screw")])
def test_motion_clearance_preserves_threaded_drive_and_entire_travel(axis, factor, kind, tmp_path):
    def vector(x, y, z):
        return dict(zip(("x", "y", "z"), {"x": (x, y, z), "y": (y, x, z), "z": (y, z, x)}[axis], strict=True))

    rotation = {**ZERO, **{"x": {"y": 90}, "y": {"x": -90}, "z": {}}[axis]}
    dimensions = vector(240, 100, 12)
    raw = {"schemaVersion": "4.0", "units": "mm", "partId": "rotating_drive", "components": [
        {"id": "stationary", "position": vector(0, 0, 6), "steps": [
            {"id": "plate", "op": "base", "shape": "box", "width": dimensions["x"], "depth": dimensions["y"],
             "height": dimensions["z"], "position": ZERO, "rotation": ZERO},
            {"id": "mount", "op": "cut", "shape": "cylinder", "diameter": 6, "height": 14,
             "position": vector(0, 32, 0), "rotation": {"x": {**ZERO}, "y": {**ZERO}, "z": {**ZERO, "x": -90}}[axis]},
        ]},
        {"id": "threaded_body", "position": vector(0, 0, 30), "motion": {
            "kind": kind, "axis": axis, "minimum": -1 if kind == "screw" else -35,
            "maximum": 1 if kind == "screw" else 35, "value": 0, "group": "drive", "factor": factor,
            **({"pitch": 3} if kind == "screw" else {})}, "steps": [
            {"id": "wheel", "op": "base", "shape": "cylinder", "diameter": 44, "height": 8,
             "position": vector(-116, 0, 0), "rotation": rotation},
            {"id": "journal", "op": "union", "shape": "cylinder", "diameter": 8.5, "height": 240,
             "position": ZERO, "rotation": rotation},
            {"id": "helix", "op": "union", "shape": "thread", "diameter": 12, "height": 18,
             "pitch": 3, "profile": "trapezoidal", "handedness": "right", "clearance": 0,
             "position": ZERO, "rotation": rotation},
            {"id": "flat", "op": "cut", "shape": "box", "width": vector(16, 26, 6)["x"],
             "depth": vector(16, 26, 6)["y"], "height": vector(16, 26, 6)["z"],
             "position": vector(-116, 0, -20), "rotation": ZERO},
        ]},
    ]}
    original = copy.deepcopy(raw)
    with pytest.raises(CadAssemblyInterferenceError) as failed:
        _check_interference(CadAssemblySpec.model_validate(raw), cq)
    assert all(item.pose != "current" for item in failed.value.diagnostics.collisions)
    collision = failed.value.diagnostics.collisions[0].model_dump(mode="json")
    root = Path(__file__).resolve().parents[3]
    result = subprocess.run(["node", str(root / "tests/fixtures/propose-motion-clearance.mjs")],
                            input=json.dumps({"spec": raw, "collision": collision}), text=True,
                            capture_output=True, check=True, timeout=15)
    candidate = json.loads(result.stdout)
    assert candidate is not None
    assert candidate["components"][1] == original["components"][1]
    assert candidate["components"][0]["position"] == original["components"][0]["position"]
    assert candidate["components"][0]["steps"][:-1] == original["components"][0]["steps"]
    artifact = build_assembly_step(CadAssemblySpec.model_validate(candidate), 10_000_000)
    path = tmp_path / "clearance.step"
    path.write_bytes(artifact.step)
    restored = cq.importers.importStep(str(path)).solids().vals()
    assert len(restored) == 2
    assert all(solid.isValid() and solid.Volume() > 0 for solid in restored)
    for command in [-0.83, -0.33, 0.11, 0.67]:
        candidate["components"][1]["motion"]["value"] = command
        assert len(_check_interference(CadAssemblySpec.model_validate(candidate), cq)) == 2
