"""Save the independently imported composite STEP as a FreeCAD document."""

from pathlib import Path

import FreeCAD as App
import Part

directory = Path(__file__).parent
shape = Part.read(str(directory / "composite_mount.step"))
assert shape.isValid() and len(shape.Solids) == 1
document = App.newDocument("CompositeMount")
body = document.addObject("PartDesign::Body", "CompositeMount")
body.Label = "Base e ressalto unidos"
feature = body.newObject("PartDesign::Feature", "ValidatedSolid")
feature.Label = "Solid imported from validated STEP"
feature.Shape = shape
document.recompute()
assert body.Shape.isValid() and len(body.Shape.Solids) == 1
document.saveAs(str(directory / "composite_mount.FCStd"))
print("Saved composite_mount.FCStd")
