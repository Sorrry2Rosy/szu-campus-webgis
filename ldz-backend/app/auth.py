from collections.abc import Iterator
from hashlib import sha256
import re
from secrets import token_urlsafe
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

from .db import DatabaseConnection, connection
from .models import Account, AccountCredentials, AccountLogin

router = APIRouter(prefix="/api/auth", tags=["账户"])
bearer = HTTPBearer(auto_error=False)
password_hash = PasswordHash.recommended()
DUMMY_HASH = password_hash.hash(token_urlsafe(32))
SESSION_SECONDS = 12 * 60 * 60


def get_accounts_db(request: Request) -> Iterator[DatabaseConnection]:
    with connection(request.app.state.databases.accounts) as db:
        yield db


AccountsDb = Annotated[DatabaseConnection, Depends(get_accounts_db)]


def unauthorized(detail: str = "请登录或重新登录") -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def bearer_digest(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> bytes:
    if credentials is None or re.fullmatch(r"[A-Za-z0-9_-]{43}", credentials.credentials) is None:
        raise unauthorized()
    return sha256(credentials.credentials.encode("ascii")).digest()


SessionDigest = Annotated[bytes, Depends(bearer_digest)]


@router.post("/register", response_model=Account, status_code=201)
def register(payload: AccountCredentials, db: AccountsDb):
    hashed = password_hash.hash(payload.password.get_secret_value())
    with db.transaction():
        account = db.execute(
            """
            INSERT INTO accounts (username, password_hash)
            VALUES (%s, %s)
            ON CONFLICT (username) DO NOTHING
            RETURNING id, username, created_at
            """,
            (payload.username, hashed),
        ).fetchone()
        if account is None:
            raise HTTPException(status_code=409, detail="用户名已存在")
    return account


@router.post("/login", response_model=AccountLogin)
def login(payload: AccountCredentials, db: AccountsDb, response: Response):
    with db.transaction():
        account = db.execute(
            "SELECT id, username, created_at, password_hash FROM accounts WHERE username = %s",
            (payload.username,),
        ).fetchone()
        stored_hash = account["password_hash"] if account else DUMMY_HASH
        verified = password_hash.verify(payload.password.get_secret_value(), stored_hash)
        if not verified or account is None:
            raise unauthorized("用户名或密码错误")
        token = token_urlsafe(32)
        db.execute(
            "DELETE FROM account_sessions WHERE account_id = %s AND expires_at <= now()",
            (account["id"],),
        )
        db.execute(
            """
            INSERT INTO account_sessions (token_hash, account_id, expires_at)
            VALUES (%s, %s, statement_timestamp() + %s * interval '1 second')
            """,
            (sha256(token.encode("ascii")).digest(), account["id"], SESSION_SECONDS),
        )
    response.headers["Cache-Control"] = "no-store"
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": SESSION_SECONDS,
        "account": {field: account[field] for field in ("id", "username", "created_at")},
    }


@router.get("/me", response_model=Account)
def current_account(digest: SessionDigest, db: AccountsDb, response: Response):
    account = db.execute(
        """
        SELECT a.id, a.username, a.created_at
        FROM accounts a
        JOIN account_sessions s ON s.account_id = a.id
        WHERE s.token_hash = %s AND s.expires_at > now()
        """,
        (digest,),
    ).fetchone()
    if account is None:
        raise unauthorized()
    response.headers["Cache-Control"] = "no-store"
    return account


@router.post("/logout", status_code=204)
def logout(digest: SessionDigest, db: AccountsDb) -> Response:
    with db.transaction():
        db.execute("DELETE FROM account_sessions WHERE token_hash = %s", (digest,))
    return Response(status_code=204)
