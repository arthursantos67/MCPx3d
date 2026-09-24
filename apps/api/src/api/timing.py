"""Safe, monotonic request-stage timings used by diagnostics and benchmarks."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field


@dataclass
class StageTimer:
    clock: Callable[[], float] = time.perf_counter
    _started: dict[str, float] = field(default_factory=dict)
    _durations: dict[str, int] = field(default_factory=dict)

    def start(self, stage: str) -> None:
        self._started[stage] = self.clock()

    def finish(self, stage: str) -> None:
        started = self._started.pop(stage, None)
        if started is not None:
            self._durations[stage] = max(0, round((self.clock() - started) * 1000))

    @contextmanager
    def measure(self, stage: str) -> Iterator[None]:
        self.start(stage)
        try:
            yield
        finally:
            self.finish(stage)

    def summary(self) -> dict[str, int]:
        return dict(self._durations)

    def add(self, durations: dict[str, int]) -> None:
        self._durations.update(durations)
