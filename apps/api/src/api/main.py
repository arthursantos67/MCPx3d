from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings
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

app.include_router(health_router)
app.include_router(projects_router)
app.include_router(plans_router)
