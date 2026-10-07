from importlib import import_module
from threading import Lock

from api.config import get_settings

_lock = Lock()
_configured = False


def configure_cad_kernel() -> None:
    global _configured
    if _configured:
        return
    with _lock:
        if _configured:
            return
        osd = import_module("OCP.OSD")
        count = get_settings().cad_kernel_threads
        pool = osd.OSD_ThreadPool.DefaultPool_s(count)
        if pool.NbThreads() != count:
            pool.Init(count)
        pool.SetNbDefaultThreadsToLaunch(count)
        osd.OSD_Parallel.SetUseOcctThreads_s(True)
        _configured = True
