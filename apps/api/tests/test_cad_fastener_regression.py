import json
from pathlib import Path

from domain.cad_assembly import CadAssemblySpec

from api.cad_assembly_adapter import _check_interference, export_assembly_solids
from api.cad_mechanics import check_mechanics
from api.cad_program_adapter import _engine


def test_saved_provider_candidate_preserves_blind_floor_when_contract_is_reconciled(tmp_path):
    source = Path(__file__).parents[3] / 'tests/fixtures/cad/m4-contract-regression.json'
    original = CadAssemblySpec.model_validate_json(source.read_text(encoding='utf-8'))
    data = json.loads(original.model_dump_json())
    data['mechanics']['connections'][0]['maxClearance'] = .25
    corrected = CadAssemblySpec.model_validate(data)
    assert corrected.components == original.components
    cq = _engine()
    solids = _check_interference(corrected, cq)
    issues = check_mechanics(original, cq, [('current', original.components, solids)])
    assert any('mounting hole clearance' in issue['message'] for issue in issues)
    artifact = export_assembly_solids(solids, [part.id for part in corrected.components], 10_000_000)
    assert artifact.solid_count == 2
    step = tmp_path / 'corrected.step'
    step.write_bytes(artifact.step)
    base = cq.importers.importStep(str(step)).solids().vals()[0]
    for x in (-8, 8):
        assert base.isInside((x, 0, -5), 1e-6)
        assert not base.isInside((x, 0, 5), 1e-6)
