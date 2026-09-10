from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.auth.router import router as auth_router
from app.core.rate_limit import limiter
from app.vault.router import router as vault_router

app = FastAPI(title="Password Manager API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.include_router(auth_router)
app.include_router(vault_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # FastAPI's default handler echoes the rejected value back in each error's
    # "input" field (and an "ctx" field that can carry the original exception).
    # For a zero-knowledge password manager, a validation bug on the client
    # could send a raw master password as auth_key, which would then be
    # echoed back into this response body — visible in devtools, error
    # reporting, and any logging that captures response bodies. We strip
    # "input" and "ctx" from each error entry so the message (what was wrong)
    # is preserved without echoing back the value that triggered it.
    sanitized_errors = [
        {key: value for key, value in error.items() if key not in ("input", "ctx")} for error in exc.errors()
    ]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": sanitized_errors})


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
