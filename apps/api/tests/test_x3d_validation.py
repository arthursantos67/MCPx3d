import pytest
from domain.model_spec import Material, ModelObject, ModelSpec, Scene, Transform

from api.mcp_client import X3DMcpClient
from api.x3d_validation import (
    Diagnostic,
    ValidationResult,
    X3DValidationError,
    _parse_semantic_report,
    autofix_and_revalidate,
    build_and_validate_candidate,
    validate_current_scene,
    validate_scene_content,
)

pytestmark = pytest.mark.anyio

# A Shape whose Appearance/Box children have deliberately swapped containerField
# attributes. x3d.py's granular builder type-checks field assignment at
# construction time and refuses this placement outright, so it can only be
# reached as raw content fed to the content-based validate/autofix tools --
# exactly the surface `autofix_x3d` targets (it rewrites hand-authored XML,
# not the granular in-memory scene).
_SWAPPED_CONTAINERFIELD_X3D = """<?xml version="1.0" encoding="UTF-8"?>
<X3D profile="Immersive" version="4.0">
<Scene>
<Transform DEF="obj_box1">
<Shape>
<Appearance containerField="geometry"><Material diffuseColor="1 0 0"></Material></Appearance>
<Box containerField="appearance" size="1 1 1"></Box>
</Shape>
</Transform>
</Scene>
</X3D>
"""


def _box(object_id: str = "box1") -> ModelObject:
    return ModelObject(
        id=object_id,
        name=object_id,
        kind="box",
        dimensions={"width": 1.0, "height": 1.0, "depth": 1.0},
        transform=Transform(position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)),
        material=Material(color="#ff0000"),
    )


def _spec(*objects: ModelObject) -> ModelSpec:
    return ModelSpec(
        schemaVersion="1.0",
        projectId="prj_test",
        revision=0,
        units="mm",
        scene=Scene(displayScale=1.0),
        objects=list(objects),
    )


async def _def_shape(
    client: X3DMcpClient, def_name: str, geometry_type: str, fields: dict[str, object]
) -> str:
    """Builds one Transform>Shape>geometry primitive via raw granular tools (no Appearance),
    bypassing the Issue #9 adapter so a test can shape the scene the adapter never would."""
    transform_id = await client._create_node("Transform")
    shape_id = await client._create_node("Shape")
    geometry_id = await client._create_node(geometry_type, fields)
    await client._add_child(shape_id, geometry_id, container_field="geometry")
    await client._add_child(transform_id, shape_id)
    await client._call("def_node", {"node_id": transform_id, "name": def_name})
    return transform_id


async def _broken_route_scene(client: X3DMcpClient) -> None:
    """A schema-valid scene with one ROUTE naming a field that does not exist --
    unfixable by `autofix_x3d`, which only ever touches containerField attributes."""
    await client.reset_scene()
    a = await _def_shape(client, "routeA", "Box", {"size": [1.0, 1.0, 1.0]})
    b = await _def_shape(client, "routeB", "Sphere", {"radius": 1.0})
    await client._call(
        "add_route",
        {"from_node": a, "from_field": "notARealField", "to_node": b, "to_field": "translation"},
    )


class TestParseSemanticReport:
    def test_all_clear_has_no_diagnostics(self) -> None:
        report = "# Semantic Check: All Clear\n\nNo semantic issues found. The scene looks well-structured."
        assert _parse_semantic_report(report) == ()

    def test_parse_error_becomes_one_error_diagnostic(self) -> None:
        report = "# Semantic Check: Parse Error\n\nsome lxml message"
        assert _parse_semantic_report(report) == (
            Diagnostic("error", "parse-error", "some lxml message"),
        )

    def test_no_scene_becomes_one_error_diagnostic(self) -> None:
        report = "# Semantic Check: No Scene\n\nNo Scene element found in the X3D document."
        assert _parse_semantic_report(report) == (
            Diagnostic("error", "no-scene", "No Scene element found in the X3D document."),
        )

    def test_sections_are_parsed_with_the_right_levels(self) -> None:
        report = (
            "# Semantic Check Report\n\n"
            "Found 1 error(s), 1 warning(s), 1 info(s).\n\n"
            "## Errors\n\n"
            "- **[duplicate-def]** Duplicate DEF name 'x'.\n\n"
            "## Warnings\n\n"
            "- **[naming-convention]** DEF='a-b' on Transform: bad.\n\n"
            "## Info\n\n"
            "- **[unused-def]** DEF='y' is defined but never USE'd.\n"
        )
        assert _parse_semantic_report(report) == (
            Diagnostic("error", "duplicate-def", "Duplicate DEF name 'x'."),
            Diagnostic("warning", "naming-convention", "DEF='a-b' on Transform: bad."),
            Diagnostic("info", "unused-def", "DEF='y' is defined but never USE'd."),
        )


class TestValidationResultSummary:
    def test_to_summary_matches_fr23_shape(self) -> None:
        result = ValidationResult(
            schema_valid=True,
            schema_errors=(),
            semantic_diagnostics=(
                Diagnostic("warning", "naming-convention", "bad name"),
                Diagnostic("info", "unused-def", "unused"),
            ),
            autofixes=({"node": "Box", "from": "appearance", "to": "geometry"},),
            content="<X3D/>",
        )
        assert result.valid
        assert result.to_summary() == {
            "schemaValid": True,
            "semanticValid": True,
            "warnings": [
                {"check": "naming-convention", "message": "bad name"},
                {"check": "unused-def", "message": "unused"},
            ],
            "autofixes": [{"node": "Box", "from": "appearance", "to": "geometry"}],
        }


async def test_valid_spec_produces_a_valid_candidate_with_no_errors(x3d_mcp_server: str) -> None:
    spec = _spec(_box())
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        def_names, result = await build_and_validate_candidate(client, spec)

    assert def_names == {"box1": "obj_box1"}
    assert result.valid
    assert result.schema_valid
    assert result.semantic_valid
    assert result.errors == ()
    assert "<Box" in result.content


async def test_hyphenated_object_id_warns_but_stays_valid(x3d_mcp_server: str) -> None:
    spec = _spec(_box("my-box"))
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        _, result = await build_and_validate_candidate(client, spec)

    assert result.valid
    assert any(d.check == "naming-convention" for d in result.warnings)


async def test_autofix_reverses_a_swapped_containerfield_and_records_the_change(
    x3d_mcp_server: str,
) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        before = await validate_scene_content(client, _SWAPPED_CONTAINERFIELD_X3D)
        assert not before.valid
        assert any(d.check == "containerfield-type-mismatch" for d in before.errors)

        after = await autofix_and_revalidate(client, before)

    assert after.valid
    assert len(after.autofixes) == 2


async def test_route_error_is_not_autofixable(x3d_mcp_server: str) -> None:
    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        await _broken_route_scene(client)
        result = await autofix_and_revalidate(client, await validate_current_scene(client))

    assert not result.valid
    assert any(d.check == "route-invalid-from-field" for d in result.errors)
    assert result.autofixes == ()


async def test_build_and_validate_candidate_raises_and_commits_nothing_when_still_invalid(
    x3d_mcp_server: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fake_apply_model_spec(client: X3DMcpClient, spec: ModelSpec) -> dict[str, str]:
        await _broken_route_scene(client)
        return {}

    monkeypatch.setattr("api.x3d_validation.apply_model_spec", _fake_apply_model_spec)

    async with X3DMcpClient.connect(x3d_mcp_server) as client:
        with pytest.raises(X3DValidationError) as exc_info:
            await build_and_validate_candidate(client, _spec(_box()))

    result = exc_info.value.result
    assert not result.valid
    assert any(d.check == "route-invalid-from-field" for d in result.errors)
