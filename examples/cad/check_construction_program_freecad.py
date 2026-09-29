import math
from pathlib import Path

import Part

shape = Part.read(str(Path(__file__).with_name("construction_program.step")))
assert shape.isValid()
assert len(shape.Solids) == 1
assert math.isclose(shape.BoundBox.XLength, 60, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.YLength, 40, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.ZLength, 18, abs_tol=1e-4)
assert shape.Volume > 0
print(f"FreeCAD construction program check passed: {shape.Volume:.4f} mm3")
