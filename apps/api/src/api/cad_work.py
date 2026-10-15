import asyncio
from threading import Event

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from api.cad_cancellation import cad_cancellation


def runs_cad_worker(scope: Scope) -> bool:
    if scope["type"] != "http" or not scope["path"].startswith("/api/cad/") or scope["method"] == "OPTIONS":
        return False
    path: str = scope["path"]
    if scope["method"] not in ("GET", "HEAD"):
        return True
    return path.endswith("/stl") or "/components/" in path


class CadWorkMiddleware:
    def __init__(self, app: ASGIApp, queue_timeout: float = 60) -> None:
        self.app = app
        self.queue_timeout = queue_timeout
        self.loop: asyncio.AbstractEventLoop | None = None
        self.gate: asyncio.Semaphore | None = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not runs_cad_worker(scope):
            await self.app(scope, receive, send)
            return
        loop = asyncio.get_running_loop()
        if self.loop is not loop:
            self.loop, self.gate = loop, asyncio.Semaphore(1)
        gate = self.gate
        assert gate is not None
        cancelled = Event()
        disconnected = asyncio.Event()
        messages: asyncio.Queue[Message] = asyncio.Queue(maxsize=1)

        async def relay_receive() -> None:
            # A single reader owns the ASGI channel; body and streaming-response
            # consumers keep receiving the original messages in order.
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    cancelled.set()
                    disconnected.set()
                await messages.put(message)
                if message["type"] == "http.disconnect":
                    return

        relay = asyncio.create_task(relay_receive())
        acquire = asyncio.create_task(gate.acquire())
        disconnect = asyncio.create_task(disconnected.wait())
        acquired = False
        token = cad_cancellation.set(cancelled)
        try:
            done, _ = await asyncio.wait({acquire, disconnect}, timeout=self.queue_timeout,
                                         return_when=asyncio.FIRST_COMPLETED)
            acquired = acquire in done
            if disconnected.is_set():
                return
            if not acquired:
                await JSONResponse({"code": "CAD_ENGINE_BUSY", "message": "O motor CAD está ocupado. O rascunho foi conservado; aguarde a operação atual antes de retomar.", "details": []},
                                   status_code=503)(scope, messages.get, send)
                return
            await self.app(scope, messages.get, send)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        finally:
            # Cancel pending acquisition before checking its result: it can
            # have won the semaphore while a disconnect/timeout was handled.
            for task in (relay, acquire, disconnect):
                if not task.done():
                    task.cancel()
            await asyncio.gather(relay, acquire, disconnect, return_exceptions=True)
            if acquired or (not acquire.cancelled() and acquire.exception() is None and acquire.result()):
                gate.release()
            cad_cancellation.reset(token)
