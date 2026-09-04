import base64

from pydantic import BaseModel, field_validator

AUTH_KEY_BYTE_LENGTH = 32


class AuthCredentials(BaseModel):
    email: str
    auth_key: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or " " in normalized or not (3 <= len(normalized) <= 255):
            raise ValueError("email must be a valid email address")
        return normalized

    @field_validator("auth_key")
    @classmethod
    def validate_auth_key(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except ValueError as exc:
            raise ValueError("auth_key must be valid base64") from exc
        if len(decoded) != AUTH_KEY_BYTE_LENGTH:
            raise ValueError(f"auth_key must decode to exactly {AUTH_KEY_BYTE_LENGTH} bytes")
        return value


class RegisterRequest(AuthCredentials):
    pass


class LoginRequest(AuthCredentials):
    pass


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    email: str
