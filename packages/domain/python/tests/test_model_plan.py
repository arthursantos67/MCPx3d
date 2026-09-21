import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.model_plan import ModelPlan


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_valid_create_plan_parses(fixtures_dir: Path) -> None:
    plan = ModelPlan.model_validate(_load(fixtures_dir / "model-plan" / "valid-create.json"))

    assert plan.operations[0].op == "create_object"


def test_valid_modify_plan_targets_existing_ids(fixtures_dir: Path) -> None:
    plan = ModelPlan.model_validate(_load(fixtures_dir / "model-plan" / "valid-modify.json"))

    targets = {op.target for op in plan.operations}  # type: ignore[attr-defined]
    assert targets == {"obj_leg1", "obj_seat1", "obj_sphere1"}


def test_unknown_operation_is_rejected(fixtures_dir: Path) -> None:
    with pytest.raises(ValidationError):
        ModelPlan.model_validate(_load(fixtures_dir / "model-plan" / "invalid-unknown-operation.json"))


def test_executable_code_field_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ModelPlan.model_validate(
            {
                "intent": "modify_model",
                "operations": [{"op": "set_material", "target": "obj_1", "script": "eval('1')"}],
            }
        )


@pytest.mark.parametrize(
    "operation",
    [
        {"op": "delete_object"},
        {"op": "set_dimensions", "target": "obj_1"},
        {"op": "clarify"},
        {"op": "set_material", "target": "obj_1"},
    ],
)
def test_operation_specific_target_requirements(operation: dict) -> None:
    with pytest.raises(ValidationError):
        ModelPlan.model_validate({"intent": "modify_model", "operations": [operation]})


def test_clarify_and_no_change_do_not_require_a_target() -> None:
    plan = ModelPlan.model_validate(
        {
            "intent": "modify_model",
            "operations": [
                {"op": "clarify", "question": "Which leg do you mean?"},
                {"op": "no_change", "reason": "Nothing to do."},
            ],
        }
    )

    assert [op.op for op in plan.operations] == ["clarify", "no_change"]
