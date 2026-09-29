import math
from pathlib import Path

import Part

shape = Part.read(str(Path(__file__).with_name("mounting_bracket.step")))
expected_volume = 120 * 80 * 8 - 2 * math.pi * 4**2 * 8 + 120 * 8 * (70 - 8) - 2 * math.pi * 5**2 * 8
assert shape.isValid() and len(shape.Solids) == 1
assert math.isclose(shape.Volume, expected_volume, rel_tol=1e-6)
assert math.isclose(shape.BoundBox.XLength, 120, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.YLength, 80, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.ZLength, 70, abs_tol=1e-4)
cylinders = [face for face in shape.Faces if type(face.Surface).__name__ == "Cylinder"]
assert len(cylinders) == 4
assert sorted(round(face.Surface.Radius) for face in cylinders) == [4, 4, 5, 5]
print(f"FreeCAD bracket STEP check passed: 1 solid, 4 holes, {shape.Volume:.4f} mm3")
