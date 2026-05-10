from fastapi import APIRouter

from backend.app.settings import API_BUILD_ID

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health():
    return {"ok": True, "service": "3d-render-agent-api", "build": API_BUILD_ID}
