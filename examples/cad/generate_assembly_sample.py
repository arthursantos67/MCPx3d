from pathlib import Path

from domain.cad_assembly import CadAssemblySpec

from api.cad_assembly_adapter import build_assembly_step
from api.cad_stl import stl_from_saved_step

directory = Path(__file__).resolve().parent
spec = CadAssemblySpec.model_validate_json((directory / "manual_press.json").read_text(encoding="utf-8"))
artifact = build_assembly_step(spec, 10_000_000)
stl = stl_from_saved_step(artifact.step, 10_000_000)
(directory / "manual_press.step").write_bytes(artifact.step)
(directory / "manual_press.stl").write_bytes(stl)
print({"solids": artifact.solid_count, "boundsMm": artifact.bounds_mm,
       "volumeMm3": artifact.volume_mm3, "stepBytes": len(artifact.step),
       "stlTriangles": int.from_bytes(stl[80:84], "little")})
