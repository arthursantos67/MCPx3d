"""Run API tests sequentially in fresh processes to release native CAD memory."""

import argparse
import os
import signal
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", choices=("all", "core", "cad"), default="all")
    parser.add_argument("--shard", default="1/1", help="One-based shard, e.g. 1/2")
    parser.add_argument("--timeout", type=int, default=900, help="Seconds per file")
    args = parser.parse_args()
    try:
        index, total = (int(value) for value in args.shard.split("/"))
        if not 1 <= index <= total or args.timeout < 1:
            raise ValueError
    except ValueError:
        parser.error("Use --shard INDEX/TOTAL with 1 <= INDEX <= TOTAL and a positive timeout")

    root = Path(__file__).resolve().parents[1]
    files = sorted((root / "apps" / "api" / "tests").glob("test_*.py"))
    if args.group != "all":
        files = [path for path in files if path.name.startswith("test_cad_") == (args.group == "cad")]
    files = files[index - 1::total]
    if not files:
        parser.error("The selection contains no test files")
    env = {**os.environ, "CAD_KERNEL_THREADS": "1", "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"}
    for path in files:
        print(f"\nRunning {path.relative_to(root)}", flush=True)
        process = subprocess.Popen(
                [sys.executable, "-m", "pytest", str(path), "-q"],
                cwd=root / "apps" / "api", env=env, start_new_session=sys.platform != "win32",
        )
        try:
            code = process.wait(timeout=args.timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            print(f"Test file timed out or was interrupted: {path.name}", file=sys.stderr)
            return 124
        if code:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
