"""Protocol-level regression coverage for the pinned x3d_mcp service (Issues #42 and #64)."""

import time

import pytest
from domain.model_spec import Material, ModelObject, ModelSpec, Scene, Transform

from api.mcp_client import McpUnavailableError, X3DMcpClient
from api.x3d_validation import validate_scene_content

pytestmark = pytest.mark.anyio


def _spec(kind: str, dimensions: dict[str, float]) -> ModelSpec:
    return ModelSpec(
        schemaVersion="1.0",
        projectId="prj_integration",
        revision=0,
        units="mm",
        scene=Scene(displayScale=1.0),
        objects=[
            ModelObject(
                id=f"{kind}_1",
                name=kind,
                kind=kind,  # type: ignore[arg-type]
                dimensions=dimensions,
                transform=Transform(
                    position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)
                ),
                material=Material(color="#336699"),
            )
        ],
    )


@pytest.mark.parametrize(
    ("kind", "dimensions", "node"),
    [
        ("box", {"width": 1.0, "height": 2.0, "depth": 3.0}, "Box"),
        ("sphere", {"radius": 1.0}, "Sphere"),
        ("cylinder", {"radius": 1.0, "height": 2.0}, "Cylinder"),
        ("cone", {"bottomRadius": 1.0, "height": 2.0}, "Cone"),
    ],
)
async def test_pinned_mcp_creates_valid_renderable_primitives(
    x3d_mcp_server: str, kind: str, dimensions: dict[str, float], node: str
) -> None:
    from api.x3d_adapter import apply_model_spec

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await apply_model_spec(client, _spec(kind, dimensions))
        x3d = await client.get_scene()
        validation = await validate_scene_content(client, x3d)
        html = await client.generate_x3dom_page(x3d)

    assert f"<{node}" in x3d
    assert validation.valid
    assert "<html" in html.lower()


async def test_pinned_mcp_sessions_are_isolated(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as first:
        await first.create_primitive("box", {"size": [1.0, 1.0, 1.0]}, def_name="OnlyFirst")
        async with X3DMcpClient.connect(x3d_mcp_server) as second:
            assert "OnlyFirst" not in await second.get_scene()


async def test_composed_fixture_reduces_build_round_trips(x3d_mcp_server: str) -> None:
    from api.x3d_adapter import apply_model_spec

    fixture = ModelSpec(
        schemaVersion="1.0",
        projectId="prj_integration",
        revision=0,
        units="mm",
        scene=Scene(displayScale=1.0),
        objects=[
            _spec("box", {"width": 4.0, "height": 1.0, "depth": 3.0}).objects[0],
            _spec("sphere", {"radius": 0.5}).objects[0],
            _spec("cylinder", {"radius": 0.5, "height": 2.0}).objects[0],
        ],
    )

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        started_at = time.monotonic()
        await apply_model_spec(client, fixture)
        elapsed_seconds = time.monotonic() - started_at
        calls = client.transport_call_count
        validation = await validate_scene_content(client, await client.get_scene())

    granular_baseline_calls = 1 + 10 * len(fixture.objects)
    assert elapsed_seconds >= 0
    assert calls == 1
    assert calls * 2 <= granular_baseline_calls
    assert validation.valid


async def test_unavailable_mcp_has_a_typed_failure() -> None:
    with pytest.raises(McpUnavailableError):
        async with X3DMcpClient.connect("http://127.0.0.1:1", timeout_seconds=1.0):
            pass
