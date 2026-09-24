"""In-memory project/session store (PRD §3.12, FR-01, FR-34, UC-12, Issue #8).

Sessions live only in process memory for the MVP -- no database (PRD §3.12) --
so state is lost on backend restart unless the user has downloaded an
artifact. TTL is a sliding idle timeout: any successful lookup or commit
refreshes `last_active_at`, so an actively-used project does not expire out
from under the user; an untouched one does.
"""

from __future__ import annotations

import asyncio
import secrets
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import lru_cache

from domain.model_spec import ModelSpec, Scene, Units

from api.config import get_settings

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


class SessionCapacityError(ProjectServiceError):
    """The in-memory session limit has been reached."""


@dataclass
class ProjectSession:
    project_id: str
    model_spec: ModelSpec
    created_at: float
    last_active_at: float
    validated_x3d: dict[int, str]
    html_artifacts: dict[int, str]

    @property
    def revision(self) -> int:
        return self.model_spec.revision


@dataclass(frozen=True)
class RevisionSnapshot:
    """Immutable inputs for one exact, already-validated revision."""

    project_id: str
    revision: int
    model_spec: ModelSpec
    x3d_content: str


@dataclass(frozen=True)
class _CachedArtifact:
    content: str
    created_at: float


class _ArtifactCache:
    """Small in-memory artifact cache with one shared build per cache key."""

    def __init__(self, *, max_entries: int, ttl_seconds: float, clock: Callable[[], float]) -> None:
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._entries: OrderedDict[tuple[str, int, str], _CachedArtifact] = OrderedDict()
        self._inflight: dict[tuple[str, int, str], asyncio.Task[str]] = {}

    async def get_or_build(
        self, key: tuple[str, int, str], build: Callable[[], Awaitable[str]]
    ) -> str:
        self.collect_expired()
        cached = self._entries.get(key)
        if cached is not None:
            self._entries.move_to_end(key)
            return cached.content

        in_flight = self._inflight.get(key)
        if in_flight is None:
            in_flight = asyncio.create_task(_build_cached_artifact(build))
            self._inflight[key] = in_flight
        try:
            content = await asyncio.shield(in_flight)
        except BaseException:
            if self._inflight.get(key) is in_flight and in_flight.done():
                self._inflight.pop(key, None)
            raise

        if self._inflight.get(key) is not in_flight:
            return content

        self._entries[key] = _CachedArtifact(content, self._clock())
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)
        if in_flight.done():
            self._inflight.pop(key, None)
        return content

    def remove_project(self, project_id: str) -> None:
        for key in [key for key in self._entries if key[0] == project_id]:
            del self._entries[key]
        for key in [key for key in self._inflight if key[0] == project_id]:
            task = self._inflight.pop(key)
            task.cancel()

    def collect_expired(self) -> None:
        now = self._clock()
        for key, entry in list(self._entries.items()):
            if now - entry.created_at > self._ttl_seconds:
                del self._entries[key]


async def _build_cached_artifact(build: Callable[[], Awaitable[str]]) -> str:
    return await build()


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
        max_sessions: int = 1_000,
        artifact_cache_max_entries: int = 200,
        artifact_cache_ttl_seconds: float = 3600.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._default_units = default_units
        self._default_display_scale = default_display_scale
        self._clock = clock
        self._max_sessions = max_sessions
        self._sessions: dict[str, ProjectSession] = {}
        self._artifact_cache = _ArtifactCache(
            max_entries=artifact_cache_max_entries,
            ttl_seconds=artifact_cache_ttl_seconds,
            clock=clock,
        )

    def create_project(self) -> ProjectSession:
        self.collect_expired()
        if len(self._sessions) >= self._max_sessions:
            raise SessionCapacityError("project session limit reached")
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
            validated_x3d={},
            html_artifacts={},
        )
        self._sessions[project_id] = session
        return session

    def get_project(self, project_id: str) -> ProjectSession:
        self.collect_expired()
        session = self._sessions.get(project_id)
        if session is None or self._is_expired(session):
            self._sessions.pop(project_id, None)
            raise ProjectNotFoundError(project_id)
        session.last_active_at = self._clock()
        return session

    def delete_project(self, project_id: str) -> None:
        self._sessions.pop(project_id, None)
        self._artifact_cache.remove_project(project_id)

    def commit_revision(
        self,
        project_id: str,
        expected_revision: int,
        model_spec: ModelSpec,
        validated_x3d: str | None = None,
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
        session.validated_x3d = {session.revision: validated_x3d} if validated_x3d else {}
        session.html_artifacts = {}
        return session

    def cache_html_artifact(self, project_id: str, revision: int, content: str) -> None:
        session = self.get_project(project_id)
        if session.revision == revision:
            session.html_artifacts[revision] = content

    def snapshot_revision(self, project_id: str, revision: int) -> RevisionSnapshot | None:
        """Captures all route inputs before an await can observe a later commit."""
        session = self.get_project(project_id)
        x3d_content = session.validated_x3d.get(revision)
        if revision != session.revision or x3d_content is None:
            return None
        return RevisionSnapshot(
            project_id=project_id,
            revision=revision,
            model_spec=session.model_spec.model_copy(deep=True),
            x3d_content=x3d_content,
        )

    async def get_or_build_artifact(
        self,
        snapshot: RevisionSnapshot,
        format_key: str,
        build: Callable[[], Awaitable[str]],
    ) -> str:
        return await self._artifact_cache.get_or_build(
            (snapshot.project_id, snapshot.revision, format_key), build
        )

    def collect_expired(self) -> int:
        expired = [
            project_id
            for project_id, session in self._sessions.items()
            if self._is_expired(session)
        ]
        for project_id in expired:
            self._sessions.pop(project_id, None)
            self._artifact_cache.remove_project(project_id)
        self._artifact_cache.collect_expired()
        return len(expired)

    def _is_expired(self, session: ProjectSession) -> bool:
        return (self._clock() - session.last_active_at) > self._ttl_seconds


@lru_cache
def get_project_service() -> ProjectSessionService:
    """FastAPI dependency: one process-wide `ProjectSessionService` (Issue #21).

    Mirrors `api.config.get_settings`'s own `@lru_cache` singleton pattern --
    routes depend on this function, and tests override it the same way
    `test_health.py` overrides `get_settings` (`app.dependency_overrides`).
    """
    settings = get_settings()
    return ProjectSessionService(
        ttl_seconds=settings.session_ttl_seconds,
        default_units=settings.default_units,
        default_display_scale=settings.default_display_scale,
        max_sessions=settings.max_sessions,
        artifact_cache_max_entries=settings.artifact_cache_max_entries,
        artifact_cache_ttl_seconds=settings.artifact_cache_ttl_seconds,
    )
