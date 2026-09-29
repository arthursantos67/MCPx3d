from pathlib import Path

import FreeCAD as App
import Part

directory = Path(__file__).parent
shape = Part.read(str(directory / "mounting_plate.step"))
assert shape.isValid() and len(shape.Solids) == 1

document = App.newDocument("MountingPlate")
body = document.addObject("PartDesign::Body", "MountingPlate")
body.Label = "Placa de fixação"
feature = body.newObject("PartDesign::Feature", "ValidatedSolid")
feature.Label = "Sólido importado do STEP validado"
feature.Shape = shape
document.recompute()
assert body.Shape.isValid() and len(body.Shape.Solids) == 1
document.saveAs(str(directory / "mounting_plate.FCStd"))
print(f"FreeCAD document saved: {directory / 'mounting_plate.FCStd'}")
