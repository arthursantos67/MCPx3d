import json
from pathlib import Path

from api.cad_assembly_adapter import build_assembly_step
from domain.cad_assembly import CadAssemblySpec


def main() -> None:
    directory = Path(__file__).resolve().parent
    spec = CadAssemblySpec.model_validate_json((directory / "functional_linear_stage.json").read_text())
    artifact = build_assembly_step(spec, 10_000_000)
    assert artifact.solid_count == 8
    (directory / "functional_linear_stage.step").write_bytes(artifact.step)
    print(json.dumps({"solids": artifact.solid_count, "volumeMm3": artifact.volume_mm3,
                      "stepBytes": len(artifact.step), "connections": len(spec.mechanics.connections) if spec.mechanics else 0}))


if __name__ == "__main__":
    main()
