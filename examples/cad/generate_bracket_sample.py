"""Generate the versioned L-bracket STEP fixture with the same CAD adapter as the API."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/api/src"))
sys.path.insert(0, str(ROOT / "packages/domain/python/src"))

from api.cad_adapter import build_step  # noqa: E402
from domain.cad_part import CadPartSpec  # noqa: E402

spec_path = ROOT / "packages/domain/fixtures/cad-part/valid-l-bracket.json"
spec = CadPartSpec.model_validate(json.loads(spec_path.read_text(encoding="utf-8")))
artifact = build_step(spec, max_bytes=10_000_000)
target = Path(__file__).with_name("mounting_bracket.step")
target.write_bytes(artifact.step)
print(f"{target}: {artifact.bounds_mm} mm, {artifact.volume_mm3:.4f} mm³, {len(artifact.step)} bytes")
