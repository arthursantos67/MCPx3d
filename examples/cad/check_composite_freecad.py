"""Independently reopen the composite STEP in FreeCAD and check boss and bore."""

import math
from pathlib import Path

import Part

shape = Part.read(str(Path(__file__).with_name("composite_mount.step")))
assert shape.isValid() and len(shape.Solids) == 1
assert math.isclose(shape.BoundBox.XLength, 120, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.YLength, 80, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.ZLength, 30, abs_tol=1e-4)
cylinders = [face for face in shape.Faces if type(face.Surface).__name__ == "Cylinder"]
assert len(cylinders) == 10
boss = [face for face in cylinders if math.isclose(face.Surface.Radius, 20, abs_tol=1e-4)]
bore = [face for face in cylinders if math.isclose(face.Surface.Radius, 5, abs_tol=1e-4)]
assert len(boss) == len(bore) == 1
assert math.isclose(boss[0].Area, math.pi * 40 * 20, rel_tol=1e-6)
assert math.isclose(bore[0].Area, math.pi * 10 * 30, rel_tol=1e-6)
print(f"FreeCAD composite STEP check passed: 1 fused solid, boss and full-depth bore, {shape.Volume:.4f} mm3")
