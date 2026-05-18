from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from backend.app.services.auth_service import (
    LEGACY_SESSION_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    apply_session_cookie,
    authenticate_user,
    clear_session_cookie,
    create_session,
    get_current_user,
    has_users,
    register_user,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginPayload(BaseModel):
    username: str
    password: str


@router.get("/me")
def me(request: Request):
    try:
        user = get_current_user(request)
        return {"ok": True, "authenticated": True, "user": user, "has_users": has_users()}
    except HTTPException:
        return {"ok": True, "authenticated": False, "user": None, "has_users": has_users()}


@router.post("/register")
def register(payload: LoginPayload, response: Response):
    user = register_user(payload.username, payload.password)
    session_id = create_session(user)
    apply_session_cookie(response, session_id)
    return {"ok": True, "user": user}


@router.post("/login")
def login(payload: LoginPayload, response: Response):
    user = authenticate_user(payload.username, payload.password)
    session_id = create_session(user)
    apply_session_cookie(response, session_id)
    return {"ok": True, "user": user}


@router.post("/logout")
def logout(request: Request, response: Response):
    session_id = request.cookies.get(SESSION_COOKIE_NAME, "") or request.cookies.get(LEGACY_SESSION_COOKIE_NAME, "")
    from backend.app.services.auth_service import delete_session

    delete_session(session_id)
    clear_session_cookie(response)
    return {"ok": True}
