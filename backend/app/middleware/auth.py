import httpx
from fastapi import HTTPException, Request
from jose import JWTError, jwt

from app.config import settings

_jwks_cache: dict | None = None


async def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://{settings.auth0_domain}/.well-known/jwks.json"
            )
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


async def get_current_user(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="No autenticado.")
    token = auth_header[len("Bearer "):]
    try:
        jwks = await _get_jwks()
        header = jwt.get_unverified_header(token)
        key = next(
            (k for k in jwks["keys"] if k.get("kid") == header.get("kid")),
            None,
        )
        if key is None:
            raise HTTPException(status_code=403, detail="Clave JWT no encontrada.")
        payload = jwt.decode(
            token,
            key,
            algorithms=[settings.auth0_algorithms],
            audience=settings.auth0_api_audience,
        )
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=403, detail="Token inválido.")
