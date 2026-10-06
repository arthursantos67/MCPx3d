"""Run with the API virtualenv to update the shared CAD contracts."""

import json
from pathlib import Path
from typing import Any

from domain.cad_assembly import CadAssemblySpec
from domain.cad_program import CadProgramSpec


def portable_schema(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: portable_schema(child) for key, child in value.items() if key != "discriminator"}
    if isinstance(value, list):
        return [portable_schema(child) for child in value]
    return value


if __name__ == "__main__":
    target = Path(__file__).resolve().parents[1] / "packages" / "domain" / "schemas"
    for model, filename in [(CadProgramSpec, "cad-program.v3.schema.json"), (CadAssemblySpec, "cad-assembly.v4.schema.json")]:
        schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", **portable_schema(model.model_json_schema())}
        (target / filename).write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
