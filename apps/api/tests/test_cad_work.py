import asyncio

from api.cad_work import CadWorkMiddleware


def test_cad_requests_share_one_worker_while_health_remains_responsive():
    async def run():
        entered = asyncio.Event()
        release = asyncio.Event()
        active = 0
        maximum = 0
        completed = []

        async def application(scope, receive, send):
            nonlocal active, maximum
            if scope["path"].startswith("/api/cad/"):
                active += 1
                maximum = max(maximum, active)
                entered.set()
                await release.wait()
                active -= 1
            completed.append(scope["path"])

        middleware = CadWorkMiddleware(application)

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            pass

        def scope(path):
            return {"type": "http", "path": path, "method": "POST"}

        first = asyncio.create_task(middleware(scope("/api/cad/programs/inspect"), receive, send))
        await entered.wait()
        second = asyncio.create_task(middleware(scope("/api/cad/drafts/mesh"), receive, send))
        await middleware(scope("/api/health"), receive, send)
        assert completed == ["/api/health"]
        release.set()
        await asyncio.gather(first, second)
        assert maximum == 1
        assert len(completed) == 3

    asyncio.run(run())


def test_a_busy_queue_times_out_without_starting_another_cad_job():
    async def run():
        entered = asyncio.Event()
        release = asyncio.Event()
        messages = []
        started = 0

        async def application(scope, receive, send):
            nonlocal started
            started += 1
            entered.set()
            await release.wait()

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            messages.append(message)

        middleware = CadWorkMiddleware(application, queue_timeout=.01)
        scope = {"type": "http", "path": "/api/cad/programs/inspect", "method": "POST"}
        first = asyncio.create_task(middleware(scope, receive, send))
        await entered.wait()
        await middleware(scope, receive, send)
        assert started == 1
        assert messages[0]["status"] == 503
        assert b"CAD_ENGINE_BUSY" in messages[1]["body"]
        release.set()
        await first

    asyncio.run(run())
