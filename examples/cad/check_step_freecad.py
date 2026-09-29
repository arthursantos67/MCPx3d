import math
from pathlib import Path

import Part

step = Path(__file__).with_name("mounting_plate.step")
shape = Part.read(str(step))
assert shape.isValid()
assert len(shape.Solids) == 1
assert math.isclose(shape.Volume, (120 * 80 - 2 * 4**2 - 4 * math.pi * 4**2) * 10, rel_tol=1e-6)
assert math.isclose(shape.BoundBox.XLength, 120, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.YLength, 80, abs_tol=1e-4)
assert math.isclose(shape.BoundBox.ZLength, 10, abs_tol=1e-4)
cylinders = [face for face in shape.Faces if type(face.Surface).__name__ == "Cylinder"]
assert len(cylinders) == 4
assert {(round(face.Surface.Center.x), round(face.Surface.Center.y)) for face in cylinders} == {
    (-40, -25), (40, -25), (-40, 25), (40, 25),
}
assert all(math.isclose(face.Surface.Radius, 4, abs_tol=1e-4) for face in cylinders)
assert all(math.isclose(face.Area, 2 * math.pi * 4 * 10, abs_tol=1e-4) for face in cylinders)
chamfers = [
    face for face in shape.Faces
    if type(face.Surface).__name__ == "Plane"
    and math.isclose(face.Area, 4 * math.sqrt(2) * 10, abs_tol=1e-4)
    and math.isclose(abs(face.CenterOfMass.x), 58, abs_tol=1e-4)
    and math.isclose(abs(face.CenterOfMass.y), 38, abs_tol=1e-4)
]
assert len(chamfers) == 4
print(f"FreeCAD STEP check passed: {len(shape.Solids)} solid, {len(cylinders)} holes, {len(chamfers)} chamfers, {shape.Volume:.4f} mm3")
