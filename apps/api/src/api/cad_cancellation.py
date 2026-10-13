from contextvars import ContextVar
from threading import Event

# Context is copied by Starlette into synchronous endpoint worker threads.
cad_cancellation: ContextVar[Event | None] = ContextVar("cad_cancellation", default=None)
