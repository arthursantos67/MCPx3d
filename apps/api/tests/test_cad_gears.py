import math

import cadquery as cq
import pytest
from domain.cad_program import CadProgramSpec

from api.cad_gears import gear_dimensions, involute_point
from api.cad_program_adapter import build_program_solid, build_program_step

ZERO = {"x": 0, "y": 0, "z": 0}


def program(shape, **dimensions):
    return CadProgramSpec.model_validate({"schemaVersion": "3.0", "units": "mm", "partId": shape,
        "steps": [{"id": "body", "op": "base", "shape": shape, "position": ZERO, "rotation": ZERO, **dimensions}]})


@pytest.mark.parametrize("module,teeth,pressure,backlash", [(1, 18, 20, 0), (.1, 24, 30, .02), (20, 128, 20, 4)])
def test_involute_teeth_have_correct_pitch_thickness_root_and_tip(module, teeth, pressure, backlash):
    spec = program("spur_gear", module=module, teeth=teeth, pressureAngle=pressure, backlash=backlash, height=6)
    step = spec.steps[0]
    solid = build_program_solid(spec).val()
    pitch, base, tip, root = gear_dimensions(step)
    assert solid.isValid()
    assert solid.BoundingBox().zlen == pytest.approx(6)
    assert solid.BoundingBox().xlen == pytest.approx(2 * tip, abs=1e-4)
    half_thickness = math.pi / (2 * teeth) - backlash / (2 * pitch)

    def polar(radius, angle):
        return (radius * math.cos(angle), radius * math.sin(angle), 0)

    assert solid.isInside(polar(pitch, half_thickness * .95))
    assert not solid.isInside(polar(pitch, half_thickness * 1.05))
    assert solid.isInside(polar(root * .99, math.pi / teeth))
    assert not solid.isInside(polar(pitch, math.pi / teeth))
    assert solid.isInside(polar(tip - module * .05, 0))
    assert not solid.isInside(polar(tip + module * .05, 0))
    start = math.sqrt(max(0, (max(base, root) / base) ** 2 - 1))
    end = math.sqrt((tip / base) ** 2 - 1)
    spline_edges = [edge for edge in solid.Edges() if edge.geomType() == "BSPLINE"]
    for fraction in (.05, .21, .48, .76, .95):
        x, y, _ = involute_point(step, start + (end - start) * fraction, 1)
        witness = cq.Vertex.makeVertex(x, y, -3)
        assert min(edge.distance(witness) for edge in spline_edges) < 2e-5


def test_gear_bore_and_step_keep_actual_teeth(tmp_path):
    spec = program("spur_gear", module=2, teeth=24, pressureAngle=20, backlash=.1, height=8)
    raw = spec.model_dump(exclude_none=True)
    raw["steps"].append({"id": "shaft_bore", "op": "cut", "shape": "cylinder", "diameter": 8, "height": 10, "position": ZERO, "rotation": ZERO})
    artifact = build_program_step(CadProgramSpec.model_validate(raw), 5_000_000)
    path = tmp_path / "gear.step"
    path.write_bytes(artifact.step)
    solid = cq.importers.importStep(str(path)).val()
    assert not solid.isInside((0, 0, 0))
    assert solid.isInside((25.5, 0, 0))
    assert not solid.isInside((24 * math.cos(math.pi / 24), 24 * math.sin(math.pi / 24), 0))


def test_rack_pitch_flank_and_backing_dimensions_roundtrip():
    spec = program("rack", module=2, teeth=6, pressureAngle=20, backlash=.1, baseThickness=4, height=8)
    solid = build_program_solid(spec).val()
    pitch = 2 * math.pi
    assert solid.BoundingBox().xlen == pytest.approx(6 * pitch)
    assert solid.BoundingBox().ymin == pytest.approx(-6.5)
    assert solid.BoundingBox().ymax == pytest.approx(2)
    center = -3 * pitch + pitch / 2
    half_pitch_tooth = pitch / 4 - .1 / 2
    assert solid.isInside((center + half_pitch_tooth - .02, 0, 0))
    assert not solid.isInside((center + half_pitch_tooth + .02, 0, 0))
    assert solid.isInside((0, -5, 0))
    assert not solid.isInside((0, 1, 0))
    assert build_program_step(spec, 1_000_000).solid_count == 1


def test_hex_prism_across_flats_is_geometric_and_supports_a_socket_cut():
    spec = program("regular_prism", sides=6, acrossFlats=13, height=6)
    solid = build_program_solid(spec).val()
    assert solid.BoundingBox().ylen == pytest.approx(13)
    assert solid.Volume() == pytest.approx(6 * 13 ** 2 * math.tan(math.pi / 6) / 4 * 6)
    assert build_program_step(spec, 1_000_000).solid_count == 1
    socket = CadProgramSpec.model_validate({"schemaVersion": "3.0", "units": "mm", "partId": "hex_socket", "steps": [
        {"id": "stock", "op": "base", "shape": "cylinder", "diameter": 20, "height": 10, "position": ZERO, "rotation": ZERO},
        {"id": "socket", "op": "cut", "shape": "regular_prism", "sides": 6, "acrossFlats": 13, "height": 8,
         "position": {**ZERO, "z": 3}, "rotation": ZERO}]})
    socket_solid = build_program_solid(socket).val()
    assert not socket_solid.isInside((0, 0, 4))
    assert socket_solid.isInside((0, 0, -4))
    assert socket_solid.isInside((8, 0, 4))
