"""In-memory project/session store (PRD §3.12, FR-01, FR-34, UC-12, Issue #8).

Sessions live only in process memory for the MVP -- no database (PRD §3.12) --
so state is lost on backend restart unless the user has downloaded an
artifact. TTL is a sliding idle timeout: any successful lookup or commit
refreshes `last_active_at`, so an actively-used project does not expire out
from under the user; an untouched one does.
"""

from __future__ import annotations

import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass

from domain.model_spec import ModelSpec, Scene, Units

_PROJECT_ID_PREFIX = "prj_"


class ProjectServiceError(Exception):
    """Base class for project session failures."""


class ProjectNotFoundError(ProjectServiceError):
    """No live session exists for `project_id` (never existed, deleted, or expired)."""

    def __init__(self, project_id: str) -> None:
        super().__init__(f"project not found or expired: {project_id}")
        self.project_id = project_id


class RevisionConflictError(ProjectServiceError):
    """The caller's expected revision no longer matches the project's current revision."""

    def __init__(
        self, project_id: str, expected_revision: int, current_revision: int
    ) -> None:
        super().__init__(
            f"revision conflict for {project_id}: expected {expected_revision}, current {current_revision}"
        )
        self.project_id = project_id
        self.expected_revision = expected_revision
        self.current_revision = current_revision


@dataclass
class ProjectSession:
    project_id: str
    model_spec: ModelSpec
    created_at: float
    last_active_at: float

    @property
    def revision(self) -> int:
        return self.model_spec.revision


def _empty_model_spec(
    project_id: str, *, units: Units, display_scale: float
) -> ModelSpec:
    return ModelSpec(
        schemaVersion="1.0",
        projectId=project_id,
        revision=0,
        units=units,
        scene=Scene(displayScale=display_scale),
        objects=[],
    )


class ProjectSessionService:
    """Owns ProjectSession creation, lookup, expiry, and revision-checked commits."""

    def __init__(
        self,
        *,
        ttl_seconds: float,
        default_units: Units = "mm",
        default_display_scale: float = 1.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._default_units = default_units
        self._default_display_scale = default_display_scale
        self._clock = clock
        self._sessions: dict[str, ProjectSession] = {}

    def create_project(self) -> ProjectSession:
        project_id = f"{_PROJECT_ID_PREFIX}{secrets.token_urlsafe(24)}"
        now = self._clock()
        session = ProjectSession(
            project_id=project_id,
            model_spec=_empty_model_spec(
                project_id,
                units=self._default_units,
                display_scale=self._default_display_scale,
            ),
            created_at=now,
            last_active_at=now,
        )
        self._sessions[project_id] = session
        return session

    def get_project(self, project_id: str) -> ProjectSession:
        session = self._sessions.get(project_id)
        if session is None or self._is_expired(session):
            self._sessions.pop(project_id, None)
            raise ProjectNotFoundError(project_id)
        session.last_active_at = self._clock()
        return session

    def delete_project(self, project_id: str) -> None:
        self._sessions.pop(project_id, None)

    def commit_revision(
        self, project_id: str, expected_revision: int, model_spec: ModelSpec
    ) -> ProjectSession:
        """Replaces the project's ModelSpec if `expected_revision` is still current.

        On success the project's revision is exactly `expected_revision + 1`
        (FR-34); `model_spec.revision` is not read as input, it is overwritten
        to match, so the caller does not need to increment it itself.
        """
        session = self.get_project(project_id)
        if session.revision != expected_revision:
            raise RevisionConflictError(project_id, expected_revision, session.revision)
        session.model_spec = model_spec.model_copy(
            update={"revision": expected_revision + 1}
        )
        return session

    def _is_expired(self, session: ProjectSession) -> bool:
        return (self._clock() - session.last_active_at) > self._ttl_seconds
