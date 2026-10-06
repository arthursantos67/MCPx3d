from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from domain.cad_assembly import CadAssemblySpec
from domain.cad_part import CadPartSpec
from domain.cad_plan import CadEditPlan
from domain.cad_program import CadProgramSpec
from fastapi import APIRouter, Depends, HTTPException, Path, Response
from pydantic import BaseModel, ConfigDict, Field

from api.cad_adapter import (
    CadArtifactTooLargeError,
    CadEngineUnavailableError,
    CadGeometryError,
)
from api.cad_mutation import CadMutationError, apply_cad_plan
from api.cad_projects import (
    CadProjectNotFoundError,
    CadProjectStore,
    CadRevision,
    CadRevisionNotFoundError,
)
from api.cad_service import build_cad_artifact
from api.cad_stl import (
    component_from_saved_step,
    step_from_shape,
    stl_from_saved_step,
    stl_from_shape,
)
from api.config import Settings, get_settings
from api.errors import api_error
from api.projects import RevisionConflictError
from api.routes.cad import CadInspection

router = APIRouter(prefix="/api/cad/projects", tags=["cad"])


@lru_cache
def get_cad_project_store() -> CadProjectStore:
    return CadProjectStore(get_settings().cad_database_path)


class CreateCadProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    spec: CadPartSpec | CadProgramSpec | CadAssemblySpec


class ApplyCadPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: int = Field(ge=0)
    plan: CadEditPlan


class ReplaceCadSpecRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expectedRevision: int = Field(ge=0)
    spec: CadPartSpec | CadProgramSpec | CadAssemblySpec


class CadProjectResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    projectId: str
    revision: int
    spec: CadPartSpec | CadProgramSpec | CadAssemblySpec
    inspection: CadInspection


def _response(record: CadRevision) -> CadProjectResponse:
    artifact = record.artifact
    return CadProjectResponse(
        projectId=record.project_id,
        revision=record.revision,
        spec=record.spec,
        inspection=CadInspection(
            partId=record.spec.partId,
            solidCount=artifact.solid_count,
            volumeMm3=artifact.volume_mm3,
            boundsMm=artifact.bounds_mm,
            stepBytes=len(artifact.step),
            mechanicalStatus=("verified" if record.spec.mechanics else "unverified") if isinstance(record.spec, CadAssemblySpec) else None,
        ),
    )


def _not_found(exc: CadProjectNotFoundError | CadRevisionNotFoundError) -> HTTPException:
    code = "CAD_PROJECT_NOT_FOUND" if isinstance(exc, CadProjectNotFoundError) else "CAD_REVISION_NOT_FOUND"
    message = "CAD project was not found." if isinstance(exc, CadProjectNotFoundError) else "CAD revision was not found."
    return api_error(404, code, message)


@router.post("", response_model=CadProjectResponse, response_model_exclude_none=True, status_code=201)
def create_cad_project(
    body: CreateCadProjectRequest,
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CadProjectResponse:
    artifact = build_cad_artifact(body.spec, settings)
    return _response(store.create(body.spec, artifact))


@router.get("/{project_id}", response_model=CadProjectResponse, response_model_exclude_none=True)
def get_cad_project(
    project_id: str,
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
) -> CadProjectResponse:
    try:
        return _response(store.current(project_id))
    except CadProjectNotFoundError as exc:
        raise _not_found(exc) from exc


@router.post("/{project_id}/plans", response_model=CadProjectResponse, response_model_exclude_none=True)
def apply_cad_plan_endpoint(
    project_id: str,
    body: ApplyCadPlanRequest,
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CadProjectResponse:
    try:
        current = store.current(project_id)
        if current.revision != body.expectedRevision:
            raise RevisionConflictError(project_id, body.expectedRevision, current.revision)
        if not isinstance(current.spec, CadPartSpec):
            raise api_error(422, "CAD_PLAN_UNSUPPORTED", "Use CAD program revisions for this project")
        candidate = apply_cad_plan(current.spec, body.plan)
        artifact = build_cad_artifact(candidate, settings)
        return _response(store.commit(project_id, body.expectedRevision, candidate, artifact))
    except (CadProjectNotFoundError, CadRevisionNotFoundError) as exc:
        raise _not_found(exc) from exc
    except CadMutationError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc)) from exc


@router.post("/{project_id}/spec", response_model=CadProjectResponse, response_model_exclude_none=True)
def replace_cad_spec_endpoint(
    project_id: str,
    body: ReplaceCadSpecRequest,
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CadProjectResponse:
    try:
        current = store.current(project_id)
        if current.revision != body.expectedRevision:
            raise RevisionConflictError(project_id, body.expectedRevision, current.revision)
        if body.spec.partId != current.spec.partId:
            raise api_error(422, "CAD_PART_ID_CHANGED", "Part ID cannot change in a saved CAD project")
        if type(body.spec) is not type(current.spec):
            raise api_error(422, "CAD_SPEC_TYPE_CHANGED", "CAD project format cannot change")
        artifact = build_cad_artifact(body.spec, settings)
        return _response(store.commit(project_id, body.expectedRevision, body.spec, artifact))
    except (CadProjectNotFoundError, CadRevisionNotFoundError) as exc:
        raise _not_found(exc) from exc


@router.get("/{project_id}/revisions/{revision}", response_model=CadProjectResponse, response_model_exclude_none=True)
def get_cad_revision(
    project_id: str,
    revision: Annotated[int, Path(ge=0)],
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
) -> CadProjectResponse:
    try:
        return _response(store.revision(project_id, revision))
    except (CadProjectNotFoundError, CadRevisionNotFoundError) as exc:
        raise _not_found(exc) from exc


@router.get("/{project_id}/revisions/{revision}/step")
def download_cad_revision_step(
    project_id: str,
    revision: Annotated[int, Path(ge=0)],
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
) -> Response:
    try:
        record = store.revision(project_id, revision)
    except (CadProjectNotFoundError, CadRevisionNotFoundError) as exc:
        raise _not_found(exc) from exc
    return Response(
        content=record.artifact.step,
        media_type="application/step",
        headers={"Content-Disposition": f'attachment; filename="{record.spec.partId}-r{revision}.step"'},
    )


@router.get("/{project_id}/revisions/{revision}/stl")
def download_cad_revision_stl(
    project_id: str,
    revision: Annotated[int, Path(ge=0)],
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    try:
        record = store.revision(project_id, revision)
    except (CadProjectNotFoundError, CadRevisionNotFoundError) as exc:
        raise _not_found(exc) from exc
    try:
        stl = stl_from_saved_step(record.artifact.step, settings.max_artifact_bytes)
    except CadEngineUnavailableError as exc:
        raise api_error(503, "CAD_ENGINE_UNAVAILABLE", str(exc)) from exc
    except CadArtifactTooLargeError as exc:
        raise api_error(413, "COMPLEXITY_LIMIT", str(exc)) from exc
    except CadGeometryError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc)) from exc
    return Response(content=stl, media_type="model/stl",
                    headers={"Content-Disposition": f'attachment; filename="{record.spec.partId}-r{revision}.stl"'})


@router.get("/{project_id}/revisions/{revision}/components/{component_id}/{format}")
def download_cad_component(
    project_id: str,
    revision: Annotated[int, Path(ge=0)],
    component_id: str,
    format: Literal["stl", "step"],
    store: Annotated[CadProjectStore, Depends(get_cad_project_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    try:
        record = store.revision(project_id, revision)
    except (CadProjectNotFoundError, CadRevisionNotFoundError) as exc:
        raise _not_found(exc) from exc
    if not isinstance(record.spec, CadAssemblySpec):
        raise api_error(422, "CAD_SPEC_TYPE_CHANGED", "This CAD revision is not an assembly")
    index = next((index for index, item in enumerate(record.spec.components) if item.id == component_id), None)
    if index is None:
        raise api_error(404, "CAD_COMPONENT_NOT_FOUND", "CAD component was not found")
    try:
        solid = component_from_saved_step(record.artifact.step, index)
        content = stl_from_shape(solid, settings.max_artifact_bytes) if format == "stl" else step_from_shape(solid, settings.max_artifact_bytes)
    except CadEngineUnavailableError as exc:
        raise api_error(503, "CAD_ENGINE_UNAVAILABLE", str(exc)) from exc
    except CadArtifactTooLargeError as exc:
        raise api_error(413, "COMPLEXITY_LIMIT", str(exc)) from exc
    except CadGeometryError as exc:
        raise api_error(422, "CAD_GEOMETRY_INVALID", str(exc)) from exc
    return Response(content=content, media_type="model/stl" if format == "stl" else "application/step",
                    headers={"Content-Disposition": f'attachment; filename="{record.spec.partId}-{component_id}-r{revision}.{format}"'})
