from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import OperationalError

from .api import router
from .auth import router as auth_router
from .db import Databases, initialize

DEFAULT_ORIGINS = (
    "http://localhost:5500,http://127.0.0.1:5500,"
    "http://localhost:5173,http://127.0.0.1:5173"
)


def create_app(databases: Databases | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.databases = databases if databases is not None else Databases.from_environment()
        initialize(app.state.databases)
        yield

    app = FastAPI(title="深圳大学粤海校区设施巡检 API", version="2.0.0", lifespan=lifespan)
    origins = os.getenv("CAMPUS_CORS_ORIGINS", DEFAULT_ORIGINS)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        # 只返回字段位置和错误说明，避免原输入中的 NaN 无法编码为 JSON。
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {key: item[key] for key in ("loc", "msg", "type")}
                    for item in error.errors()
                ]
            },
        )

    @app.exception_handler(OperationalError)
    async def database_unavailable(request: Request, error: OperationalError):
        return JSONResponse(status_code=503, content={"detail": "数据库暂时不可用"})

    app.include_router(router)
    app.include_router(auth_router)
    return app


app = create_app()
