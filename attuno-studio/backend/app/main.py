from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.routes.auth import router as auth_router
from backend.app.routes.chat import router as chat_router
from backend.app.routes.chat_history import router as chat_history_router
from backend.app.routes.config import router as config_router
from backend.app.routes.generate import router as generate_router
from backend.app.routes.health import router as health_router
from backend.app.routes.image_edits import router as image_edits_router
from backend.app.routes.preferences import router as preferences_router
from backend.app.routes.results import router as results_router
from backend.app.settings import get_cors_origin_regex, get_cors_origins


def create_app() -> FastAPI:
    app = FastAPI(title="Attuno Studio API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_origin_regex=get_cors_origin_regex(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(chat_router)
    app.include_router(chat_history_router)
    app.include_router(config_router)
    app.include_router(generate_router)
    app.include_router(results_router)
    app.include_router(image_edits_router)
    app.include_router(preferences_router)
    return app


app = create_app()
