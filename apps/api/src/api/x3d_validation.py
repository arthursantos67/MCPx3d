"""Full candidate X3D validation pipeline (PRD FR-14/15/16, NFR-06, Issue #10).

`build_and_validate_candidate` is the only code path that turns a `ModelSpec`
into a *committable* X3D candidate: it builds the scene through the Issue #9
adapter, runs schema (XSD) and semantic validation, attempts the upstream
`autofix_x3d` containerField autofix on failure, and revalidates. It returns
a result only when the candidate is valid; otherwise it raises
`X3DValidationError` and returns nothing, so -- like `mutation.apply_plan`'s
never-write-until-success contract -- an invalid candidate cannot overwrite
whatever the caller already holds as the last valid revision (PRD FE-08).

`validate_current_scene`/`validate_scene_content` are exposed separately
because the pipeline's validate/autofix/revalidate steps are also useful on
their own (e.g. validating a scene built without going through a ModelSpec).
"""

from __future__ import annotations

import dataclasses
import json
import re
from typing import Literal

from domain.model_spec import ModelSpec

from api.mcp_client import X3DMcpClient
from api.x3d_adapter import apply_model_spec

DiagnosticLevel = Literal["error", "warning", "info"]

_SECTION_LEVELS: dict[str, DiagnosticLevel] = {
    "## Errors": "error",
    "## Warnings": "warning",
    "## Info": "info",
}
_DIAGNOSTIC_LINE = re.compile(r"^- \*\*\[(?P<check>[\w-]+)\]\*\* (?P<message>.+)$")


class X3DValidationError(Exception):
    """The candidate remained invalid after schema/semantic validation and autofix."""

    def __init__(self, result: ValidationResult) -> None:
        super().__init__(
            f"candidate X3D is invalid: {len(result.schema_errors)} schema error(s), "
            f"{len(result.errors)} semantic error(s)"
        )
        self.result = result


@dataclasses.dataclass(frozen=True)
class Diagnostic:
    level: DiagnosticLevel
    check: str
    message: str


@dataclasses.dataclass(frozen=True)
class ValidationResult:
    """Structured validation state (PRD FR-23)."""

    schema_valid: bool
    schema_errors: tuple[str, ...]
    semantic_diagnostics: tuple[Diagnostic, ...]
    autofixes: tuple[dict[str, object], ...]
    content: str

    @property
    def semantic_valid(self) -> bool:
        return not any(d.level == "error" for d in self.semantic_diagnostics)

    @property
    def valid(self) -> bool:
        return self.schema_valid and self.semantic_valid

    @property
    def errors(self) -> tuple[Diagnostic, ...]:
        return tuple(d for d in self.semantic_diagnostics if d.level == "error")

    @property
    def warnings(self) -> tuple[Diagnostic, ...]:
        return tuple(d for d in self.semantic_diagnostics if d.level == "warning")

    def to_summary(self) -> dict[str, object]:
        """FR-23's `{schemaValid, semanticValid, warnings, autofixes}` shape."""
        return {
            "schemaValid": self.schema_valid,
            "semanticValid": self.semantic_valid,
            "warnings": [
                {"check": d.check, "message": d.message}
                for d in self.semantic_diagnostics
                if d.level == "warning"
            ],
            "autofixes": list(self.autofixes),
        }


def _parse_semantic_report(report: str) -> tuple[Diagnostic, ...]:
    if report.startswith("# Semantic Check: All Clear"):
        return ()
    if report.startswith("# Semantic Check: Parse Error"):
        return (Diagnostic("error", "parse-error", report.split("\n\n", 1)[-1].strip()),)
    if report.startswith("# Semantic Check: No Scene"):
        return (Diagnostic("error", "no-scene", report.split("\n\n", 1)[-1].strip()),)

    diagnostics: list[Diagnostic] = []
    level: DiagnosticLevel | None = None
    saw_report = False
    saw_section = False
    saw_diagnostic = False
    for line in report.splitlines():
        if line == "# Semantic Check Report":
            saw_report = True
            continue
        section_level = _SECTION_LEVELS.get(line)
        if section_level is not None:
            level = section_level
            saw_section = True
            continue
        match = _DIAGNOSTIC_LINE.match(line)
        if match is not None and level is not None:
            diagnostics.append(Diagnostic(level, match["check"], match["message"]))
            saw_diagnostic = True
    if saw_report and saw_section and saw_diagnostic:
        return tuple(diagnostics)
    return (Diagnostic("error", "semantic-report-protocol", "Unrecognized or incomplete semantic report."),)


async def validate_scene_content(client: X3DMcpClient, content: str) -> ValidationResult:
    """Runs schema + semantic validation against arbitrary X3D `content`."""
    try:
        schema = json.loads(await client.validate_x3d(content))
        schema_valid = schema["valid"] is True
        schema_errors = tuple(schema["errors"])
    except (TypeError, KeyError, json.JSONDecodeError) as exc:
        schema_valid = False
        schema_errors = (f"Invalid schema validation response: {exc}",)
    semantic_report = await client.validate_semantic(content)
    return ValidationResult(
        schema_valid=schema_valid,
        schema_errors=schema_errors,
        semantic_diagnostics=_parse_semantic_report(semantic_report),
        autofixes=(),
        content=content,
    )


async def validate_current_scene(client: X3DMcpClient) -> ValidationResult:
    """Validates whatever scene is currently loaded in `client`'s granular session."""
    return await validate_scene_content(client, await client.get_scene())


async def autofix_and_revalidate(
    client: X3DMcpClient, result: ValidationResult
) -> ValidationResult:
    """Attempts the upstream containerField autofix on an invalid `result` and revalidates.

    Returns `result` unchanged if it is already valid or autofix made no changes.
    Autofixes actually applied are recorded on the returned result (FR-16); an
    issue autofix cannot address (e.g. a ROUTE error) is left as-is for the
    caller to see as a remaining error.
    """
    if result.valid:
        return result
    fix = json.loads(await client.autofix_x3d(result.content))
    if not fix.get("changes"):
        return result
    revalidated = await validate_scene_content(client, fix["fixed"])
    return dataclasses.replace(revalidated, autofixes=tuple(fix["changes"]))


async def build_and_validate_candidate(
    client: X3DMcpClient, spec: ModelSpec
) -> tuple[dict[str, str], ValidationResult]:
    """Builds `spec` as X3D and runs the full validation pipeline (Issue #10).

    Returns `(def_names, result)` when the candidate is valid. Raises
    `X3DValidationError` -- without returning anything -- when it remains
    invalid after autofix, so an invalid candidate can never be mistaken for
    one safe to commit as the project's new revision.
    """
    def_names = await apply_model_spec(client, spec)
    result = await autofix_and_revalidate(client, await validate_current_scene(client))
    if not result.valid:
        raise X3DValidationError(result)
    return def_names, result
