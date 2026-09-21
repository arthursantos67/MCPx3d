import math

import pytest
from domain.model_spec import Material, ModelObject, ModelSpec, Scene, Transform

from api.mcp_client import X3DMcpClient
from api.x3d_adapter import apply_model_spec, euler_xyz_to_axis_angle

pytestmark = pytest.mark.anyio


def _obj(
    object_id: str,
    kind: str,
    dimensions: dict[str, float],
    *,
    position: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
    color: str = "#ff0000",
    transparency: float | None = None,
) -> ModelObject:
    return ModelObject(
        id=object_id,
        name=object_id,
        kind=kind,  # type: ignore[arg-type]
        dimensions=dimensions,
        transform=Transform(position=position, rotation=rotation, scale=scale),
        material=Material(color=color, transparency=transparency),
    )


def _spec(*objects: ModelObject, display_scale: float = 1.0) -> ModelSpec:
    return ModelSpec(
        schemaVersion="1.0",
        projectId="prj_test",
        revision=0,
        units="mm",
        scene=Scene(displayScale=display_scale),
        objects=list(objects),
    )


class TestEulerToAxisAngle:
    def test_zero_rotation_is_the_default_axis_angle(self) -> None:
        assert euler_xyz_to_axis_angle((0.0, 0.0, 0.0)) == (0.0, 0.0, 1.0, 0.0)

    def test_pure_x_rotation(self) -> None:
        axis_angle = euler_xyz_to_axis_angle((math.pi / 2, 0.0, 0.0))
        assert axis_angle[:3] == pytest.approx((1.0, 0.0, 0.0), abs=1e-9)
        assert axis_angle[3] == pytest.approx(math.pi / 2)

    def test_pure_y_rotation(self) -> None:
        axis_angle = euler_xyz_to_axis_angle((0.0, math.pi / 2, 0.0))
        assert axis_angle[:3] == pytest.approx((0.0, 1.0, 0.0), abs=1e-9)
        assert axis_angle[3] == pytest.approx(math.pi / 2)

    def test_pure_z_rotation(self) -> None:
        axis_angle = euler_xyz_to_axis_angle((0.0, 0.0, math.pi / 2))
        assert axis_angle[:3] == pytest.approx((0.0, 0.0, 1.0), abs=1e-9)
        assert axis_angle[3] == pytest.approx(math.pi / 2)

    def test_axis_is_always_unit_length(self) -> None:
        axis_angle = euler_xyz_to_axis_angle((0.4, 0.9, 1.3))
        axis_length = math.sqrt(sum(component**2 for component in axis_angle[:3]))
        assert axis_length == pytest.approx(1.0)

    def test_full_turn_about_x_returns_to_default(self) -> None:
        axis_angle = euler_xyz_to_axis_angle((2 * math.pi, 0.0, 0.0))
        assert axis_angle == (0.0, 0.0, 1.0, 0.0)


async def test_each_primitive_kind_generates_valid_x3d(x3d_mcp_server: str) -> None:
    spec = _spec(
        _obj("box1", "box", {"width": 10.0, "height": 20.0, "depth": 30.0}),
        _obj("sphere1", "sphere", {"radius": 5.0}),
        _obj("cylinder1", "cylinder", {"radius": 5.0, "height": 15.0}),
        _obj("cone1", "cone", {"bottomRadius": 5.0, "height": 15.0}),
    )

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        def_names = await apply_model_spec(client, spec)

        assert def_names == {
            "box1": "obj_box1",
            "sphere1": "obj_sphere1",
            "cylinder1": "obj_cylinder1",
            "cone1": "obj_cone1",
        }

        scene_xml = await client.get_scene()
        for def_name in def_names.values():
            assert def_name in scene_xml
        assert "<Box" in scene_xml
        assert "<Sphere" in scene_xml
        assert "<Cylinder" in scene_xml
        assert "<Cone" in scene_xml

        validation = await client.validate_current_scene()
        assert '"valid": true' in validation
        assert "Found 0 error(s)" in validation


async def test_multiple_primitives_appear_in_one_scene(x3d_mcp_server: str) -> None:
    spec = _spec(
        _obj("a", "box", {"width": 1.0, "height": 1.0, "depth": 1.0}),
        _obj("b", "sphere", {"radius": 1.0}),
        _obj("c", "cylinder", {"radius": 1.0, "height": 1.0}),
    )

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await apply_model_spec(client, spec)
        scene_xml = await client.get_scene()

    assert scene_xml.count("<Transform") == 3


async def test_box_dimensions_map_to_size_and_are_display_scaled(
    x3d_mcp_server: str,
) -> None:
    spec = _spec(
        _obj("box1", "box", {"width": 10.0, "height": 20.0, "depth": 30.0}),
        display_scale=0.1,
    )

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await apply_model_spec(client, spec)
        scene_xml = await client.get_scene()

    assert "size='1.0 2.0 3.0'" in scene_xml


async def test_position_is_display_scaled(x3d_mcp_server: str) -> None:
    spec = _spec(
        _obj(
            "box1",
            "box",
            {"width": 1.0, "height": 1.0, "depth": 1.0},
            position=(10.0, 20.0, 30.0),
        ),
        display_scale=0.1,
    )

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await apply_model_spec(client, spec)
        scene_xml = await client.get_scene()

    assert "translation='1.0 2.0 3.0'" in scene_xml


async def test_apply_model_spec_resets_prior_scene_state(x3d_mcp_server: str) -> None:
    first = _spec(_obj("a", "box", {"width": 1.0, "height": 1.0, "depth": 1.0}))
    second = _spec(_obj("b", "sphere", {"radius": 1.0}))

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await apply_model_spec(client, first)
        await apply_model_spec(client, second)
        scene_xml = await client.get_scene()

    assert "obj_a" not in scene_xml
    assert "obj_b" in scene_xml
