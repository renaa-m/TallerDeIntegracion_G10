import httpx
from fastapi import HTTPException, Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.config import settings

_jwks_cache: dict | None = None
_bearer = HTTPBearer()


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


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    token = credentials.credentials
    try:
        jwks = await _get_jwks()
        # Obtener el kid del header del token
        unverified_header = jwt.get_unverified_header(token)
        # Buscar la clave correcta en el JWKS
        rsa_key = {}
        for key in jwks["keys"]:
            if key["kid"] == unverified_header["kid"]:
                rsa_key = {
                    "kty": key["kty"],
                    "kid": key["kid"],
                    "use": key["use"],
                    "n": key["n"],
                    "e": key["e"],
                }
                break

        if not rsa_key:
            raise HTTPException(status_code=401, detail="Clave pública no encontrada")

        payload = jwt.decode(
            token,
            rsa_key,
            algorithms=["RS256"],
            audience=settings.auth0_api_audience,
            issuer=f"https://{settings.auth0_domain}/",
        )

        # El sub de Auth0 tiene formato "auth0|<id>" — retornamos el id limpio
        sub: str = payload.get("sub", "")
        if not sub:
            raise HTTPException(status_code=401, detail="Token sin subject")

        return sub

    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Token inválido: {str(e)}")


async def get_current_user(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=403, detail="No autenticado.")
    token = auth_header[len("Bearer ") :]
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
