"""Deterministic ModelPlan -> ModelSpec mutation engine (PRD NFR-07, Issue #7).

`apply_plan` is the only code path that turns an AI-proposed `ModelPlan` into a
new `ModelSpec`. It never executes AI-authored code: each operation is a
closed, schema-validated data shape (see `domain.model_plan`), and this module
interprets that data deterministically.

`apply_plan` never mutates its `spec` argument -- it only reads from it and
returns a new `ModelSpec` candidate. If any operation in the plan fails, a
`MutationError` is raised and the caller's original `spec` is left untouched,
which gives whole-plan rollback for free (PRD §8.4: "A candidate mutation does
not alter authoritative state until X3D validation succeeds").
"""

from __future__ import annotations

import secrets

from domain.model_plan import (
    Clarify,
    CreateObject,
    DeleteObject,
    DuplicateObject,
    ModelPlan,
    NoChange,
    RenameObject,
    RotateObject,
    ScaleObject,
    SetDimensions,
    SetMaterial,
    SetScene,
    TranslateObject,
    Vec3,
)
from domain.model_spec import (
    Material,
    ModelObject,
    ModelSpec,
    PrimitiveKind,
    Scene,
    Transform,
)

_DEFAULT_POSITION: Vec3 = (0.0, 0.0, 0.0)
_DEFAULT_ROTATION: Vec3 = (0.0, 0.0, 0.0)
_DEFAULT_SCALE: Vec3 = (1.0, 1.0, 1.0)
_DEFAULT_MATERIAL_COLOR = "#808080"

_ID_GENERATION_ATTEMPTS = 10

# Kind-specific dimension keys (packages/domain/README.md "Conventions not
# obvious from the schema"), enforced here since the JSON Schema deliberately
# stays renderer-independent and does not check them per kind.
_DIMENSION_KEYS: dict[PrimitiveKind, frozenset[str]] = {
    "box": frozenset({"width", "height", "depth"}),
    "sphere": frozenset({"radius"}),
    "cylinder": frozenset({"radius", "height"}),
    "cone": frozenset({"bottomRadius", "height"}),
}


class MutationError(Exception):
    """Base class for ModelPlan application failures."""


class UnknownTargetError(MutationError):
    """An operation's `target` does not match any object in the ModelSpec."""

    def __init__(self, target: str) -> None:
        super().__init__(f"unknown target: {target}")
        self.target = target


class DuplicateObjectIdError(MutationError):
    """An operation tried to introduce an object id that is already in use."""

    def __init__(self, object_id: str) -> None:
        super().__init__(f"object id already exists: {object_id}")
        self.object_id = object_id


class InvalidDimensionsError(MutationError):
    """A primitive's dimensions do not match the key set its `kind` requires."""

    def __init__(self, kind: PrimitiveKind, dimensions: dict[str, float]) -> None:
        expected = sorted(_DIMENSION_KEYS[kind])
        super().__init__(
            f"{kind} requires dimensions {expected}, got {sorted(dimensions)}"
        )
        self.kind = kind
        self.dimensions = dimensions


def apply_plan(spec: ModelSpec, plan: ModelPlan) -> ModelSpec:
    """Applies every operation in `plan` to `spec`, in order, returning a new candidate.

    `create_object` operations earlier in `plan` may be targeted by later
    operations in the same plan (PRD §8.4), since both read and write go
    through the same working `objects` map as operations are processed.
    """
    objects: dict[str, ModelObject] = {obj.id: obj for obj in spec.objects}
    scene = spec.scene

    for operation in plan.operations:
        match operation:
            case CreateObject():
                _apply_create_object(operation, objects)
            case DeleteObject():
                _apply_delete_object(operation, objects)
            case DuplicateObject():
                _apply_duplicate_object(operation, objects)
            case SetDimensions():
                _apply_set_dimensions(operation, objects)
            case TranslateObject():
                _apply_translate_object(operation, objects)
            case RotateObject():
                _apply_rotate_object(operation, objects)
            case ScaleObject():
                _apply_scale_object(operation, objects)
            case SetMaterial():
                _apply_set_material(operation, objects)
            case RenameObject():
                _apply_rename_object(operation, objects)
            case SetScene():
                scene = _apply_set_scene(operation, scene)
            case Clarify() | NoChange():
                pass  # No ModelSpec mutation by definition.

    return spec.model_copy(update={"objects": list(objects.values()), "scene": scene})


def _lookup_target(objects: dict[str, ModelObject], target: str) -> ModelObject:
    obj = objects.get(target)
    if obj is None:
        raise UnknownTargetError(target)
    return obj


def _check_dimension_keys(kind: PrimitiveKind, dimensions: dict[str, float]) -> None:
    if set(dimensions) != _DIMENSION_KEYS[kind]:
        raise InvalidDimensionsError(kind, dimensions)


def _generate_object_id(objects: dict[str, ModelObject]) -> str:
    for _ in range(_ID_GENERATION_ATTEMPTS):
        candidate = f"obj_{secrets.token_hex(6)}"
        if candidate not in objects:
            return candidate
    raise MutationError("failed to generate a unique object id")


def _apply_create_object(op: CreateObject, objects: dict[str, ModelObject]) -> None:
    _check_dimension_keys(op.kind, op.dimensions)

    if op.id is not None:
        if op.id in objects:
            raise DuplicateObjectIdError(op.id)
        object_id = op.id
    else:
        object_id = _generate_object_id(objects)

    objects[object_id] = ModelObject(
        id=object_id,
        name=op.name,
        kind=op.kind,
        dimensions=op.dimensions,
        transform=Transform(
            position=op.position or _DEFAULT_POSITION,
            rotation=op.rotation or _DEFAULT_ROTATION,
            scale=_DEFAULT_SCALE,
        ),
        material=Material(color=op.color or _DEFAULT_MATERIAL_COLOR),
        tags=op.tags,
    )


def _apply_delete_object(op: DeleteObject, objects: dict[str, ModelObject]) -> None:
    _lookup_target(objects, op.target)
    del objects[op.target]


def _apply_duplicate_object(
    op: DuplicateObject, objects: dict[str, ModelObject]
) -> None:
    source = _lookup_target(objects, op.target)
    if op.newId in objects:
        raise DuplicateObjectIdError(op.newId)

    offset = op.offset or _DEFAULT_POSITION
    new_position = _add_vec3(source.transform.position, offset)

    objects[op.newId] = ModelObject(
        id=op.newId,
        name=source.name,
        kind=source.kind,
        dimensions=dict(source.dimensions),
        transform=Transform(
            position=new_position,
            rotation=source.transform.rotation,
            scale=source.transform.scale,
        ),
        material=source.material.model_copy(),
        tags=list(source.tags) if source.tags is not None else None,
    )


def _replace_object(target: ModelObject, **changes: object) -> ModelObject:
    """Rebuilds `target` with `changes` applied, re-running every field/model validator."""
    return ModelObject(**{**target.model_dump(), **changes})


def _apply_set_dimensions(op: SetDimensions, objects: dict[str, ModelObject]) -> None:
    target = _lookup_target(objects, op.target)
    _check_dimension_keys(target.kind, op.dimensions)
    objects[op.target] = _replace_object(target, dimensions=op.dimensions)


def _apply_translate_object(
    op: TranslateObject, objects: dict[str, ModelObject]
) -> None:
    target = _lookup_target(objects, op.target)
    new_transform = Transform(
        position=_add_vec3(target.transform.position, op.delta),
        rotation=target.transform.rotation,
        scale=target.transform.scale,
    )
    objects[op.target] = _replace_object(target, transform=new_transform)


def _apply_rotate_object(op: RotateObject, objects: dict[str, ModelObject]) -> None:
    target = _lookup_target(objects, op.target)
    new_transform = Transform(
        position=target.transform.position,
        rotation=_add_vec3(target.transform.rotation, op.delta),
        scale=target.transform.scale,
    )
    objects[op.target] = _replace_object(target, transform=new_transform)


def _apply_scale_object(op: ScaleObject, objects: dict[str, ModelObject]) -> None:
    target = _lookup_target(objects, op.target)
    new_transform = Transform(
        position=target.transform.position,
        rotation=target.transform.rotation,
        scale=_mul_vec3(target.transform.scale, op.factor),
    )
    objects[op.target] = _replace_object(target, transform=new_transform)


def _apply_set_material(op: SetMaterial, objects: dict[str, ModelObject]) -> None:
    target = _lookup_target(objects, op.target)
    new_material = Material(
        color=op.color if op.color is not None else target.material.color,
        transparency=op.transparency
        if op.transparency is not None
        else target.material.transparency,
    )
    objects[op.target] = _replace_object(target, material=new_material)


def _apply_rename_object(op: RenameObject, objects: dict[str, ModelObject]) -> None:
    target = _lookup_target(objects, op.target)
    objects[op.target] = _replace_object(target, name=op.name)


def _apply_set_scene(op: SetScene, scene: Scene) -> Scene:
    return Scene(
        background=op.background if op.background is not None else scene.background,
        displayScale=op.displayScale
        if op.displayScale is not None
        else scene.displayScale,
    )


def _add_vec3(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _mul_vec3(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] * b[0], a[1] * b[1], a[2] * b[2])
