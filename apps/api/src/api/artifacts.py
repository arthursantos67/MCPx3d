"""Downloadable revision artifacts: standalone HTML, X3D XML, alternative X3D
encodings, and the ModelSpec manifest (PRD FR-18/19/20/21/22/36, UC-07/08/09,
Issues #11, #12, #13, and #14).

All artifact kinds are built from an already-validated revision's X3D content
(`x3d_validation.ValidationResult.content`) or its `ModelSpec` -- none of
these functions mutate any stored project/revision state, so a failure here
(e.g. `generate_x3dom_page` or `convert_x3d` being unreachable) can never
invalidate or replace the revision it was asked to render (PRD FE-08,
"generation failure does not invalidate X3D revision"); for the two
conversion formats, that same isolation-by-construction is also what FR-20
means by "isolated from the base X3D artifact" -- a failed `.x3dj`/`.x3dv`
conversion is just an exception the caller can catch to omit that one format,
with the already-committed `.x3d` artifact untouched. `requested_revision` is
mandatory, mirroring `ProjectSessionService.commit_revision`'s
`expected_revision`, so a caller cannot silently receive a stale artifact by
omitting the check (FR-22).
"""

from __future__ import annotations

import dataclasses
import json
import re
from typing import Literal

from domain.model_spec import ModelSpec

from api.mcp_client import X3DMcpClient

_HTML_MEDIA_TYPE = "text/html; charset=utf-8"
_X3D_MEDIA_TYPE = "model/x3d+xml"
_X3DJ_MEDIA_TYPE = "model/x3d+json"
_X3DV_MEDIA_TYPE = "model/x3d-vrml"
_MANIFEST_MEDIA_TYPE = "application/json"

ConversionFormat = Literal["x3dj", "x3dv"]
_CONVERSION_TARGETS: dict[ConversionFormat, Literal["json", "vrml"]] = {
    "x3dj": "json",
    "x3dv": "vrml",
}
_CONVERSION_MEDIA_TYPES: dict[ConversionFormat, str] = {
    "x3dj": _X3DJ_MEDIA_TYPE,
    "x3dv": _X3DV_MEDIA_TYPE,
}


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


class ArtifactTooLargeError(ArtifactError):
    """Generated artifact content exceeds the configured size limit (PRD NFR-12, Issue #24)."""

    def __init__(self, format: str, *, size: int, limit: int) -> None:
        super().__init__(f"{format} artifact too large: {size} bytes > {limit} byte limit")
        self.format = format
        self.size = size
        self.limit = limit


class ArtifactConversionError(ArtifactError):
    """`convert_x3d` reported success but its output does not hold up.

    The pinned upstream `x3d_mcp` `convert_x3d` tool does not itself validate
    that its serialized output is well-formed -- for `to_encoding="json"` it
    can return text that merely resembles JSON (a known upstream gap: the
    vendored server's own test suite only checks for substrings like
    `"X3D" in json_out`, never that the result parses). Surfacing that as a
    raised error here, instead of returning corrupt content as if it were a
    normal `Artifact`, is what makes the `.x3dj` format "isolated" per FR-20:
    a caller sees a clean failure to treat as "not available for this
    revision" rather than corrupt bytes it has no reason to suspect.
    """

    def __init__(self, format: ConversionFormat, reason: str) -> None:
        super().__init__(f"{format} conversion produced invalid output: {reason}")
        self.format = format


@dataclasses.dataclass(frozen=True)
class Artifact:
    filename: str
    media_type: str
    content: str


def normalized_artifact_filename(project_id: str, revision: int, extension: str, *, title: str | None = None) -> str:
    """`{project_id}-r{revision:04d}.{extension}`, e.g. `chair-r0007.x3d` (FR-21)."""
    if title is None:
        return f"{project_id}-r{revision:04d}.{extension}"
    stem = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")[:64] or "model"
    return f"{stem}-r{revision:04d}.{extension}"


def _check_revision(project_id: str, requested_revision: int, current_revision: int) -> None:
    if requested_revision != current_revision:
        raise StaleArtifactRequestError(project_id, requested_revision, current_revision)


def _check_size(format: str, content: str, max_bytes: int | None) -> None:
    if max_bytes is None:
        return
    size = len(content.encode("utf-8"))
    if size > max_bytes:
        raise ArtifactTooLargeError(format, size=size, limit=max_bytes)


async def build_html_artifact(
    client: X3DMcpClient,
    *,
    project_id: str,
    revision: int,
    x3d_content: str,
    requested_revision: int,
    title: str | None = None,
    max_bytes: int | None = None,
) -> Artifact:
    """Standalone X3DOM HTML for `x3d_content` (FR-18, UC-07)."""
    _check_revision(project_id, requested_revision, revision)
    html = await client.generate_x3dom_page(x3d_content, title=title or project_id)
    _check_size("html", html, max_bytes)
    return Artifact(
        filename=normalized_artifact_filename(project_id, revision, "html", title=title),
        media_type=_HTML_MEDIA_TYPE,
        content=html,
    )


def build_x3d_artifact(
    *,
    project_id: str,
    revision: int,
    x3d_content: str,
    requested_revision: int,
    title: str | None = None,
    max_bytes: int | None = None,
) -> Artifact:
    """The validated revision's X3D XML, ready for download (FR-19, UC-08)."""
    _check_revision(project_id, requested_revision, revision)
    _check_size("x3d", x3d_content, max_bytes)
    return Artifact(
        filename=normalized_artifact_filename(project_id, revision, "x3d", title=title),
        media_type=_X3D_MEDIA_TYPE,
        content=x3d_content,
    )


async def build_converted_artifact(
    client: X3DMcpClient,
    *,
    format: ConversionFormat,
    project_id: str,
    revision: int,
    x3d_content: str,
    requested_revision: int,
    title: str | None = None,
    max_bytes: int | None = None,
) -> Artifact:
    """The validated revision converted to `format` (`x3dj` or `x3dv`), via
    the upstream `convert_x3d` tool (FR-20). Raises whatever `convert_x3d`
    raises on failure -- there is no fallback content -- so callers offering
    these formats as optional downloads should treat that as "not available
    for this revision" rather than retry with stale content.
    """
    _check_revision(project_id, requested_revision, revision)
    converted = await client.convert_x3d(
        x3d_content, from_encoding="xml", to_encoding=_CONVERSION_TARGETS[format]
    )
    if format == "x3dj":
        try:
            json.loads(converted)
        except json.JSONDecodeError as exc:
            raise ArtifactConversionError(format, str(exc)) from exc
    _check_size(format, converted, max_bytes)
    return Artifact(
        filename=normalized_artifact_filename(project_id, revision, format, title=title),
        media_type=_CONVERSION_MEDIA_TYPES[format],
        content=converted,
    )


def build_model_spec_artifact(
    *,
    project_id: str,
    revision: int,
    model_spec: ModelSpec,
    requested_revision: int,
    title: str | None = None,
    max_bytes: int | None = None,
) -> Artifact:
    """The current `ModelSpec` as a downloadable JSON manifest (FR-36, UC-09).

    `model_spec.model_dump_json()` only ever serializes `ModelSpec`'s own
    declared fields (its models all set `extra="forbid"`), so the manifest
    can never leak session/implementation details that aren't already part
    of the schema-validated semantic model. `exclude_none=True` matches the
    schema: optional fields like `scene.background`, `material.transparency`,
    and `tags` are typed/constrained for when they're present (e.g. a
    non-empty string) and are simply absent otherwise -- the schema has no
    `"type": ["string", "null"]` case for them, so an emitted `null` would
    fail validation where omitting the key entirely passes.
    """
    _check_revision(project_id, requested_revision, revision)
    content = model_spec.model_dump_json(indent=2, exclude_none=True)
    _check_size("json", content, max_bytes)
    return Artifact(
        filename=normalized_artifact_filename(project_id, revision, "json", title=title),
        media_type=_MANIFEST_MEDIA_TYPE,
        content=content,
    )
