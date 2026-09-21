import pytest
from domain.model_spec import Material, ModelObject, ModelSpec, Scene, Transform

from api.projects import (
    ProjectNotFoundError,
    ProjectSessionService,
    RevisionConflictError,
)


class _FakeClock:
    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _service(
    *, ttl_seconds: float = 3600.0, clock: _FakeClock | None = None
) -> ProjectSessionService:
    return ProjectSessionService(ttl_seconds=ttl_seconds, clock=clock or _FakeClock())


def _add_object(spec: ModelSpec, object_id: str = "obj_a") -> ModelSpec:
    obj = ModelObject(
        id=object_id,
        name="Box",
        kind="box",
        dimensions={"width": 1.0, "height": 1.0, "depth": 1.0},
        transform=Transform(
            position=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)
        ),
        material=Material(color="#808080"),
    )
    return spec.model_copy(update={"objects": [*spec.objects, obj]})


def test_create_project_starts_at_revision_zero_with_high_entropy_id() -> None:
    service = _service()

    session = service.create_project()

    assert session.revision == 0
    assert session.model_spec.objects == []
    assert session.project_id.startswith("prj_")
    assert len(session.project_id) > len("prj_") + 20


def test_create_project_generates_distinct_ids() -> None:
    service = _service()

    first = service.create_project()
    second = service.create_project()

    assert first.project_id != second.project_id


def test_get_project_returns_the_created_session() -> None:
    service = _service()
    created = service.create_project()

    fetched = service.get_project(created.project_id)

    assert fetched.project_id == created.project_id


def test_get_project_unknown_id_raises_not_found() -> None:
    service = _service()

    with pytest.raises(ProjectNotFoundError):
        service.get_project("prj_does_not_exist")


def test_delete_project_removes_it() -> None:
    service = _service()
    session = service.create_project()

    service.delete_project(session.project_id)

    with pytest.raises(ProjectNotFoundError):
        service.get_project(session.project_id)


def test_delete_unknown_project_is_a_no_op() -> None:
    service = _service()

    service.delete_project("prj_does_not_exist")  # must not raise


def test_commit_revision_increments_exactly_once_on_success() -> None:
    service = _service()
    session = service.create_project()
    candidate = _add_object(session.model_spec)

    updated = service.commit_revision(
        session.project_id, expected_revision=0, model_spec=candidate
    )

    assert updated.revision == 1
    assert len(updated.model_spec.objects) == 1

    refetched = service.get_project(session.project_id)
    assert refetched.revision == 1


def test_commit_revision_stale_expected_revision_raises_conflict() -> None:
    service = _service()
    session = service.create_project()
    candidate = _add_object(session.model_spec)
    service.commit_revision(
        session.project_id, expected_revision=0, model_spec=candidate
    )

    with pytest.raises(RevisionConflictError) as exc_info:
        service.commit_revision(
            session.project_id, expected_revision=0, model_spec=candidate
        )

    assert exc_info.value.expected_revision == 0
    assert exc_info.value.current_revision == 1


def test_commit_revision_unknown_project_raises_not_found() -> None:
    service = _service()
    spec = ModelSpec(
        schemaVersion="1.0",
        projectId="prj_ghost",
        revision=0,
        units="mm",
        scene=Scene(displayScale=1.0),
        objects=[],
    )

    with pytest.raises(ProjectNotFoundError):
        service.commit_revision("prj_ghost", expected_revision=0, model_spec=spec)


def test_expired_project_returns_not_found() -> None:
    clock = _FakeClock()
    service = _service(ttl_seconds=60.0, clock=clock)
    session = service.create_project()

    clock.advance(61.0)

    with pytest.raises(ProjectNotFoundError):
        service.get_project(session.project_id)


def test_active_project_is_not_expired_by_ttl_alone() -> None:
    clock = _FakeClock()
    service = _service(ttl_seconds=60.0, clock=clock)
    session = service.create_project()

    clock.advance(30.0)
    service.get_project(session.project_id)  # touches last_active_at
    clock.advance(30.0)

    refetched = service.get_project(session.project_id)
    assert refetched.project_id == session.project_id


def test_default_units_and_display_scale_are_applied_to_new_projects() -> None:
    service = ProjectSessionService(
        ttl_seconds=3600.0,
        default_units="m",
        default_display_scale=2.5,
        clock=_FakeClock(),
    )

    session = service.create_project()

    assert session.model_spec.units == "m"
    assert session.model_spec.scene.displayScale == 2.5
