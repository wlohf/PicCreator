from backend.app.main import app
from backend.app.settings import get_server_host, get_server_port


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=get_server_host(), port=get_server_port())
