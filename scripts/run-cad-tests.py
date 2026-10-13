"""Run a small native test selection in a disposable process with hard limits."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from api.process_limits import limit_process_memory


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--memory-mb", type=int, default=1536)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("tests", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not 512 <= args.memory_mb <= 4096 or not 1 <= args.timeout <= 600 or not args.tests:
        parser.error("Supply a test selection, memory 512–4096 MB and timeout 1–600 seconds")
    limit_process_memory(args.memory_mb)
    root = Path(__file__).resolve().parents[1]
    temporary = root / ".cache" / "temp"
    temporary.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "TEMP": str(temporary), "TMP": str(temporary), "CAD_KERNEL_THREADS": "1",
           "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"}
    process = subprocess.Popen([sys.executable, "-u", "-m", "pytest", *args.tests], cwd=root, env=env,
                               start_new_session=sys.platform != "win32")
    try:
        return process.wait(timeout=args.timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
        else:
            import signal

            os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        print("Native test process stopped at its time limit or by cancellation.", file=sys.stderr)
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
