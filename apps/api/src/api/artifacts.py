"""Downloadable standalone HTML artifact for a validated revision (PRD FR-18,
FR-21/22, UC-07, Issue #11).

`build_html_artifact` is built from an already-validated revision's X3D
content (`x3d_validation.ValidationResult.content`) -- it mutates no stored
project/revision state, so a failure here (e.g. `generate_x3dom_page` being
unreachable) can never invalidate or replace the revision it was asked to
render (PRD FE-08, "generation failure does not invalidate X3D revision").
`requested_revision` is mandatory, mirroring
`ProjectSessionService.commit_revision`'s `expected_revision`, so a caller
cannot silently receive a stale artifact by omitting the check (FR-22).
"""

from __future__ import annotations

import dataclasses

from api.mcp_client import X3DMcpClient

_HTML_MEDIA_TYPE = "text/html; charset=utf-8"


class ArtifactError(Exception):
    """Base class for artifact-generation failures."""


class StaleArtifactRequestError(ArtifactError):
    """The caller asked for a revision that is no longer the project's current one."""

    def __init__(self, project_id: str, requested_revision: int, current_revision: int) -> None:
        super().__init__(
            f"stale artifact request for {project_id}: requested revision "
            f"{requested_revision}, current revision is {current_revision}"
        )
        self.project_id = project_id
        self.requested_revision = requested_revision
        self.current_revision = current_revision


@dataclasses.dataclass(frozen=True)
class Artifact:
    filename: str
    media_type: str
    content: str


def normalized_artifact_filename(project_id: str, revision: int, extension: str) -> str:
    """`{project_id}-r{revision:04d}.{extension}`, e.g. `chair-r0007.x3d` (FR-21)."""
    return f"{project_id}-r{revision:04d}.{extension}"


def _check_revision(project_id: str, requested_revision: int, current_revision: int) -> None:
    if requested_revision != current_revision:
        raise StaleArtifactRequestError(project_id, requested_revision, current_revision)


async def build_html_artifact(
    client: X3DMcpClient,
    *,
    project_id: str,
    revision: int,
    x3d_content: str,
    requested_revision: int,
) -> Artifact:
    """Standalone X3DOM HTML for `x3d_content` (FR-18, UC-07)."""
    _check_revision(project_id, requested_revision, revision)
    html = await client.generate_x3dom_page(x3d_content, title=project_id)
    return Artifact(
        filename=normalized_artifact_filename(project_id, revision, "html"),
        media_type=_HTML_MEDIA_TYPE,
        content=html,
    )
