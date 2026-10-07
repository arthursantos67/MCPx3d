import asyncio

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class CadWorkMiddleware:
    def __init__(self, app: ASGIApp, queue_timeout: float = 60) -> None:
        self.app = app
        self.queue_timeout = queue_timeout
        self.loop: asyncio.AbstractEventLoop | None = None
        self.gate: asyncio.Semaphore | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/cad/") or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return
        loop = asyncio.get_running_loop()
        if self.loop is not loop:
            self.loop, self.gate = loop, asyncio.Semaphore(1)
        gate = self.gate
        assert gate is not None
        try:
            await asyncio.wait_for(gate.acquire(), self.queue_timeout)
        except TimeoutError:
            await JSONResponse({"code": "CAD_ENGINE_BUSY", "message": "O motor CAD está ocupado. O rascunho foi conservado; aguarde a operação atual antes de retomar.", "details": []},
                               status_code=503)(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        finally:
            gate.release()
