from typing import Any

import pytest
from pydantic import ValidationError

from api.config import Settings


def test_settings_have_expected_defaults() -> None:
    settings = Settings()

    assert settings.environment == "development"
    assert str(settings.mcp_base_url) == "http://localhost:8000/"
    assert settings.mcp_request_timeout_seconds == 30.0
    assert settings.session_ttl_seconds == 3600
    assert settings.max_objects_per_project == 100
    assert settings.max_operations_per_plan == 100
    assert settings.max_prompt_characters == 8000
    assert settings.cors_allow_origins == ["http://localhost:5173"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("mcp_request_timeout_seconds", 0),
        ("session_ttl_seconds", -1),
        ("max_objects_per_project", 0),
        ("max_operations_per_plan", 0),
        ("max_prompt_characters", 0),
    ],
)
def test_settings_reject_non_positive_limits(field: str, value: int) -> None:
    kwargs: dict[str, Any] = {field: value}
    with pytest.raises(ValidationError):
        Settings(**kwargs)


def test_settings_reject_unknown_environment() -> None:
    with pytest.raises(ValidationError):
        Settings(environment="staging")  # type: ignore[arg-type]
