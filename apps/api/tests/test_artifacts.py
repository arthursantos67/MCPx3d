import json
from pathlib import Path

import pytest
from domain.model_spec import Material, ModelObject, ModelSpec, Scene, Transform
from jsonschema import Draft202012Validator

from api.artifacts import (
    ArtifactConversionError,
    StaleArtifactRequestError,
    build_converted_artifact,
    build_html_artifact,
    build_model_spec_artifact,
    build_x3d_artifact,
    normalized_artifact_filename,
)
from api.mcp_client import X3DMcpClient

pytestmark = pytest.mark.anyio

# The stale-revision check happens before any content is inspected, so its
# tests don't need a real X3D document -- any string round-trips unchanged.
_OPAQUE_CONTENT = "<X3D><Scene/></X3D>"

_MODEL_SPEC_SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "packages" / "domain" / "schemas" / "model-spec.v1.schema.json"
)


def _model_spec(project_id: str = "prj_test", revision: int = 3) -> ModelSpec:
    return ModelSpec(
        schemaVersion="1.0",
        projectId=project_id,
        revision=revision,
        units="mm",
        scene=Scene(displayScale=1.0),
        objects=[
            ModelObject(
                id="box1",
                name="box1",
                kind="box",
                dimensions={"width": 1.0, "height": 1.0, "depth": 1.0},
                transform=Transform(
                    position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)
                ),
                material=Material(color="#ff0000"),
            )
        ],
    )


async def _real_x3d_content(client: X3DMcpClient) -> str:
    await client.reset_scene()
    await client.create_primitive(
        "box", {"size": [1.0, 1.0, 1.0]}, color=(1.0, 0.0, 0.0), def_name="obj_box1"
    )
    return await client.get_scene()


def test_normalized_artifact_filename_matches_fr21_example() -> None:
    assert normalized_artifact_filename("chair", 7, "x3d") == "chair-r0007.x3d"


def test_build_x3d_artifact_returns_content_filename_and_media_type() -> None:
    artifact = build_x3d_artifact(
        project_id="prj_test", revision=3, x3d_content=_OPAQUE_CONTENT, requested_revision=3
    )
    assert artifact.filename == "prj_test-r0003.x3d"
    assert artifact.media_type == "model/x3d+xml"
    assert artifact.content == _OPAQUE_CONTENT


def test_build_x3d_artifact_rejects_a_stale_requested_revision() -> None:
    with pytest.raises(StaleArtifactRequestError):
        build_x3d_artifact(
            project_id="prj_test", revision=3, x3d_content=_OPAQUE_CONTENT, requested_revision=2
        )


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


async def test_downloaded_x3d_artifact_content_revalidates(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        x3d_content = await _real_x3d_content(client)
        artifact = build_x3d_artifact(
            project_id="prj_test", revision=1, x3d_content=x3d_content, requested_revision=1
        )
        validation = json.loads(await client.validate_x3d(artifact.content))

    assert validation["valid"] is True
    assert validation["errors"] == []


async def test_build_converted_artifact_x3dj_raises_on_malformed_upstream_output(
    x3d_mcp_server: str,
) -> None:
    """The pinned `x3d_mcp` commit's `convert_x3d(to_encoding="json")` currently
    returns text that is not valid JSON for any scene, including an empty one
    -- a pre-existing upstream serialization bug in the vendored `x3d` pip
    package, not something `x3d_adapter`/`artifacts` content triggers (the
    vendored server's own test suite never asserts its `model.JSON()` output
    actually parses either). Until that's fixed upstream, `.x3dj` is
    unavailable for every revision; `ArtifactConversionError` is how a caller
    (e.g. the download endpoint) learns to omit the format rather than serve
    corrupt content, per FR-20's "where upstream conversion succeeds"."""
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        x3d_content = await _real_x3d_content(client)
        with pytest.raises(ArtifactConversionError) as excinfo:
            await build_converted_artifact(
                client,
                format="x3dj",
                project_id="prj_test",
                revision=2,
                x3d_content=x3d_content,
                requested_revision=2,
            )

    assert excinfo.value.format == "x3dj"


async def test_build_converted_artifact_x3dv_produces_classic_vrml(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        x3d_content = await _real_x3d_content(client)
        artifact = await build_converted_artifact(
            client,
            format="x3dv",
            project_id="prj_test",
            revision=2,
            x3d_content=x3d_content,
            requested_revision=2,
        )

    assert artifact.filename == "prj_test-r0002.x3dv"
    assert artifact.media_type == "model/x3d-vrml"
    assert "Shape" in artifact.content


async def test_build_converted_artifact_rejects_a_stale_requested_revision() -> None:
    class _ExplodingClient:
        async def convert_x3d(self, content: str, *, from_encoding: str, to_encoding: str) -> str:
            raise AssertionError("must not convert for a stale revision request")

    with pytest.raises(StaleArtifactRequestError):
        await build_converted_artifact(
            _ExplodingClient(),  # type: ignore[arg-type]
            format="x3dj",
            project_id="prj_test",
            revision=3,
            x3d_content=_OPAQUE_CONTENT,
            requested_revision=2,
        )


async def test_build_converted_artifact_conversion_failure_does_not_touch_base_artifact(
    x3d_mcp_server: str,
) -> None:
    """A conversion failure isolates itself to the `.x3dj`/`.x3dv` request -- the
    caller's already-built `.x3d` artifact (built separately, before or after)
    is a plain string it already holds, untouched by this raising (FR-20)."""

    class _FailingConvertClient:
        async def convert_x3d(self, content: str, *, from_encoding: str, to_encoding: str) -> str:
            raise RuntimeError("conversion tool unreachable")

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        x3d_content = await _real_x3d_content(client)

    base_artifact = build_x3d_artifact(
        project_id="prj_test", revision=1, x3d_content=x3d_content, requested_revision=1
    )

    with pytest.raises(RuntimeError, match="conversion tool unreachable"):
        await build_converted_artifact(
            _FailingConvertClient(),  # type: ignore[arg-type]
            format="x3dj",
            project_id="prj_test",
            revision=1,
            x3d_content=x3d_content,
            requested_revision=1,
        )

    assert base_artifact.content == x3d_content


def test_build_model_spec_artifact_returns_manifest_json() -> None:
    spec = _model_spec(revision=3)
    artifact = build_model_spec_artifact(
        project_id="prj_test", revision=3, model_spec=spec, requested_revision=3
    )

    assert artifact.filename == "prj_test-r0003.json"
    assert artifact.media_type == "application/json"
    manifest = json.loads(artifact.content)
    assert manifest["schemaVersion"] == "1.0"
    assert manifest["revision"] == 3
    assert manifest["units"] == "mm"
    assert manifest["projectId"] == "prj_test"
    assert set(manifest.keys()) == {
        "schemaVersion",
        "projectId",
        "revision",
        "units",
        "scene",
        "objects",
    }


def test_build_model_spec_artifact_passes_model_spec_schema() -> None:
    spec = _model_spec()
    artifact = build_model_spec_artifact(
        project_id="prj_test", revision=3, model_spec=spec, requested_revision=3
    )
    schema = json.loads(_MODEL_SPEC_SCHEMA_PATH.read_text(encoding="utf-8"))

    Draft202012Validator(schema).validate(json.loads(artifact.content))


def test_build_model_spec_artifact_rejects_a_stale_requested_revision() -> None:
    spec = _model_spec(revision=3)
    with pytest.raises(StaleArtifactRequestError):
        build_model_spec_artifact(
            project_id="prj_test", revision=3, model_spec=spec, requested_revision=2
        )
