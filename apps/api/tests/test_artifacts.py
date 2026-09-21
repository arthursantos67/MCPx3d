import pytest

from api.artifacts import (
    StaleArtifactRequestError,
    build_html_artifact,
    normalized_artifact_filename,
)
from api.mcp_client import X3DMcpClient

pytestmark = pytest.mark.anyio

# The stale-revision check happens before any content is inspected, so its
# tests don't need a real X3D document -- any string round-trips unchanged.
_OPAQUE_CONTENT = "<X3D><Scene/></X3D>"


async def _real_x3d_content(client: X3DMcpClient) -> str:
    await client.reset_scene()
    await client.create_primitive(
        "box", {"size": [1.0, 1.0, 1.0]}, color=(1.0, 0.0, 0.0), def_name="obj_box1"
    )
    return await client.get_scene()


def test_normalized_artifact_filename_matches_fr21_example() -> None:
    assert normalized_artifact_filename("chair", 7, "x3d") == "chair-r0007.x3d"


async def test_build_html_artifact_renders_a_known_scene(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        x3d_content = await _real_x3d_content(client)
        artifact = await build_html_artifact(
            client,
            project_id="prj_test",
            revision=1,
            x3d_content=x3d_content,
            requested_revision=1,
        )

    assert artifact.filename == "prj_test-r0001.html"
    assert artifact.media_type.startswith("text/html")
    assert "<html" in artifact.content.lower()
    assert "obj_box1" in artifact.content
    assert "box" in artifact.content.lower()


async def test_build_html_artifact_rejects_stale_revision_without_calling_mcp() -> None:
    class _ExplodingClient:
        async def generate_x3dom_page(self, content: str, *, title: str = "") -> str:
            raise AssertionError("must not generate HTML for a stale revision request")

    with pytest.raises(StaleArtifactRequestError):
        await build_html_artifact(
            _ExplodingClient(),  # type: ignore[arg-type]
            project_id="prj_test",
            revision=3,
            x3d_content=_OPAQUE_CONTENT,
            requested_revision=2,
        )


async def test_build_html_artifact_propagates_generation_failure_untouched() -> None:
    """A failure generating HTML surfaces as-is -- build_html_artifact has no stored
    revision state to corrupt, so the failure can never leave a partial/invalid
    artifact standing in for the requested revision (PRD FE-08, Issue #11)."""

    class _FailingClient:
        async def generate_x3dom_page(self, content: str, *, title: str = "") -> str:
            raise RuntimeError("x3d_mcp unreachable")

    with pytest.raises(RuntimeError, match="x3d_mcp unreachable"):
        await build_html_artifact(
            _FailingClient(),  # type: ignore[arg-type]
            project_id="prj_test",
            revision=1,
            x3d_content=_OPAQUE_CONTENT,
            requested_revision=1,
        )
