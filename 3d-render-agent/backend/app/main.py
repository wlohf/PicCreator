from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.routes.config import router as config_router
from backend.app.routes.generate import router as generate_router
from backend.app.routes.health import router as health_router
from backend.app.settings import get_cors_origins


def create_app() -> FastAPI:
    app = FastAPI(title="3D Render Agent API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(config_router)
    app.include_router(generate_router)
    return app


app = create_app()
