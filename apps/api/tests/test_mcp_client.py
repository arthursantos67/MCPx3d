import pytest

from api.mcp_client import McpToolError, McpUnavailableError, X3DMcpClient

pytestmark = pytest.mark.anyio


async def test_connect_to_unreachable_host_raises_mcp_unavailable() -> None:
    with pytest.raises(McpUnavailableError):
        async with X3DMcpClient.connect("http://127.0.0.1:1", timeout_seconds=2.0):
            pass


async def test_unknown_node_type_raises_mcp_tool_error(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        with pytest.raises(McpToolError):
            await client._create_node("NotARealNodeType")


async def test_create_box_round_trip(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await client.reset_scene()

        def_name = await client.create_primitive(
            "box",
            {"size": [2.0, 2.0, 2.0]},
            color=(1.0, 0.0, 0.0),
            def_name="TestBox",
        )
        assert def_name == "TestBox"

        scene_xml = await client.get_scene()
        assert "<Box" in scene_xml
        assert "TestBox" in scene_xml

        schema_and_semantic = await client.validate_current_scene()
        assert "Schema" in schema_and_semantic

        semantic_report = await client.validate_semantic(scene_xml)
        assert semantic_report

        html = await client.generate_x3dom_page(scene_xml)
        assert "<html" in html.lower()


async def test_create_primitive_applies_transform_scale(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await client.reset_scene()

        await client.create_primitive(
            "sphere",
            {"radius": 1.0},
            scale=(2.0, 3.0, 4.0),
            def_name="ScaledSphere",
        )

        scene_xml = await client.get_scene()
        assert "scale='2.0 3.0 4.0'" in scene_xml


async def test_reset_scene_clears_prior_primitives(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await client.reset_scene()
        await client.create_primitive("sphere", {"radius": 1.0}, def_name="TempSphere")
        await client.reset_scene()

        scene_xml = await client.get_scene()
        assert "TempSphere" not in scene_xml
