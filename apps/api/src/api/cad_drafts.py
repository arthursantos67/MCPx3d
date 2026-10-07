from __future__ import annotations

import io
import json
import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any, Literal
from zipfile import ZIP_DEFLATED, ZipFile

from domain.cad_assembly import CadComponent, CadMechanics
from domain.cad_program import CadProgramSpec, Vector3
from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.cad_adapter import CadArtifactTooLargeError, CadGeometryError
from api.cad_assembly_adapter import _position_component, export_assembly_solids
from api.cad_mesh import preview_tessellation
from api.cad_program_adapter import _engine, build_program_solid
from api.cad_stl import stl_from_saved_step

Identifier = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class CadDraftAssembly(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schemaVersion: Literal["4.0"]
    units: Literal["mm"]
    partId: Identifier
    components: list[CadComponent] = Field(min_length=1, max_length=8)
    mechanics: CadMechanics | None = None

    @model_validator(mode="after")
    def unique_components(self) -> CadDraftAssembly:
        if len({component.id for component in self.components}) != len(self.components):
            raise ValueError("Draft component IDs must be unique")
        if sum(len(component.steps) for component in self.components) > 128:
            raise ValueError("CAD draft exceeds 128 construction steps")
        return self


CadDraftSpec = Annotated[CadProgramSpec | CadDraftAssembly, Field(discriminator="schemaVersion")]


class CadDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    spec: CadDraftSpec
    request: str = Field(default="", max_length=50_000)
    plannedComponentIds: list[Identifier] = Field(default_factory=list, max_length=8)
    pendingComponentId: Identifier | None = None
    issue: str | None = Field(default=None, max_length=120_000)


@dataclass
class DraftBody:
    id: str
    solid: Any | None
    completed_steps: list[str]
    omitted_steps: list[str]
    issue: str | None


@lru_cache(maxsize=6)
def _draft_geometry(serialized: str) -> list[DraftBody]:
    request = CadDraftRequest.model_validate_json(serialized)
    spec = request.spec
    components = spec.components if isinstance(spec, CadDraftAssembly) else [
        CadComponent(id=spec.partId, position=Vector3(x=0, y=0, z=0), steps=spec.steps)]
    bodies = []
    for component in components:
        last: dict[str, Any] = {"solid": None, "count": 0}

        def capture(index: int, part: Any, progress: dict[str, Any] = last) -> None:
            solid = part.solids().val()
            if not solid.isValid() or not math.isfinite(solid.Volume()) or solid.Volume() <= 0:
                raise CadGeometryError("Draft progress contains an invalid solid")
            progress.update(solid=solid.copy(), count=index + 1)

        issue = None
        try:
            program = CadProgramSpec(schemaVersion="3.0", units="mm", partId=component.id, steps=component.steps)
            build_program_solid(program, on_step=capture)
        except CadGeometryError as exc:
            issue = str(exc)
        solid = _position_component(component, last["solid"]) if last["solid"] is not None else None
        bodies.append(DraftBody(component.id, solid,
            [step.id for step in component.steps[:last["count"]]],
            [step.id for step in component.steps[last["count"]:]], issue))
    return bodies


def draft_geometry(request: CadDraftRequest) -> list[DraftBody]:
    geometry = _draft_geometry(CadDraftRequest(spec=request.spec).model_dump_json())
    return [DraftBody(body.id, body.solid.copy() if body.solid is not None else None,
                      list(body.completed_steps), list(body.omitted_steps), body.issue) for body in geometry]


def draft_report(request: CadDraftRequest, bodies: list[DraftBody], exported: bool = False) -> dict[str, Any]:
    available = {body.id for body in bodies if body.solid is not None}
    missing = [component_id for component_id in request.plannedComponentIds if component_id not in available]
    return {"schemaVersion": "1.0", "status": "draft", "units": "mm", "partId": request.spec.partId,
        "assemblyValidation": "not_run", "geometryValidation": "step_roundtrip_verified" if exported else "solid_verified",
        "partial": bool(missing or any(body.omitted_steps for body in bodies)),
        "sourceIssue": request.issue, "request": request.request, "pendingComponentId": request.pendingComponentId, "missingPlannedComponents": missing,
        "message": "Rascunho sem aprovação de montagem. Interferências, vínculos e funcionamento não verificados. Etapas omitidas estão listadas; o JSON original foi conservado.",
        "components": [{"id": body.id, "status": "omitted" if body.solid is None else "partial" if body.omitted_steps else "complete",
                        "completedStepIds": body.completed_steps, "omittedStepIds": body.omitted_steps,
                        "issue": body.issue} for body in bodies]}


def draft_mesh(request: CadDraftRequest, bodies: list[DraftBody]) -> dict[str, Any]:
    valid = [body for body in bodies if body.solid is not None]
    vertices: list[list[float]] = []
    triangles: list[list[int]] = []
    components: list[dict[str, Any]] = []
    for body, (points, faces) in zip(valid, preview_tessellation([body.solid for body in valid]), strict=True):
        offset = len(vertices)
        vertices.extend([[point.x, point.y, point.z] for point in points])
        triangles.extend([[a + offset, b + offset, c + offset] for a, b, c in faces])
        solid = body.solid
        assert solid is not None
        components.append({"id": body.id, "triangles": len(faces), "volumeMm3": solid.Volume()})
    box = _engine().Compound.makeCompound([body.solid for body in valid]).BoundingBox()
    return {"vertices": vertices, "triangles": triangles, "components": components,
            "boundsMm": [box.xlen, box.ylen, box.zlen], "draftReport": draft_report(request, bodies)}


def draft_bundle(request: CadDraftRequest, bodies: list[DraftBody], max_bytes: int) -> bytes:
    valid = [body for body in bodies if body.solid is not None]
    artifact = export_assembly_solids([body.solid for body in valid], [body.id for body in valid], max_bytes)
    files = {f"{request.spec.partId}-draft.step": artifact.step,
             f"{request.spec.partId}-draft.stl": stl_from_saved_step(artifact.step, max_bytes),
             "original-draft.json": request.spec.model_dump_json(indent=2, exclude_unset=True).encode(),
             "report.json": json.dumps(draft_report(request, bodies, exported=True), ensure_ascii=False, indent=2).encode()}
    if len(valid) > 1:
        for body in valid:
            component = export_assembly_solids([body.solid], [body.id], max_bytes)
            files[f"components/{body.id}.step"] = component.step
            files[f"components/{body.id}.stl"] = stl_from_saved_step(component.step, max_bytes)
    if sum(len(data) for data in files.values()) > max_bytes * 3:
        raise CadArtifactTooLargeError("Draft bundle exceeds the total uncompressed size limit")
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    if output.tell() > max_bytes:
        raise CadArtifactTooLargeError("Draft ZIP exceeds the configured artifact size limit")
    return output.getvalue()
