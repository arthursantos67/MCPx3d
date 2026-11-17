"""Run API files or individual cases sequentially in disposable processes."""

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
    parser.add_argument("--isolate-cases", action="store_true", help="Release native memory between individual CAD cases")
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
    selections = []
    for path in files:
        if args.isolate_cases:
            collection = subprocess.run(
                [sys.executable, "-m", "pytest", str(path), "--collect-only", "-q"],
                cwd=root / "apps" / "api", env=env, capture_output=True, text=True, check=False,
                timeout=args.timeout,
            )
            if collection.returncode:
                print(collection.stdout + collection.stderr, file=sys.stderr)
                return collection.returncode
            cases = [line.strip() for line in collection.stdout.splitlines() if line.startswith("tests/") and "::" in line]
            if not cases:
                print(f"No test cases collected from {path.name}", file=sys.stderr)
                return 1
            selections.extend(cases)
        else:
            selections.append(str(path))
    for selection in selections:
        print(f"\nRunning {selection}", flush=True)
        process = subprocess.Popen(
            [sys.executable, "-m", "pytest", selection, "-q"],
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
            print(f"Test selection timed out or was interrupted: {selection}", file=sys.stderr)
            return 124
        if code:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
