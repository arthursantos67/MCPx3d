from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings
from api.error_handlers import register_error_handlers
from api.routes.artifacts import router as artifacts_router
from api.routes.health import router as health_router
from api.routes.plans import router as plans_router
from api.routes.projects import router as projects_router

settings = get_settings()

app = FastAPI(title="AI Web3D Modeler API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(health_router)
app.include_router(projects_router)
app.include_router(plans_router)
app.include_router(artifacts_router)
