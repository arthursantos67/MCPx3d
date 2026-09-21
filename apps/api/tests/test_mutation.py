import pytest
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
)
from domain.model_spec import Material, ModelObject, ModelSpec, Scene, Transform

from api.mutation import (
    DuplicateObjectIdError,
    InvalidDimensionsError,
    UnknownTargetError,
    apply_plan,
)


def _spec(*objects: ModelObject) -> ModelSpec:
    return ModelSpec(
        schemaVersion="1.0",
        projectId="prj_test",
        revision=3,
        units="mm",
        scene=Scene(background="#cccccc", displayScale=1.0),
        objects=list(objects),
    )


def _box(
    object_id: str = "obj_cube1",
    *,
    name: str = "Cube",
    position: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
    color: str = "#ff0000",
) -> ModelObject:
    return ModelObject(
        id=object_id,
        name=name,
        kind="box",
        dimensions={"width": 40.0, "height": 40.0, "depth": 40.0},
        transform=Transform(position=position, rotation=rotation, scale=scale),
        material=Material(color=color),
    )


def _plan(*operations: object) -> ModelPlan:
    return ModelPlan(intent="test", operations=list(operations))  # type: ignore[arg-type]


def test_create_object_with_explicit_id_and_all_fields() -> None:
    spec = _spec()
    plan = _plan(
        CreateObject(
            id="obj_new",
            name="New Box",
            kind="box",
            dimensions={"width": 10.0, "height": 20.0, "depth": 30.0},
            position=(1.0, 2.0, 3.0),
            rotation=(0.1, 0.2, 0.3),
            color="#00ff00",
            tags=["a", "b"],
        )
    )

    result = apply_plan(spec, plan)

    assert len(result.objects) == 1
    obj = result.objects[0]
    assert obj.id == "obj_new"
    assert obj.name == "New Box"
    assert obj.dimensions == {"width": 10.0, "height": 20.0, "depth": 30.0}
    assert obj.transform.position == (1.0, 2.0, 3.0)
    assert obj.transform.rotation == (0.1, 0.2, 0.3)
    assert obj.transform.scale == (1.0, 1.0, 1.0)
    assert obj.material.color == "#00ff00"
    assert obj.tags == ["a", "b"]


def test_create_object_generates_id_when_omitted() -> None:
    spec = _spec()
    plan = _plan(
        CreateObject(
            name="Box",
            kind="box",
            dimensions={"width": 1.0, "height": 1.0, "depth": 1.0},
        )
    )

    result = apply_plan(spec, plan)

    assert len(result.objects) == 1
    assert result.objects[0].id


def test_create_object_defaults_transform_and_material_when_omitted() -> None:
    spec = _spec()
    plan = _plan(
        CreateObject(
            id="obj_new", name="Box", kind="sphere", dimensions={"radius": 5.0}
        )
    )

    result = apply_plan(spec, plan)

    obj = result.objects[0]
    assert obj.transform.position == (0.0, 0.0, 0.0)
    assert obj.transform.rotation == (0.0, 0.0, 0.0)
    assert obj.transform.scale == (1.0, 1.0, 1.0)
    assert obj.material.color == "#808080"


def test_create_object_rejects_wrong_dimension_keys_for_kind() -> None:
    spec = _spec()
    plan = _plan(
        CreateObject(
            id="obj_new",
            name="Box",
            kind="sphere",
            dimensions={"radius": 5.0, "height": 1.0},
        )
    )

    with pytest.raises(InvalidDimensionsError):
        apply_plan(spec, plan)


def test_create_object_rejects_duplicate_id() -> None:
    spec = _spec(_box())
    plan = _plan(
        CreateObject(
            id="obj_cube1",
            name="Dup",
            kind="box",
            dimensions={"width": 1.0, "height": 1.0, "depth": 1.0},
        )
    )

    with pytest.raises(DuplicateObjectIdError):
        apply_plan(spec, plan)


def test_delete_object_removes_it() -> None:
    spec = _spec(_box("obj_a"), _box("obj_b"))
    plan = _plan(DeleteObject(target="obj_a"))

    result = apply_plan(spec, plan)

    assert [obj.id for obj in result.objects] == ["obj_b"]


def test_delete_object_unknown_target_raises() -> None:
    spec = _spec(_box("obj_a"))
    plan = _plan(DeleteObject(target="does_not_exist"))

    with pytest.raises(UnknownTargetError):
        apply_plan(spec, plan)


def test_duplicate_object_without_offset_copies_transform() -> None:
    spec = _spec(_box("obj_a", position=(1.0, 2.0, 3.0)))
    plan = _plan(DuplicateObject(target="obj_a", newId="obj_b"))

    result = apply_plan(spec, plan)

    by_id = {obj.id: obj for obj in result.objects}
    assert by_id["obj_b"].transform.position == (1.0, 2.0, 3.0)
    assert by_id["obj_b"].name == by_id["obj_a"].name
    assert by_id["obj_b"].dimensions == by_id["obj_a"].dimensions


def test_duplicate_object_with_offset_shifts_position() -> None:
    spec = _spec(_box("obj_a", position=(1.0, 2.0, 3.0)))
    plan = _plan(
        DuplicateObject(target="obj_a", newId="obj_b", offset=(10.0, 0.0, 0.0))
    )

    result = apply_plan(spec, plan)

    by_id = {obj.id: obj for obj in result.objects}
    assert by_id["obj_b"].transform.position == (11.0, 2.0, 3.0)
    assert by_id["obj_a"].transform.position == (1.0, 2.0, 3.0)


def test_duplicate_object_rejects_existing_new_id() -> None:
    spec = _spec(_box("obj_a"), _box("obj_b"))
    plan = _plan(DuplicateObject(target="obj_a", newId="obj_b"))

    with pytest.raises(DuplicateObjectIdError):
        apply_plan(spec, plan)


def test_set_dimensions_replaces_absolutely() -> None:
    spec = _spec(_box("obj_a"))
    plan = _plan(
        SetDimensions(
            target="obj_a", dimensions={"width": 99.0, "height": 1.0, "depth": 1.0}
        )
    )

    result = apply_plan(spec, plan)

    assert result.objects[0].dimensions == {"width": 99.0, "height": 1.0, "depth": 1.0}


def test_set_dimensions_rejects_wrong_keys_for_target_kind() -> None:
    spec = _spec(_box("obj_a"))
    plan = _plan(SetDimensions(target="obj_a", dimensions={"radius": 1.0}))

    with pytest.raises(InvalidDimensionsError):
        apply_plan(spec, plan)


def test_translate_object_is_relative() -> None:
    spec = _spec(_box("obj_a", position=(1.0, 1.0, 1.0)))
    plan = _plan(TranslateObject(target="obj_a", delta=(1.0, -1.0, 2.0)))

    result = apply_plan(spec, plan)

    assert result.objects[0].transform.position == (2.0, 0.0, 3.0)


def test_rotate_object_is_relative() -> None:
    spec = _spec(_box("obj_a", rotation=(0.1, 0.0, 0.0)))
    plan = _plan(RotateObject(target="obj_a", delta=(0.1, 0.2, 0.0)))

    result = apply_plan(spec, plan)

    position = result.objects[0].transform.rotation
    assert position[0] == pytest.approx(0.2)
    assert position[1] == pytest.approx(0.2)
    assert position[2] == pytest.approx(0.0)


def test_scale_object_is_multiplicative() -> None:
    spec = _spec(_box("obj_a", scale=(2.0, 1.0, 1.0)))
    plan = _plan(ScaleObject(target="obj_a", factor=(2.0, 3.0, 1.0)))

    result = apply_plan(spec, plan)

    assert result.objects[0].transform.scale == (4.0, 3.0, 1.0)


def test_set_material_updates_color_only() -> None:
    spec = _spec(_box("obj_a", color="#ff0000"))
    plan = _plan(SetMaterial(target="obj_a", color="#0000ff"))

    result = apply_plan(spec, plan)

    assert result.objects[0].material.color == "#0000ff"
    assert result.objects[0].material.transparency is None


def test_set_material_updates_transparency_only_preserves_color() -> None:
    spec = _spec(_box("obj_a", color="#ff0000"))
    plan = _plan(SetMaterial(target="obj_a", transparency=0.5))

    result = apply_plan(spec, plan)

    assert result.objects[0].material.color == "#ff0000"
    assert result.objects[0].material.transparency == 0.5


def test_rename_object() -> None:
    spec = _spec(_box("obj_a", name="Old Name"))
    plan = _plan(RenameObject(target="obj_a", name="New Name"))

    result = apply_plan(spec, plan)

    assert result.objects[0].name == "New Name"
    assert result.objects[0].id == "obj_a"


def test_set_scene_updates_only_given_fields() -> None:
    spec = _spec()
    plan = _plan(SetScene(displayScale=2.0))

    result = apply_plan(spec, plan)

    assert result.scene.displayScale == 2.0
    assert result.scene.background == "#cccccc"


def test_clarify_and_no_change_do_not_mutate() -> None:
    spec = _spec(_box("obj_a"))

    clarified = apply_plan(spec, _plan(Clarify(question="which one?")))
    unchanged = apply_plan(spec, _plan(NoChange(reason="already correct")))

    assert clarified.objects == spec.objects
    assert unchanged.objects == spec.objects


def test_unknown_target_does_not_mutate_original_spec() -> None:
    spec = _spec(_box("obj_a"))
    original_objects = list(spec.objects)
    plan = _plan(RenameObject(target="does_not_exist", name="New Name"))

    with pytest.raises(UnknownTargetError):
        apply_plan(spec, plan)

    assert spec.objects == original_objects


def test_failed_operation_rolls_back_whole_plan() -> None:
    spec = _spec(_box("obj_a"))
    original_objects = list(spec.objects)
    plan = _plan(
        CreateObject(
            id="obj_new",
            name="New",
            kind="box",
            dimensions={"width": 1.0, "height": 1.0, "depth": 1.0},
        ),
        DeleteObject(target="does_not_exist"),
    )

    with pytest.raises(UnknownTargetError):
        apply_plan(spec, plan)

    assert spec.objects == original_objects
    assert "obj_new" not in [obj.id for obj in spec.objects]


def test_object_ids_are_never_changed_by_mutating_operations() -> None:
    spec = _spec(_box("obj_a"))
    plan = _plan(
        RenameObject(target="obj_a", name="Renamed"),
        SetDimensions(
            target="obj_a", dimensions={"width": 5.0, "height": 5.0, "depth": 5.0}
        ),
        TranslateObject(target="obj_a", delta=(1.0, 1.0, 1.0)),
    )

    result = apply_plan(spec, plan)

    assert result.objects[0].id == "obj_a"


def test_candidate_is_a_new_instance_separate_from_committed_spec() -> None:
    spec = _spec(_box("obj_a"))
    plan = _plan(RenameObject(target="obj_a", name="Renamed"))

    result = apply_plan(spec, plan)

    assert result is not spec
    assert result.revision == spec.revision
    assert spec.objects[0].name == "Cube"
    assert result.objects[0].name == "Renamed"


def test_same_plan_can_target_object_it_just_created() -> None:
    spec = _spec()
    plan = _plan(
        CreateObject(
            id="obj_new",
            name="New",
            kind="box",
            dimensions={"width": 1.0, "height": 1.0, "depth": 1.0},
        ),
        TranslateObject(target="obj_new", delta=(5.0, 0.0, 0.0)),
        RenameObject(target="obj_new", name="Renamed"),
    )

    result = apply_plan(spec, plan)

    assert len(result.objects) == 1
    obj = result.objects[0]
    assert obj.name == "Renamed"
    assert obj.transform.position == (5.0, 0.0, 0.0)
