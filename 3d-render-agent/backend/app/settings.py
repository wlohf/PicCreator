import os

DEFAULT_CORS_ORIGINS = [
    "http://127.0.0.1:5174",
    "http://localhost:5174",
    "http://127.0.0.1:48125",
    "http://localhost:48125",
    "http://127.0.0.1:44483",
    "http://localhost:44483",
]


def get_cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "")
    if raw.strip():
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return DEFAULT_CORS_ORIGINS


def get_server_host() -> str:
    return os.environ.get("API_HOST") or os.environ.get("APP_HOST", "127.0.0.1")


def get_server_port() -> int:
    return int(os.environ.get("API_PORT") or os.environ.get("APP_PORT", "8787"))
