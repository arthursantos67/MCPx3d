import asyncio
import json
import sys

import pytest
from fastapi.testclient import TestClient

from api import local_ai
from api.main import app


@pytest.mark.skipif(sys.platform == 'win32', reason='POSIX process groups')
@pytest.mark.anyio
@pytest.mark.parametrize('parent_wait', [0, 10])
async def test_client_timeout_kills_descendants_on_posix(tmp_path, parent_wait):
    marker, started = tmp_path / 'orphan.txt', tmp_path / 'started.txt'
    child = f'import time; from pathlib import Path; time.sleep(2); Path({str(marker)!r}).write_text("orphan")'
    parent = ('import subprocess,sys,time; from pathlib import Path; '
              f'subprocess.Popen([sys.executable,"-c",{child!r}]); '
              f'Path({str(started)!r}).write_text("started"); time.sleep({parent_wait})')
    with pytest.raises(local_ai.LocalAiError, match='tempo'):
        await local_ai.run_client([sys.executable, '-c', parent], tmp_path, timeout=1)
    assert started.exists()
    await asyncio.sleep(2.1)
    assert not marker.exists()


def test_client_environment_never_inherits_api_billing(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-secret")
    monkeypatch.setenv("CLAUDE_CODE_USE_VERTEX", "1")
    monkeypatch.setenv("TASK_TEST_OTHER", "preserved")
    env = local_ai.client_environment()
    assert not {"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_USE_VERTEX"}.intersection(env)
    assert env["TASK_TEST_OTHER"] == "preserved"


def test_native_windows_launcher_avoids_cmd_shell(tmp_path, monkeypatch):
    launcher = tmp_path / "claude.cmd"
    executable = tmp_path / "node_modules/@anthropic-ai/claude-code/bin/claude.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    monkeypatch.setattr(local_ai.shutil, "which", lambda _: str(launcher))
    assert local_ai.client_command("claude") == [str(executable)]


@pytest.mark.parametrize("client", ["codex", "claude"])
def test_generation_has_no_shell_tools_or_user_customizations(client, tmp_path, monkeypatch):
    monkeypatch.setattr(local_ai, "client_command", lambda _: ["official.exe"])
    command = local_ai.generation_command(client, tmp_path, "chosen-model")
    assert command[0] == "official.exe"
    assert command[command.index("--model") + 1] == "chosen-model"
    assert not any("dangerously" in argument for argument in command)
    if client == "codex":
        assert "--ignore-user-config" in command and "read-only" in command
        assert command[command.index("--disable") + 1] == "shell_tool"
        assert command[-1] == "-"
    else:
        assert command[command.index("--tools") + 1] == ""
        assert "--safe-mode" in command and "--bare" not in command
        assert command[command.index("--mcp-config") + 1] == '{"mcpServers":{}}'


def test_codex_rejects_partial_and_tool_responses(tmp_path):
    (tmp_path / "response.json").write_text('{"ok":true}', encoding="utf-8")
    complete = '{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":4}}'
    assert local_ai.parse_result("codex", tmp_path, complete, "", 0)["content"] == '{"ok":true}'
    with pytest.raises(local_ai.LocalAiError, match="completa"):
        local_ai.parse_result("codex", tmp_path, '{"type":"thread.started"}', "", 0)
    with pytest.raises(local_ai.LocalAiError, match="ferramentas"):
        local_ai.parse_result("codex", tmp_path, '{"type":"item.completed","item":{"type":"command_execution"}}\n' + complete, "", 0)


def test_claude_parses_structured_output_and_classifies_quota_without_raw_text(tmp_path):
    payload = {"subtype": "success", "is_error": False, "result": '{"ok":true}'}
    assert local_ai.parse_result("claude", tmp_path, json.dumps(payload), "", 0)["content"] == '{"ok":true}'
    payload = {"subtype": "error", "is_error": True, "result": "usage limit secret-data"}
    with pytest.raises(local_ai.LocalAiError) as error:
        local_ai.parse_result("claude", tmp_path, json.dumps(payload), "", 0)
    assert error.value.code == "CLI_QUOTA"
    assert "secret-data" not in str(error.value)


@pytest.mark.parametrize("client", ["codex", "claude"])
def test_clients_return_direct_json_without_double_encoding(client, tmp_path, monkeypatch):
    monkeypatch.setattr(local_ai, "client_command", lambda _: ["official.exe"])
    command = local_ai.generation_command(client, tmp_path, "chosen-model")
    assert "--json-schema" not in command and "--output-schema" not in command
    value = {"steps": [{"id": f"feature_{index}", "shape": "thread", "diameter": 12, "pitch": 1.75} for index in range(32)], "assumptions": ["Texto com acentuação e aspas: \"M12\"."]}
    content = json.dumps(value, ensure_ascii=False)
    if client == "codex":
        (tmp_path / "response.json").write_text(content, encoding="utf-8")
        output = '{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":4}}'
    else:
        output = json.dumps({"subtype": "success", "is_error": False, "result": content})
    result = local_ai.parse_result(client, tmp_path, output, "", 0)
    assert json.loads(result["content"]) == value
    assert result["content"] == content


@pytest.mark.anyio
async def test_cancelled_preflight_does_not_start_inference(monkeypatch):
    async def authenticated(_client):
        return {"installed": True, "authenticated": True}
    async def disconnected():
        return True
    def forbidden_command(*_args):
        raise AssertionError("Inference must never start after cancellation")
    monkeypatch.setattr(local_ai, "client_status", authenticated)
    monkeypatch.setattr(local_ai, "generation_command", forbidden_command)
    with pytest.raises(local_ai.LocalAiError) as error:
        await local_ai.generate("codex", "", [{"role": "user", "content": "cancelled"}], {}, disconnected)
    assert error.value.code == "CLI_CANCELLED"


@pytest.mark.anyio
async def test_subprocess_stdin_is_data_and_timeout_terminates(tmp_path):
    prompt = '$(echo malicious); `shell` & <user>á</user>'
    command = [sys.executable, "-c", "import sys; print(sys.stdin.read())"]
    code, stdout, _ = await local_ai.run_client(command, tmp_path, prompt=prompt)
    assert code == 0 and stdout.strip() == prompt
    with pytest.raises(local_ai.LocalAiError) as error:
        await local_ai.run_client([sys.executable, "-c", "import time; time.sleep(30)"], tmp_path, timeout=0.2)
    assert error.value.code == "CLI_TIMEOUT"


@pytest.mark.anyio
async def test_disconnect_cancels_native_process(tmp_path):
    async def disconnected():
        return True
    with pytest.raises(local_ai.LocalAiError) as error:
        await local_ai.run_client([sys.executable, "-c", "import time; time.sleep(30)"], tmp_path, disconnected=disconnected)
    assert error.value.code == "CLI_CANCELLED"


@pytest.mark.anyio
async def test_oversized_output_is_rejected_and_pipes_are_drained(tmp_path):
    with pytest.raises(local_ai.LocalAiError) as error:
        await local_ai.run_client([
            sys.executable, "-c", "import sys; sys.stdout.buffer.write(b'x'*5000000); sys.stdout.flush()",
        ], tmp_path, timeout=5)
    assert error.value.code == "CLI_OUTPUT_LIMIT"


def test_subscription_routes_reject_foreign_origins_hosts_and_remote_clients():
    for hostname, address, headers in [
        ("localhost", "192.168.1.2", {}),
        ("attacker.example", "127.0.0.1", {}),
        ("127.0.0.1", "127.0.0.1", {"Origin": "https://attacker.example"}),
    ]:
        with TestClient(app, base_url=f"http://{hostname}", client=(address, 50000)) as client:
            response = client.get("/api/ai/local/status/codex", headers=headers)
            assert response.status_code == 403
            assert response.json()["code"] == "CLI_LOCAL_ONLY"


def test_local_routes_validate_client_and_model_before_process_launch():
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)) as client:
        body = {"client": "codex", "model": "x; echo bad", "messages": [{"role": "user", "content": "test"}], "schema": {}}
        assert client.post("/api/ai/local/generate", json=body).status_code == 400
        assert client.get("/api/ai/local/status/arbitrary-command").status_code == 400


def test_local_route_returns_safe_provider_result(monkeypatch):
    async def fake_generate(client, model, messages, schema, disconnected):
        assert client == "claude" and model == ""
        assert messages == [{"role": "user", "content": "test"}]
        return {"content": '{"ok":true}', "finishReason": "stop"}
    monkeypatch.setattr("api.routes.local_ai.generate", fake_generate)
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)) as client:
        response = client.post("/api/ai/local/generate", json={"client": "claude", "messages": [{"role": "user", "content": "test"}], "schema": {}})
        assert response.status_code == 200
        assert json.loads(response.json()["content"]) == {"ok": True}
