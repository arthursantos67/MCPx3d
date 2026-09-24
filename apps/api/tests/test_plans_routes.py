"""HTTP-layer tests for the apply-ModelPlan orchestration endpoint (Issue #22).

Most error paths (`AMBIGUOUS_TARGET`, `UNKNOWN_TARGET`, `DOMAIN_VALIDATION_FAILED`,
`REVISION_CONFLICT`, `PROJECT_NOT_FOUND`, `INVALID_PLAN`) are proven to short-circuit
*before* any MCP call by pointing `mcp_base_url` at a closed port -- if the
endpoint tried to reach it, the request would fail with `MCP_UNAVAILABLE`
instead of the expected code. The happy path and `X3D_VALIDATION_FAILED` use
the real vendored `x3d_mcp` server (`x3d_mcp_server` fixture, `conftest.py`).
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl

from api.config import Settings, get_settings
from api.main import app
from api.mcp_client import McpToolError, X3DMcpClient
from api.projects import ProjectSessionService, get_project_service

_CLOSED_PORT_URL = AnyHttpUrl("http://127.0.0.1:1")


@pytest.fixture(autouse=True)
def _reset_dependency_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def project_service() -> ProjectSessionService:
    service = ProjectSessionService(ttl_seconds=3600.0)
    app.dependency_overrides[get_project_service] = lambda: service
    return service


@pytest.fixture
def client_unreachable_mcp(project_service: ProjectSessionService) -> TestClient:
    """A client whose MCP is unreachable -- used to prove error paths short-circuit before MCP."""
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=_CLOSED_PORT_URL)
    return TestClient(app)


_CREATE_CUBE_PLAN = {
    "intent": "create_model",
    "operations": [
        {
            "op": "create_object",
            "name": "Cube",
            "kind": "box",
            "dimensions": {"width": 10, "height": 10, "depth": 10},
            "color": "#ff0000",
        }
    ],
}


def test_ambiguous_clarify_plan_is_rejected_before_touching_mcp(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    body = {
        "expectedRevision": 0,
        "plan": {"intent": "modify_model", "operations": [{"op": "clarify", "question": "Which support?"}]},
    }

    response = client_unreachable_mcp.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 422
    detail = response.json()
    assert detail["code"] == "AMBIGUOUS_TARGET"
    assert detail["message"] == "Which support?"
    assert detail["correlationId"]

    refetched = project_service.get_project(session.project_id)
    assert refetched.revision == 0
    assert refetched.model_spec.objects == []


def test_unknown_target_fails_before_touching_mcp_and_does_not_mutate(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    body = {
        "expectedRevision": 0,
        "plan": {
            "intent": "modify_model",
            "operations": [{"op": "set_dimensions", "target": "ghost", "dimensions": {"width": 1}}],
        },
    }

    response = client_unreachable_mcp.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "UNKNOWN_TARGET"
    assert project_service.get_project(session.project_id).revision == 0


def test_invalid_dimension_keys_for_kind_is_a_domain_validation_failure(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    body = {
        "expectedRevision": 0,
        "plan": {
            "intent": "create_model",
            "operations": [
                {"op": "create_object", "name": "Cube", "kind": "box", "dimensions": {"radius": 5}}
            ],
        },
    }

    response = client_unreachable_mcp.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 422
    assert response.json()["code"] == "DOMAIN_VALIDATION_FAILED"
    assert project_service.get_project(session.project_id).revision == 0


def test_revision_conflict_fails_before_touching_mcp(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    body = {"expectedRevision": 5, "plan": _CREATE_CUBE_PLAN}

    response = client_unreachable_mcp.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 409
    assert response.json()["code"] == "REVISION_CONFLICT"


def test_unknown_project_returns_standardized_404(client_unreachable_mcp: TestClient) -> None:
    body = {"expectedRevision": 0, "plan": _CREATE_CUBE_PLAN}

    response = client_unreachable_mcp.post("/api/projects/prj_does_not_exist/plans", json=body)

    assert response.status_code == 404
    assert response.json()["code"] == "PROJECT_NOT_FOUND"


def test_malformed_plan_body_is_rejected_with_400_before_touching_mcp(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    body = {"expectedRevision": 0, "plan": {"intent": "modify_model", "operations": [{"op": "explode_object"}]}}

    response = client_unreachable_mcp.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_PLAN"


def test_string_revision_is_rejected_without_coercion(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    response = client_unreachable_mcp.post(
        f"/api/projects/{session.project_id}/plans",
        json={"expectedRevision": "0", "plan": _CREATE_CUBE_PLAN},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_PLAN"


def test_no_change_does_not_call_mcp_or_create_a_revision(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    response = client_unreachable_mcp.post(
        f"/api/projects/{session.project_id}/plans",
        json={
            "expectedRevision": 0,
            "plan": {"intent": "answer", "operations": [{"op": "no_change", "reason": "already correct"}]},
        },
    )

    assert response.status_code == 200
    assert response.json()["revision"] == 0
    assert response.json()["preview"] is None
    assert project_service.get_project(session.project_id).revision == 0


def test_mcp_unavailable_maps_to_503_and_does_not_mutate(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    session = project_service.create_project()
    body = {"expectedRevision": 0, "plan": _CREATE_CUBE_PLAN}

    response = client_unreachable_mcp.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 503
    assert response.json()["code"] == "MCP_UNAVAILABLE"
    assert project_service.get_project(session.project_id).revision == 0


def test_valid_plan_commits_and_returns_validation_and_artifacts(
    x3d_mcp_server: str, project_service: ProjectSessionService
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    client = TestClient(app)
    session = project_service.create_project()
    body = {"expectedRevision": 0, "requestId": "req-1", "plan": _CREATE_CUBE_PLAN}

    response = client.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 200
    assert response.headers["X-Correlation-Id"] == "req-1"
    payload = response.json()
    assert payload["revision"] == 1
    assert len(payload["modelSpec"]["objects"]) == 1
    assert payload["validation"]["schemaValid"] is True
    assert payload["validation"]["semanticValid"] is True
    assert {"plan_validation", "candidate_mutation", "mcp_connect", "mcp_scene_build", "x3d_validation"} <= set(payload["timings"])
    assert payload["preview"]["url"] == f"/api/projects/{session.project_id}/artifacts/html?revision=1"
    assert {a["format"] for a in payload["artifacts"]} == {"html", "x3d", "x3dj", "x3dv"}
    assert {a["format"] for a in payload["artifacts"] if a["available"]} == {"html", "x3d", "x3dv"}

    assert project_service.get_project(session.project_id).revision == 1


def test_mcp_tool_error_maps_to_503_and_does_not_mutate(
    x3d_mcp_server: str, project_service: ProjectSessionService, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _raise_mcp_tool_error(client: X3DMcpClient, spec: object) -> dict[str, str]:
        raise McpToolError("create_node", "boom")

    monkeypatch.setattr("api.x3d_validation.apply_model_spec", _raise_mcp_tool_error)

    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    client = TestClient(app)
    session = project_service.create_project()
    body = {"expectedRevision": 0, "plan": _CREATE_CUBE_PLAN}

    response = client.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 503
    assert response.json()["code"] == "MCP_UNAVAILABLE"
    assert project_service.get_project(session.project_id).revision == 0


def test_unexpected_error_maps_to_500_without_leaking_exception_text(
    project_service: ProjectSessionService, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _explode(*args: object, **kwargs: object) -> object:
        raise RuntimeError("super secret internal detail")

    monkeypatch.setattr("api.routes.plans.apply_plan", _explode)

    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=_CLOSED_PORT_URL)
    client = TestClient(app, raise_server_exceptions=False)
    session = project_service.create_project()
    body = {"expectedRevision": 0, "plan": _CREATE_CUBE_PLAN}

    response = client.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 500
    detail = response.json()
    assert detail["code"] == "INTERNAL_ERROR"
    assert "super secret internal detail" not in response.text


def test_oversized_intent_is_rejected_as_complexity_limit_before_touching_mcp(
    project_service: ProjectSessionService,
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        mcp_base_url=_CLOSED_PORT_URL, max_prompt_characters=5
    )
    client = TestClient(app)
    session = project_service.create_project()
    body = {"expectedRevision": 0, "plan": {**_CREATE_CUBE_PLAN, "intent": "way too long"}}

    response = client.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 413
    assert response.json()["code"] == "COMPLEXITY_LIMIT"
    assert project_service.get_project(session.project_id).revision == 0


def test_too_many_operations_is_rejected_as_complexity_limit_before_touching_mcp(
    project_service: ProjectSessionService,
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        mcp_base_url=_CLOSED_PORT_URL, max_operations_per_plan=1
    )
    client = TestClient(app)
    session = project_service.create_project()
    body = {
        "expectedRevision": 0,
        "plan": {
            "intent": "create_model",
            "operations": [
                _CREATE_CUBE_PLAN["operations"][0],
                {"op": "rename_object", "target": "obj_1", "name": "Renamed"},
            ],
        },
    }

    response = client.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 413
    assert response.json()["code"] == "COMPLEXITY_LIMIT"
    assert project_service.get_project(session.project_id).revision == 0


def test_object_count_limit_rejects_the_101st_object_before_touching_mcp(
    project_service: ProjectSessionService,
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        mcp_base_url=_CLOSED_PORT_URL, max_objects_per_project=1
    )
    client = TestClient(app)
    session = project_service.create_project()
    body = {
        "expectedRevision": 0,
        "plan": {
            "intent": "create_model",
            "operations": [
                _CREATE_CUBE_PLAN["operations"][0],
                {
                    "op": "create_object",
                    "name": "Second",
                    "kind": "box",
                    "dimensions": {"width": 1, "height": 1, "depth": 1},
                },
            ],
        },
    }

    response = client.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 413
    assert response.json()["code"] == "COMPLEXITY_LIMIT"
    assert project_service.get_project(session.project_id).revision == 0


def test_infinite_dimension_is_rejected_as_invalid_plan_before_touching_mcp(
    client_unreachable_mcp: TestClient, project_service: ProjectSessionService
) -> None:
    """`httpx`'s own JSON encoder refuses non-finite floats outright (`allow_nan=False`),
    so this posts a raw body containing a literal `Infinity` token -- valid input to
    Python's (permissive) `json.loads`, which is what the server actually parses with --
    to prove the domain layer's finiteness check (Issue #24), not just the transport
    client, is what rejects it."""
    session = project_service.create_project()
    raw_body = (
        '{"expectedRevision": 0, "plan": {"intent": "create_model", "operations": '
        '[{"op": "create_object", "name": "Cube", "kind": "box", '
        '"dimensions": {"width": Infinity, "height": 10, "depth": 10}}]}}'
    )

    response = client_unreachable_mcp.post(
        f"/api/projects/{session.project_id}/plans",
        content=raw_body,
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_PLAN"


async def _broken_route_scene(client: X3DMcpClient) -> None:
    await client.reset_scene()
    a = await client._create_node("Transform")
    shape_a = await client._create_node("Shape")
    box = await client._create_node("Box", {"size": [1.0, 1.0, 1.0]})
    await client._add_child(shape_a, box, container_field="geometry")
    await client._add_child(a, shape_a)
    await client._call("def_node", {"node_id": a, "name": "routeA"})

    b = await client._create_node("Transform")
    shape_b = await client._create_node("Shape")
    sphere = await client._create_node("Sphere", {"radius": 1.0})
    await client._add_child(shape_b, sphere, container_field="geometry")
    await client._add_child(b, shape_b)
    await client._call("def_node", {"node_id": b, "name": "routeB"})

    await client._call(
        "add_route",
        {"from_node": a, "from_field": "notARealField", "to_node": b, "to_field": "translation"},
    )


def test_invalid_x3d_does_not_commit(
    x3d_mcp_server: str, project_service: ProjectSessionService, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fake_apply_model_spec(client: X3DMcpClient, spec: object) -> dict[str, str]:
        await _broken_route_scene(client)
        return {}

    monkeypatch.setattr("api.x3d_validation.apply_model_spec", _fake_apply_model_spec)

    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    client = TestClient(app)
    session = project_service.create_project()
    body = {"expectedRevision": 0, "plan": _CREATE_CUBE_PLAN}

    response = client.post(f"/api/projects/{session.project_id}/plans", json=body)

    assert response.status_code == 422
    detail = response.json()
    assert detail["code"] == "X3D_VALIDATION_FAILED"
    assert detail["details"]

    assert project_service.get_project(session.project_id).revision == 0
    assert project_service.get_project(session.project_id).model_spec.objects == []
