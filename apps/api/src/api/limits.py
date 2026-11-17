"""Configurable resource limits with structured complexity diagnostics."""

from __future__ import annotations


class ComplexityLimitError(Exception):
    """A configured MVP resource limit was exceeded."""

    def __init__(self, limit_name: str, *, limit: int, actual: int) -> None:
        super().__init__(f"{limit_name} limit exceeded: {actual} > {limit}")
        self.limit_name = limit_name
        self.limit = limit
        self.actual = actual
