"""Reopen native FreeCAD examples and verify their bodies can be repositioned."""

from pathlib import Path

import FreeCAD as App

directory = Path(__file__).parent
for stem, name in [("rounded_plate", "RoundedPlate"), ("round_flange", "RoundFlange")]:
    document = App.openDocument(str(directory / f"{stem}.FCStd"))
    body = document.getObject(name)
    assert body is not None and body.Shape.isValid() and len(body.Shape.Solids) == 1
    initial_x = body.Shape.BoundBox.XMin
    body.Placement.Base = App.Vector(15, 0, 0)
    document.recompute()
    assert abs(body.Shape.BoundBox.XMin - initial_x - 15) < 1e-4
    print(f"FreeCAD checked {stem}.FCStd: valid movable body")
    App.closeDocument(document.Name)
