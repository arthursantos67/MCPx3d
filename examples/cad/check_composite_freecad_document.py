"""Reopen the native composite document and verify its body can move."""

from pathlib import Path

import FreeCAD as App

document = App.openDocument(str(Path(__file__).with_name("composite_mount.FCStd")))
body = document.getObject("CompositeMount")
assert body is not None and body.Shape.isValid() and len(body.Shape.Solids) == 1
initial_x = body.Shape.BoundBox.XMin
body.Placement.Base = App.Vector(15, 0, 0)
document.recompute()
assert abs(body.Shape.BoundBox.XMin - initial_x - 15) < 1e-4
print("FreeCAD composite document check passed: valid movable body")
App.closeDocument(document.Name)
