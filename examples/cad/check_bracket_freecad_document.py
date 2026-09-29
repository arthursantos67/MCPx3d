import math
from pathlib import Path

import FreeCAD as App

path = Path(__file__).with_name("mounting_bracket.FCStd")
document = App.openDocument(str(path))
body = document.getObject("MountingBracket")
assert body is not None and body.Shape.isValid() and len(body.Shape.Solids) == 1
assert math.isclose(body.Shape.BoundBox.ZLength, 70, abs_tol=1e-4)
initial_x = body.Shape.BoundBox.XMin
body.Placement.Base = App.Vector(15, 0, 0)
document.recompute()
assert math.isclose(body.Shape.BoundBox.XMin, initial_x + 15, abs_tol=1e-4)
print("FreeCAD bracket document check passed: 3D solid and movable body")
App.closeDocument(document.Name)
