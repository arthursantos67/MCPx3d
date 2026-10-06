from __future__ import annotations

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


@pytest.mark.parametrize(("axis", "moving"), [("x", False), ("y", False), ("z", False), ("inclined", False), ("x", True)])
@pytest.mark.parametrize("offset", [0, 17])
def test_agent_aligns_cylindrical_fits_on_all_axes_with_local_offsets(axis, moving, offset, tmp_path) -> None:
    def vector(x, y, z):
        values = (x * math.cos(math.pi / 6) - y * math.sin(math.pi / 6),
                  x * math.sin(math.pi / 6) + y * math.cos(math.pi / 6), z) if axis == "inclined" else {
                      "x": (x, y, z), "y": (y, x, z), "z": (y, z, x)}[axis]
        return dict(zip(("x", "y", "z"), values, strict=True))

    rotation = {"x": 0, "y": 90 if axis in ("x", "inclined") else 0, "z": 30 if axis == "inclined" else 0}
    if axis == "y":
        rotation["x"] = -90
    zero = vector(0, 0, 0)
    dimensions = dict(zip(("x", "y", "z"), (20, 90, 50), strict=True)) if axis == "inclined" else vector(20, 90, 50)
    raw = {"schemaVersion": "4.0", "units": "mm", "partId": "renamed_mechanism", "components": [
        {"id": "receiver", "position": vector(-110 - offset, -offset, 25 - offset), "steps": [
            {"id": "body", "op": "base", "shape": "box", "width": dimensions["x"], "depth": dimensions["y"],
             "height": dimensions["z"], "position": vector(offset, offset, offset),
             "rotation": {**zero, "z": 30} if axis == "inclined" else zero},
            {"id": "blind_bore", "op": "cut", "shape": "cylinder", "diameter": 6, "height": 8,
             "position": vector(offset, 29 + offset, 20 + offset), "rotation": rotation},
        ]},
        {"id": "rod", "position": vector(-offset, 30 - offset, 45 - offset), "steps": [
            {"id": "shaft", "op": "base", "shape": "cylinder", "diameter": 8, "height": 220,
             "position": vector(offset, offset, offset), "rotation": rotation},
        ]},
    ]}
    if moving:
        raw["components"][0]["motion"] = {"kind": "slider", "axis": axis, "minimum": -2, "maximum": 2,
                                         "value": 1, "group": "slide", "factor": -2}
    if axis == "x" and offset == 0:
        raw["components"][1]["steps"].extend([
            {"id": f"tip_{index}", "op": "union", "shape": "cone", "bottomDiameter": 8,
             "topDiameter": 7, "height": 0.5, "position": vector(x, 0, 0),
             "rotation": {**rotation, "y": sign * 90}}
            for index, (x, sign) in enumerate([(-110.15, -1), (110.15, 1)])])
    original = copy.deepcopy(raw)
    with pytest.raises(CadAssemblyInterferenceError) as failed:
        _check_interference(CadAssemblySpec.model_validate(raw), cq)
    collision = failed.value.diagnostics.collisions[0].model_dump(mode="json")
    root = Path(__file__).resolve().parents[3]
    proposed = subprocess.run(["node", str(root / "tests/fixtures/propose-cylindrical-fit.mjs")],
                              input=json.dumps({"spec": raw, "collision": collision}), text=True,
                              capture_output=True, check=True, timeout=15)
    repaired = json.loads(proposed.stdout)
    assert repaired is not None
    assert repaired["components"][1] == original["components"][1]
    assert repaired["components"][0]["position"] == original["components"][0]["position"]
    assert repaired["components"][0]["steps"][0] == original["components"][0]["steps"][0]
    artifact = build_assembly_step(CadAssemblySpec.model_validate(repaired), 10_000_000)
    path = tmp_path / "fit.step"
    path.write_bytes(artifact.step)
    restored = cq.importers.importStep(str(path)).solids().vals()
    assert len(restored) == 2
    assert all(solid.isValid() and solid.Volume() > 0 for solid in restored)


def test_multiple_supports_and_guides_keep_each_verified_fit(tmp_path) -> None:
    zero = {"x": 0, "y": 0, "z": 0}
    raw = {"schemaVersion": "4.0", "units": "mm", "partId": "four_fits", "components": [
        *[{"id": f"support_{index}", "position": {**zero, "x": x, "z": 25}, "steps": [
            {"id": "body", "op": "base", "shape": "box", "width": 20, "depth": 90, "height": 50,
             "position": zero, "rotation": zero},
        ]} for index, x in enumerate((-110, 110))],
        *[{"id": f"rod_{index}", "position": {**zero, "y": y, "z": 45}, "steps": [
            {"id": "shaft", "op": "base", "shape": "cylinder", "diameter": 8, "height": 220,
             "position": zero, "rotation": {**zero, "y": 90}},
        ]} for index, y in enumerate((-30, 30))],
    ]}
    root = Path(__file__).resolve().parents[3]
    previous_collisions = None
    for _ in range(4):
        with pytest.raises(CadAssemblyInterferenceError) as failed:
            _check_interference(CadAssemblySpec.model_validate(raw), cq)
        collisions = failed.value.diagnostics.collisions
        if previous_collisions is not None:
            assert len(collisions) < previous_collisions
        previous_collisions = len(collisions)
        result = subprocess.run(["node", str(root / "tests/fixtures/propose-cylindrical-fit.mjs")],
                                input=json.dumps({"spec": raw, "collision": collisions[0].model_dump(mode="json")}),
                                text=True, capture_output=True, check=True, timeout=15)
        candidate = json.loads(result.stdout)
        assert candidate is not None
        assert candidate["components"][2:] == raw["components"][2:]
        raw = candidate
    artifact = build_assembly_step(CadAssemblySpec.model_validate(raw), 10_000_000)
    assert artifact.solid_count == 4
    assert [len(component["steps"]) for component in raw["components"]] == [3, 3, 1, 1]
    path = tmp_path / "stage.step"
    path.write_bytes(artifact.step)
    assert len(cq.importers.importStep(str(path)).solids().vals()) == 4
