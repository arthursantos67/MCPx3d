import pytest
from domain.model_plan import CreateObject, ModelPlan
from domain.model_spec import Material, ModelObject, ModelSpec, Scene, Transform

from api.mutation import apply_plan
from api.overlap import (
    MAX_REPORTED_OVERLAPS,
    UnintendedOverlapError,
    bounds_for,
    find_unintended_overlaps,
    resolve_unintended_overlaps,
    validate_no_unintended_overlap,
)


def _spec(*objects: ModelObject) -> ModelSpec:
    return ModelSpec(
        schemaVersion="1.0",
        projectId="prj_test",
        revision=1,
        units="mm",
        scene=Scene(displayScale=1.0),
        objects=list(objects),
    )


def _object(
    object_id: str, size: tuple[float, float, float], position: tuple[float, float, float]
) -> ModelObject:
    return ModelObject(
        id=object_id,
        name=object_id.replace("_", " ").title(),
        kind="box",
        dimensions={"width": size[0], "height": size[1], "depth": size[2]},
        transform=Transform(position=position, rotation=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)),
        material=Material(color="#cccccc"),
    )


def _create(object_id: str, size: tuple[float, float, float], position: tuple[float, float, float]) -> CreateObject:
    return CreateObject(
        id=object_id,
        name=object_id.replace("_", " ").title(),
        kind="box",
        dimensions={"width": size[0], "height": size[1], "depth": size[2]},
        position=position,
        color="#cccccc",
    )


def _plan(*operations: CreateObject) -> ModelPlan:
    return ModelPlan(intent="test", operations=list(operations))


COUNTERTOP = _object("countertop", (600.0, 30.0, 600.0), (0.0, 885.0, 0.0))


def test_every_penetrating_pair_is_reported_in_one_error() -> None:
    plan = _plan(
        _create("sink", (400.0, 20.0, 350.0), (0.0, 885.0, 0.0)),
        _create("stove", (600.0, 900.0, 600.0), (2000.0, 450.0, 0.0)),
        _create("lower_cabinet", (600.0, 870.0, 600.0), (2300.0, 435.0, 0.0)),
    )
    candidate = apply_plan(_spec(COUNTERTOP), plan)

    with pytest.raises(UnintendedOverlapError) as raised:
        validate_no_unintended_overlap(candidate, plan)

    message = str(raised.value)
    assert "'Countertop' (countertop) intersects 'Sink' (sink)" in message
    assert "'Stove' (stove) intersects 'Lower Cabinet' (lower_cabinet)" in message
    assert len(raised.value.pairs) == 2


def test_the_report_is_bounded() -> None:
    plan = _plan(*[_create(f"part_{index}", (100.0, 100.0, 100.0), (0.0, 50.0, 0.0)) for index in range(6)])
    candidate = apply_plan(_spec(), plan)

    with pytest.raises(UnintendedOverlapError) as raised:
        validate_no_unintended_overlap(candidate, plan)

    assert len(raised.value.pairs) == 15
    assert f"(and {15 - MAX_REPORTED_OVERLAPS} more)" in str(raised.value)


def test_resolution_moves_only_new_parts_by_the_smallest_upward_or_sideways_step() -> None:
    previous = _spec(COUNTERTOP)
    plan = _plan(_create("sink", (400.0, 20.0, 350.0), (0.0, 880.0, 0.0)))
    candidate = apply_plan(previous, plan)

    resolved, fixes = resolve_unintended_overlaps(previous, candidate, plan)

    assert find_unintended_overlaps(resolved, plan) == []
    countertop, sink = resolved.objects
    assert countertop.transform.position == (0.0, 885.0, 0.0)
    assert bounds_for(sink).minimum[1] == pytest.approx(bounds_for(countertop).maximum[1])
    assert fixes == [{"type": "overlap_separation", "objectId": "sink", "offset": [0.0, 30.0, 0.0], "separatedFrom": ["countertop"]}]


def test_resolution_never_pushes_a_part_down_through_the_floor() -> None:
    previous = _spec(_object("floor", (6000.0, 20.0, 6000.0), (0.0, -10.0, 0.0)))
    plan = _plan(
        _create("upper_cabinet", (600.0, 700.0, 350.0), (0.0, 1800.0, 0.0)),
        _create("hood", (600.0, 400.0, 350.0), (0.0, 1500.0, 0.0)),
    )
    candidate = apply_plan(previous, plan)

    resolved, fixes = resolve_unintended_overlaps(previous, candidate, plan)

    assert find_unintended_overlaps(resolved, plan) == []
    assert all(fix["offset"][1] >= 0 for fix in fixes)  # type: ignore[index]
    assert all(bounds_for(obj).minimum[1] >= -20.0 for obj in resolved.objects)


def test_a_chain_of_new_overlaps_is_resolved_deterministically() -> None:
    previous = _spec()
    plan = _plan(*[_create(f"cabinet_{index}", (600.0, 870.0, 600.0), (index * 500.0, 435.0, 0.0)) for index in range(6)])
    candidate = apply_plan(previous, plan)

    first, first_fixes = resolve_unintended_overlaps(previous, candidate, plan)
    second, second_fixes = resolve_unintended_overlaps(previous, candidate, plan)

    assert find_unintended_overlaps(first, plan) == []
    assert first == second
    assert first_fixes == second_fixes


def test_overlaps_between_committed_parts_are_never_moved() -> None:
    previous = _spec(COUNTERTOP, _object("old_sink", (400.0, 20.0, 350.0), (0.0, 885.0, 0.0)))
    plan = _plan(_create("stool", (400.0, 700.0, 400.0), (2000.0, 350.0, 0.0)))
    candidate = apply_plan(previous, plan)

    with pytest.raises(UnintendedOverlapError):
        resolve_unintended_overlaps(previous, candidate, plan)
