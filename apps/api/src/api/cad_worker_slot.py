from __future__ import annotations

import errno
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import Event
from time import monotonic, sleep

from api.errors import api_error


@contextmanager
def cad_worker_slot(path: Path, timeout: float, cancelled: Event | None) -> Iterator[None]:
    """An OS-owned lock bounds native work across API processes on this host.

    A crashed owner releases the lock automatically. The file is intentionally
    retained: deleting it would let new processes lock a different inode.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if os.fstat(handle.fileno()).st_size == 0:
            handle.write(b"\0")
            handle.flush()
        deadline = monotonic() + timeout
        acquired = False
        try:
            while not acquired:
                if cancelled is not None and cancelled.is_set():
                    raise api_error(499, "CAD_ENGINE_CANCELLED", "A espera pelo motor CAD foi cancelada; nenhum cálculo foi iniciado.")
                try:
                    if sys.platform == "win32":
                        import msvcrt

                        handle.seek(0)
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                except OSError as exc:
                    if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                        raise
                    remaining = deadline - monotonic()
                    if remaining <= 0:
                        raise api_error(503, "CAD_ENGINE_BUSY", "O motor CAD está ocupado em outro processo. O rascunho foi conservado; retome após a operação atual.") from exc
                    if cancelled is None:
                        sleep(min(.05, remaining))
                    else:
                        cancelled.wait(min(.05, remaining))
            yield
        finally:
            if acquired:
                if sys.platform == "win32":
                    import msvcrt

                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle, fcntl.LOCK_UN)
