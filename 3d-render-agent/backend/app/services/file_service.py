import base64
import mimetypes
from pathlib import Path

from fastapi import UploadFile


async def save_uploads(files: list[UploadFile], target_dir: Path) -> list[str]:
    paths: list[str] = []
    target_dir.mkdir(parents=True, exist_ok=True)
    for index, upload in enumerate(files):
        suffix = Path(upload.filename or "").suffix or ".png"
        path = target_dir / f"upload_{index}{suffix}"
        path.write_bytes(await upload.read())
        paths.append(str(path))
    return paths


def image_record(path: str, label: str):
    image_path = Path(path)
    if not image_path.exists():
        return None
    mime_type = mimetypes.guess_type(str(image_path))[0] or "image/png"
    data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return {
        "label": label,
        "filename": image_path.name,
        "data_url": f"data:{mime_type};base64,{data}",
    }
