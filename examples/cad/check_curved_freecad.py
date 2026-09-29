"""Independently reopen curved STEP samples in FreeCAD and check their topology."""

import math
from pathlib import Path

import Part

for name, bounds, outer_faces, holes in [
    ("rounded_plate.step", (120, 80, 10), 4, 2),
    ("round_flange.step", (100, 100, 12), 1, 3),
]:
    shape = Part.read(str(Path(__file__).with_name(name)))
    assert shape.isValid() and len(shape.Solids) == 1
    actual = (shape.BoundBox.XLength, shape.BoundBox.YLength, shape.BoundBox.ZLength)
    assert all(math.isclose(a, b, abs_tol=1e-4) for a, b in zip(actual, bounds, strict=True))
    cylinders = [face for face in shape.Faces if type(face.Surface).__name__ == "Cylinder"]
    assert len(cylinders) == outer_faces + holes
    assert shape.Volume > 0
    print(f"FreeCAD checked {name}: 1 valid curved solid, {holes} holes, {shape.Volume:.4f} mm3")
