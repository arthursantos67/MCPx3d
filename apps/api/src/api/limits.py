"""Configurable MVP resource guards (PRD FR-32, NFR-12, §11.6, Issue #24).

Every specific limit (prompt length, operation count, object count, artifact
size) raises this one exception type so `error_handlers.py` can map all of
them to PRD §9.4's single `COMPLEXITY_LIMIT` code regardless of which
specific limit tripped.
"""

from __future__ import annotations


class ComplexityLimitError(Exception):
    """A configured MVP resource limit was exceeded."""

    def __init__(self, limit_name: str, *, limit: int, actual: int) -> None:
        super().__init__(f"{limit_name} limit exceeded: {actual} > {limit}")
        self.limit_name = limit_name
        self.limit = limit
        self.actual = actual
