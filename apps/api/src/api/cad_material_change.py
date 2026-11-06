"""Detect real feature effects without scaling away details on large stock."""

from __future__ import annotations

import math
from typing import Any, Literal


def changes_material(before: Any, after: Any, operation: Literal["union", "cut"]) -> bool:
    old_volume, new_volume = before.Volume(), after.Volume()
    if not all(math.isfinite(value) and value > 0 for value in (old_volume, new_volume)):
        return False
    delta = new_volume - old_volume if operation == "union" else old_volume - new_volume
    if delta > max(1e-6, old_volume * 1e-9):
        return True
    # Subtracting two large volume scalars loses precision and a relative
    # threshold would reject small, legitimate details. Only on this slow path,
    # measure the actual added/removed B-rep material in its own volume scale.
    changed = after.cut(before) if operation == "union" else before.cut(after)
    volume = changed.Volume()
    return bool(changed.isValid() and math.isfinite(volume) and volume > 1e-9)
