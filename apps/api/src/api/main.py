from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings
from api.error_handlers import register_error_handlers
from api.routes.artifacts import router as artifacts_router
from api.routes.cad import router as cad_router
from api.routes.cad_programs import router as cad_programs_router
from api.routes.cad_projects import router as cad_projects_router
from api.routes.health import router as health_router
from api.routes.manifests import router as manifests_router
from api.routes.plans import router as plans_router
from api.routes.projects import router as projects_router
from api.routes.recipes import router as recipes_router

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
app.include_router(recipes_router)
app.include_router(manifests_router)
app.include_router(cad_router)
app.include_router(cad_projects_router)
app.include_router(cad_programs_router)
