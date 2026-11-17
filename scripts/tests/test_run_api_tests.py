"""Check CI selection and failure handling without loading native CAD libraries."""

import contextlib
import importlib.util
import io
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "run-api-tests.py"
spec = importlib.util.spec_from_file_location("run_api_tests", SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ApiTestRunnerTests(unittest.TestCase):
    def run_selection(self, *args, code=0):
        process = Mock()
        process.wait.return_value = code
        with patch.object(sys, "argv", [str(SCRIPT), *args]), patch.object(
            runner.subprocess, "Popen", return_value=process
        ) as launch, contextlib.redirect_stdout(io.StringIO()):
            result = runner.main()
        return result, [Path(call.args[0][3]).name for call in launch.call_args_list]

    def test_ci_matrix_covers_every_file_once(self):
        _, all_files = self.run_selection()
        _, core = self.run_selection("--group", "core")
        _, cad_first = self.run_selection("--group", "cad", "--shard", "1/2")
        _, cad_second = self.run_selection("--group", "cad", "--shard", "2/2")
        combined = core + cad_first + cad_second
        self.assertCountEqual(combined, all_files)
        self.assertEqual(len(set(combined)), len(combined))

    def test_nonzero_exit_stops_the_selection(self):
        result, files = self.run_selection(code=7)
        self.assertEqual(result, 7)
        self.assertEqual(len(files), 1)

    def test_case_isolation_launches_each_collected_parameter_once(self):
        cases = ["tests/test_cad_assembly.py::test_pose[left]", "tests/test_cad_assembly.py::test_pose[right]"]
        collection = subprocess.CompletedProcess([], 0, stdout="\n".join(cases) + "\n\n2 tests collected", stderr="")
        with patch.object(runner.subprocess, "run", return_value=collection), patch.object(
            runner.Path, "glob", return_value=[Path("test_cad_assembly.py")]
        ):
            result, launched = self.run_selection("--group", "cad", "--isolate-cases")
        self.assertEqual(result, 0)
        self.assertEqual(launched, [Path(case).name for case in cases])

    def test_isolated_shards_split_cases_within_a_heavy_file_without_losing_coverage(self):
        cases = [f"tests/test_cad_assembly.py::test_pose[{side}]" for side in ("left", "right", "center")]
        collection = subprocess.CompletedProcess([], 0, stdout="\n".join(cases), stderr="")
        with patch.object(runner.subprocess, "run", return_value=collection), patch.object(
            runner.Path, "glob", return_value=[Path("test_cad_assembly.py")]
        ):
            _, first = self.run_selection("--group", "cad", "--shard", "1/2", "--isolate-cases")
            _, second = self.run_selection("--group", "cad", "--shard", "2/2", "--isolate-cases")
        self.assertEqual(first, [Path(cases[0]).name, Path(cases[2]).name])
        self.assertEqual(second, [Path(cases[1]).name])
        self.assertCountEqual(first + second, [Path(case).name for case in cases])

    def test_timeout_stops_the_process_tree(self):
        process = Mock(pid=123)
        process.wait.side_effect = [subprocess.TimeoutExpired("pytest", 1), 0]
        with patch.object(sys, "argv", [str(SCRIPT), "--timeout", "1"]), patch.object(
            runner.subprocess, "Popen", return_value=process
        ), patch.object(runner.subprocess, "run") as kill_windows, patch.object(
            runner.os, "killpg", create=True
        ) as kill_posix, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(runner.main(), 124)
        if sys.platform == "win32":
            self.assertEqual(kill_windows.call_args.args[0], ["taskkill", "/PID", "123", "/T", "/F"])
        else:
            kill_posix.assert_called_once_with(123, runner.signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
