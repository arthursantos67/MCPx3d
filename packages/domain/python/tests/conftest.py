from pathlib import Path

import pytest

_DOMAIN_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def schemas_dir() -> Path:
    return _DOMAIN_ROOT / "schemas"


@pytest.fixture
def fixtures_dir() -> Path:
    return _DOMAIN_ROOT / "fixtures"
