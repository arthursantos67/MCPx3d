import asyncio

from api.cad_cancellation import cad_cancellation
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


def test_disconnect_signals_a_synchronous_worker_and_releases_the_queue():
    async def run():
        entered = asyncio.Event()
        messages = asyncio.Queue()
        received = []

        def worker():
            cancellation = cad_cancellation.get()
            assert cancellation is not None
            assert cancellation.wait(timeout=2)

        async def application(scope, receive, send):
            received.append(await receive())
            entered.set()
            await asyncio.to_thread(worker)

        middleware = CadWorkMiddleware(application)
        await messages.put({"type": "http.request", "body": b"payload", "more_body": False})
        task = asyncio.create_task(middleware({"type": "http", "path": "/api/cad/programs/inspect", "method": "POST"},
                                               messages.get, lambda message: None))
        await entered.wait()
        await messages.put({"type": "http.disconnect"})
        await asyncio.wait_for(task, 3)
        assert received[0]["body"] == b"payload"
        assert middleware.gate._value == 1
        assert cad_cancellation.get() is None

    asyncio.run(run())


def test_disconnected_queued_request_never_starts_or_leaks_a_permit():
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        first_messages, second_messages = asyncio.Queue(), asyncio.Queue()
        started = []

        async def application(scope, receive, send):
            started.append(scope["path"])
            await receive()
            entered.set()
            await release.wait()

        async def send(message):
            pass

        middleware = CadWorkMiddleware(application)
        scope = {"type": "http", "path": "/api/cad/first", "method": "POST"}
        await first_messages.put({"type": "http.request", "body": b"", "more_body": False})
        first = asyncio.create_task(middleware(scope, first_messages.get, send))
        await entered.wait()
        await second_messages.put({"type": "http.disconnect"})
        await asyncio.wait_for(middleware({**scope, "path": "/api/cad/second"}, second_messages.get, send), 1)
        assert started == ["/api/cad/first"]
        release.set()
        await first
        assert middleware.gate._value == 1

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


def test_pure_cad_reads_bypass_the_worker_queue():
    async def run():
        entered = asyncio.Event()
        release = asyncio.Event()
        completed = []

        async def application(scope, receive, send):
            if scope["method"] == "POST":
                entered.set()
                await release.wait()
            completed.append((scope["method"], scope["path"]))

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            pass

        middleware = CadWorkMiddleware(application, queue_timeout=.01)
        first = asyncio.create_task(middleware({"type": "http", "path": "/api/cad/projects", "method": "POST"}, receive, send))
        await entered.wait()
        for path in ("/api/cad/projects/p1", "/api/cad/projects/p1/revisions/0", "/api/cad/projects/p1/revisions/0/step"):
            await middleware({"type": "http", "path": path, "method": "GET"}, receive, send)
        assert len(completed) == 3
        release.set()
        await first

    asyncio.run(run())


def test_worker_routes_are_gated():
    from api.cad_work import runs_cad_worker

    def scope(method, path):
        return {"type": "http", "method": method, "path": path}

    assert runs_cad_worker(scope("POST", "/api/cad/programs/inspect"))
    assert runs_cad_worker(scope("GET", "/api/cad/projects/p1/revisions/0/stl"))
    assert runs_cad_worker(scope("GET", "/api/cad/projects/p1/revisions/0/components/a/step"))
    assert not runs_cad_worker(scope("GET", "/api/cad/projects/p1/revisions/0/step"))
    assert not runs_cad_worker(scope("GET", "/api/cad/projects/p1"))
    assert not runs_cad_worker(scope("OPTIONS", "/api/cad/projects"))
    assert not runs_cad_worker(scope("POST", "/api/projects"))
