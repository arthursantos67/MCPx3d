"""Save independently imported curved STEP solids as openable FreeCAD documents."""

from pathlib import Path

import FreeCAD as App
import Part

directory = Path(__file__).parent
for stem, name, label in [
    ("rounded_plate", "RoundedPlate", "Placa com cantos arredondados"),
    ("round_flange", "RoundFlange", "Flange circular"),
]:
    shape = Part.read(str(directory / f"{stem}.step"))
    assert shape.isValid() and len(shape.Solids) == 1
    document = App.newDocument(name)
    body = document.addObject("PartDesign::Body", name)
    body.Label = label
    feature = body.newObject("PartDesign::Feature", "ValidatedSolid")
    feature.Label = "Solid imported from validated STEP"
    feature.Shape = shape
    document.recompute()
    assert body.Shape.isValid() and len(body.Shape.Solids) == 1
    document.saveAs(str(directory / f"{stem}.FCStd"))
    print(f"Saved {stem}.FCStd")
    App.closeDocument(document.Name)
