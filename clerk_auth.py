"""Who is calling the API: verifies the Clerk session token the Next.js app sends.

The browser (same origin) sends Clerk's `__session` cookie; server-side calls
from Next.js send `Authorization: Bearer <token>` from `auth().getToken()`.
Both are short-lived RS256 JWTs signed by the Clerk instance shared with
ProjectCost.

Environment variables:
  CLERK_JWT_KEY            the instance's PEM public key (Clerk dashboard > API keys);
                           verifies without a network call
  CLERK_ISSUER_URL         the Frontend API URL, e.g. https://clerk.axiomft.ca; used to
                           fetch the JWKS when CLERK_JWT_KEY isn't set, and checked as `iss`.
                           When unset it is read from NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
                           which encodes it, so the Next.js app's keys are enough.
  CLERK_AUTHORIZED_PARTIES optional, comma-separated origins allowed in `azp`,
                           e.g. https://portfolio.axiomft.ca,http://localhost:3000

Like access.py: with neither key set, local development runs as one local
user, and a Vercel deployment refuses every request.
"""
import base64
import binascii
import os
from dataclasses import dataclass
from functools import lru_cache

import jwt

LOCAL_USER_ID = "local"
SESSION_COOKIE = "__session"
LEEWAY_SECONDS = 5  # clock skew between Clerk and the function


class AuthError(Exception):
    """The request has no usable session; `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Caller:
    user_id: str
    local: bool = False


def issuer_from_publishable_key(key: str | None) -> str | None:
    """https://<frontend api> from a Clerk publishable key: pk_test_/pk_live_ + base64("<host>$")."""
    prefix, _, encoded = (key or "").strip().rpartition("_")
    if prefix not in ("pk_test", "pk_live") or not encoded:
        return None
    try:
        host = base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError):
        return None
    host = host.rstrip("$")
    return f"https://{host}" if host and "." in host and "/" not in host else None


def _issuer() -> str | None:
    issuer = os.getenv("CLERK_ISSUER_URL") or issuer_from_publishable_key(os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"))
    return issuer.rstrip("/") if issuer else None


def configured() -> bool:
    return bool(os.getenv("CLERK_JWT_KEY") or _issuer())


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def _signing_key(token: str):
    pem = os.getenv("CLERK_JWT_KEY")
    if pem:
        # Vercel env vars often hold the PEM on one line with literal \n.
        return pem.replace("\\n", "\n")
    return _jwks_client(f"{_issuer()}/.well-known/jwks.json").get_signing_key_from_jwt(token).key


def verify(token: str) -> Caller:
    """The caller behind a Clerk session token, or AuthError."""
    try:
        claims = jwt.decode(
            token,
            _signing_key(token),
            algorithms=["RS256"],
            issuer=_issuer(),  # None skips the check (CLERK_JWT_KEY alone)
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "sub"], "verify_aud": False},
        )
    except jwt.PyJWKClientError as exc:
        raise AuthError(f"Couldn't fetch Clerk's signing keys: {exc}", status=503) from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError(f"Invalid session token: {exc}") from exc
    parties = [p.strip().rstrip("/") for p in os.getenv("CLERK_AUTHORIZED_PARTIES", "").split(",") if p.strip()]
    if parties and claims.get("azp") not in parties:
        raise AuthError("Session token is for another site.")
    return Caller(user_id=str(claims["sub"]))


def caller(authorization: str | None, cookie: str | None) -> Caller:
    """The caller for a request's Authorization header and session cookie."""
    if not configured():
        if os.getenv("VERCEL"):
            raise AuthError("Sign-in isn't configured for this deployment.", status=503)
        return Caller(user_id=LOCAL_USER_ID, local=True)
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    token = token or cookie
    if not token:
        raise AuthError("Sign in to use the API.")
    return verify(token)
