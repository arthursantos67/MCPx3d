"""Structured inference through the user's authenticated, official local clients."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal

Client = Literal["codex", "claude"]
ROOT = Path(__file__).resolve().parents[4]
_generation_lock = asyncio.Lock()


class LocalAiError(Exception):
    def __init__(self, code: str, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def client_command(client: Client) -> list[str]:
    executable = shutil.which(client)
    if not executable:
        raise LocalAiError("CLI_NOT_INSTALLED", f"Instale o cliente oficial {client} e reinicie o servidor local.", 503)
    path = Path(executable)
    if path.suffix.lower() in {".cmd", ".bat", ".ps1"}:
        package = path.parent / "node_modules" / ("@anthropic-ai/claude-code" if client == "claude" else "@openai/codex")
        native = package / "bin" / f"{client}.exe"
        if native.is_file():
            return [str(native)]
        entry = package / ("cli.js" if client == "claude" else "bin/codex.js")
        node = shutil.which("node")
        if node and entry.is_file():
            return [node, str(entry)]
        raise LocalAiError("CLI_INSTALL_UNSUPPORTED", f"A instalação do cliente {client} não contém um executável compatível.", 503)
    return [str(path)]


def client_environment() -> dict[str, str]:
    excluded = {
        "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
    }
    return {key: value for key, value in os.environ.items() if key.upper() not in excluded}


async def _kill(process: asyncio.subprocess.Process) -> None:
    if sys.platform == "win32" and process.returncode is not None:
        return
    if sys.platform == "win32":
        killer = await asyncio.create_subprocess_exec(
            "taskkill", "/PID", str(process.pid), "/T", "/F",
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        await killer.wait()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


async def _drain(stream: asyncio.StreamReader | None) -> None:
    assert stream is not None
    while await stream.read(65536):
        pass


async def _read(stream: asyncio.StreamReader | None) -> bytes:
    assert stream is not None
    chunks: list[bytes] = []
    size = 0
    while chunk := await stream.read(65536):
        size += len(chunk)
        if size > 4_000_000:
            raise LocalAiError("CLI_OUTPUT_LIMIT", "O cliente excedeu o limite de resposta do servidor.")
        chunks.append(chunk)
    return b"".join(chunks)


async def run_client(
    command: list[str], cwd: Path, *, prompt: str = "", timeout: float = 20,
    disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> tuple[int, str, str]:
    try:
        process = await asyncio.create_subprocess_exec(
            *command, cwd=cwd, env=client_environment(), stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            start_new_session=sys.platform != "win32",
        )
    except OSError as exc:
        raise LocalAiError("CLI_START_FAILED", "Não foi possível iniciar o cliente oficial de IA.", 503) from exc

    stdout_reader = asyncio.create_task(_read(process.stdout))
    stderr_reader = asyncio.create_task(_read(process.stderr))

    async def collect() -> tuple[int, str, str]:
        assert process.stdin is not None
        process.stdin.write(prompt.encode("utf-8"))
        try:
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            process.stdin.close()
        stdout, stderr = await asyncio.gather(stdout_reader, stderr_reader)
        return await process.wait(), stdout.decode("utf-8", errors="replace"), stderr.decode("utf-8", errors="replace")

    async def watch() -> None:
        while True:
            await asyncio.sleep(0.3)
            if disconnected and await disconnected():
                raise LocalAiError("CLI_CANCELLED", "A solicitação foi cancelada.", 499)

    work = asyncio.create_task(collect())
    monitor = asyncio.create_task(watch())
    try:
        done, _ = await asyncio.wait({work, monitor}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        if not done:
            raise LocalAiError("CLI_TIMEOUT", "O cliente de IA excedeu o tempo de resposta. Teste a conexão antes de tentar novamente.", 504)
        if monitor in done:
            await monitor
        return await work
    finally:
        work.cancel()
        monitor.cancel()
        stdout_reader.cancel()
        stderr_reader.cancel()
        await asyncio.gather(work, monitor, stdout_reader, stderr_reader, return_exceptions=True)
        await _kill(process)
        await asyncio.gather(_drain(process.stdout), _drain(process.stderr))
        await process.wait()


async def client_status(client: Client) -> dict[str, Any]:
    try:
        command = client_command(client)
    except LocalAiError as exc:
        return {"client": client, "installed": False, "authenticated": False, "message": str(exc)}
    args = ["login", "status"] if client == "codex" else ["auth", "status", "--json"]
    code, stdout, stderr = await run_client(command + args, ROOT)
    authenticated = code == 0 and "using chatgpt" in (stdout + stderr).lower()
    plan = None
    if client == "claude":
        try:
            data = json.loads(stdout)
            authenticated = code == 0 and data.get("loggedIn") is True and data.get("authMethod") == "claude.ai"
            plan = data.get("subscriptionType")
            if plan not in {"pro", "max", "team", "enterprise", "free"}:
                plan = None
        except (ValueError, AttributeError):
            authenticated = False
    login = "codex login" if client == "codex" else "claude auth login"
    return {
        "client": client, "installed": True, "authenticated": authenticated, "plan": plan,
        "message": "Cliente instalado e conectado à assinatura." if authenticated else f"Faça login na assinatura pelo terminal: {login}",
    }


def generation_command(client: Client, directory: Path, model: str) -> list[str]:
    command = client_command(client)
    if client == "codex":
        command += [
            "exec", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
            "--skip-git-repo-check", "--ephemeral", "--json", "--color", "never",
            "--output-last-message", str(directory / "response.json"),
            "-c", 'approval_policy="never"',
        ]
        for feature in ("shell_tool", "apps", "multi_agent", "browser_use", "computer_use", "image_generation", "hooks", "code_mode_host", "skill_search", "sleep_tool"):
            command += ["--disable", feature]
    else:
        command += [
            "-p", "--output-format", "json",
            "--tools", "", "--disable-slash-commands", "--safe-mode", "--setting-sources", "",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
            "--no-session-persistence", "--no-chrome", "--permission-prompts", "none",
        ]
    if model:
        command += ["--model", model]
    if client == "codex":
        command.append("-")
    return command


def classify_failure(output: str) -> LocalAiError:
    text = output.lower()
    if any(word in text for word in ("usage limit", "rate limit", "quota", "out of extra usage", "hit your limit")):
        return LocalAiError("CLI_QUOTA", "A assinatura atingiu um limite de uso. Aguarde a renovação do limite ou selecione outro provedor.", 429)
    if any(word in text for word in ("unauthorized", "not logged in", "authentication", "token expired")):
        return LocalAiError("CLI_AUTH_FAILED", "O cliente recusou a autenticação. Refazer o login no cliente oficial pode resolver.", 401)
    if any(word in text for word in ("503", "overloaded", "temporarily unavailable")):
        return LocalAiError("CLI_UNAVAILABLE", "O serviço do modelo está temporariamente indisponível.", 503)
    if any(word in text for word in ("model not found", "model_not_found", "unsupported model", "invalid model", "does not exist", "not supported", "not available for")):
        return LocalAiError("CLI_MODEL_UNAVAILABLE", "Esse modelo não está disponível para o cliente ou para esta assinatura. Teste com o campo Modelo vazio.", 400)
    if any(word in text for word in ("unexpected argument", "unknown option", "unrecognized")):
        return LocalAiError("CLI_VERSION_UNSUPPORTED", "Atualize o cliente oficial: esta versão não suporta as opções da integração.", 503)
    return LocalAiError("CLI_REQUEST_FAILED", "O cliente oficial não concluiu a solicitação. Confira o login e teste com o modelo padrão.")


def parse_result(client: Client, directory: Path, stdout: str, stderr: str, code: int) -> dict[str, Any]:
    if code != 0:
        raise classify_failure(stdout + stderr)
    usage: dict[str, Any] = {}
    try:
        if client == "codex":
            events = [json.loads(line) for line in stdout.splitlines() if line.strip()]
            if any(event.get("type") in {"error", "turn.failed"} for event in events):
                raise classify_failure(stdout + stderr)
            complete = next((event for event in reversed(events) if event.get("type") == "turn.completed"), None)
            if complete is None:
                raise LocalAiError("CLI_INCOMPLETE", "O cliente terminou sem confirmar uma resposta completa.")
            for event in events:
                item = event.get("item", {})
                if item.get("type") in {"command_execution", "file_change", "mcp_tool_call", "web_search"}:
                    raise LocalAiError("CLI_UNEXPECTED_TOOL", "O cliente tentou usar ferramentas em uma solicitação de dados.")
            native_usage = complete.get("usage", {})
            usage = {"promptTokens": native_usage.get("input_tokens", 0), "completionTokens": native_usage.get("output_tokens", 0)}
            response = directory / "response.json"
            if response.stat().st_size > 4_000_000:
                raise LocalAiError("CLI_OUTPUT_LIMIT", "O cliente excedeu o limite de resposta do servidor.")
            content = response.read_text(encoding="utf-8")
        else:
            data = json.loads(stdout)
            if data.get("is_error") or data.get("subtype") != "success":
                raise classify_failure(stdout + stderr)
            content = data.get("result")
            native_usage = data.get("usage", {})
            usage = {"promptTokens": native_usage.get("input_tokens", 0), "completionTokens": native_usage.get("output_tokens", 0)}
        if not isinstance(content, str):
            raise TypeError("Missing final response")
        return {"content": content, "finishReason": "stop", "usage": usage}
    except (ValueError, OSError, TypeError, AttributeError) as exc:
        raise LocalAiError("CLI_INVALID_RESPONSE", "O cliente respondeu, mas não entregou o formato JSON esperado pela integração.") from exc


async def generate(
    client: Client, model: str, messages: list[dict[str, str]], schema: dict[str, Any],
    disconnected: Callable[[], Awaitable[bool]] | None = None,
) -> dict[str, Any]:
    if _generation_lock.locked():
        raise LocalAiError("CLI_BUSY", "Já existe uma solicitação ao cliente local. Aguarde ou cancele a geração anterior.", 429)
    async with _generation_lock:
        status = await client_status(client)
        if not status["installed"] or not status["authenticated"]:
            raise LocalAiError("CLI_AUTH_REQUIRED", status["message"], 401)
        if disconnected and await disconnected():
            raise LocalAiError("CLI_CANCELLED", "A solicitação foi cancelada antes de chamar o modelo.", 499)
        temporary = ROOT / ".cache" / "temp"
        temporary.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix="local-ai-", dir=temporary) as folder:
            directory = Path(folder)
            prompt = (
                "You are a structured data generator. Do not use tools or execute code. "
                "Follow the system instructions and conversation in the request below. "
                "Produce the complete JSON value matching requestedSchema, directly as your final message. "
                "Do not wrap JSON in a string or an envelope. No markdown, ellipses, placeholders or omitted fields. "
                "Use compact JSON and concise explanations inside its text fields, reserving output for all geometry. "
                "Never shorten the construction or invent missing JSON delimiters.\n"
                + json.dumps({"messages": messages, "requestedSchema": schema}, ensure_ascii=False, separators=(",", ":"))
            )
            code, stdout, stderr = await run_client(
                generation_command(client, directory, model), directory,
                prompt=prompt, timeout=300, disconnected=disconnected,
            )
            return parse_result(client, directory, stdout, stderr, code)
