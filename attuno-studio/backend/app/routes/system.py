from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from backend.app.services.update_service import (
    UpdateAuthError,
    UpdateError,
    authenticate_update_admin,
    apply_update,
    check_for_updates,
    credentials_from_basic_authorization,
    update_status,
)


router = APIRouter(prefix="/api/system", tags=["system"])


def _require_update_admin(request: Request) -> None:
    try:
        credentials = credentials_from_basic_authorization(request.headers.get("authorization", ""))
        authenticate_update_admin(credentials)
    except UpdateAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/update/status")
def get_update_status(request: Request):
    _require_update_admin(request)
    return update_status(use_cache=True)


@router.post("/update/check")
def post_update_check(request: Request):
    _require_update_admin(request)
    return check_for_updates()


@router.post("/update/apply")
def post_update_apply(request: Request):
    _require_update_admin(request)
    try:
        return apply_update()
    except UpdateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
