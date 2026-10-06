from pathlib import Path

from domain.cad_assembly import CadAssemblySpec
from domain.cad_program import CadProgramSpec

from api.cad_assembly_adapter import build_assembly_mesh, build_assembly_step
from api.cad_program_adapter import build_program_mesh, build_program_step
from api.cad_stl import stl_from_saved_step

directory = Path(__file__).resolve().parent
for name, model, build_step, build_mesh in [
    ("mechanical_mount", CadProgramSpec, build_program_step, build_program_mesh),
    ("threaded_drive", CadAssemblySpec, build_assembly_step, build_assembly_mesh),
]:
    spec = model.model_validate_json((directory / f"{name}.json").read_text(encoding="utf-8"))
    artifact = build_step(spec, 20_000_000)
    mesh = build_mesh(spec)
    stl = stl_from_saved_step(artifact.step, 20_000_000)
    (directory / f"{name}.step").write_bytes(artifact.step)
    (directory / f"{name}.stl").write_bytes(stl)
    print({"partId": name, "solids": artifact.solid_count, "boundsMm": artifact.bounds_mm,
           "volumeMm3": artifact.volume_mm3, "stepBytes": len(artifact.step),
           "previewTriangles": len(mesh["triangles"]), "stlTriangles": int.from_bytes(stl[80:84], "little")}, flush=True)
