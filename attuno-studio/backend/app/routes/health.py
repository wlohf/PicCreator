from fastapi import APIRouter

from backend.app.services.db import get_database_status, initialize_database
from backend.app.settings import API_BUILD_ID

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health():
    database = initialize_database()
    return {
        "ok": bool(database.get("ok")),
        "service": "attuno-studio-api",
        "build": API_BUILD_ID,
        "database": database,
    }
