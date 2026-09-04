from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.core.config import get_settings


class InvalidTokenError(Exception):
    pass


def create_access_token(subject: int) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise InvalidTokenError("Could not validate credentials") from exc

    subject = payload.get("sub")
    if subject is None:
        raise InvalidTokenError("Could not validate credentials")

    try:
        return int(subject)
    except ValueError as exc:
        raise InvalidTokenError("Could not validate credentials") from exc
