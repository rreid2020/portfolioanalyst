"""Streamlit sign-in settings (st.login) for Clerk, built from environment variables.

Clerk acts as the OpenID Connect provider through a Clerk "OAuth application"
in the same instance as ProjectCost, so one Axiom login covers both apps.
asgi.py passes these as programmatic secrets to st.App, so no secrets file
is needed on Vercel (whose filesystem is read-only).

Environment variables:
  CLERK_OAUTH_CLIENT_ID, CLERK_OAUTH_CLIENT_SECRET  from the OAuth application
  CLERK_ISSUER_URL       the instance's Frontend API URL, e.g. https://clerk.axiomft.ca
  APP_URL                this app's public URL; defaults to Vercel's production URL
  AUTH_COOKIE_SECRET     optional; derived from the client secret when unset
  CLERK_OAUTH_PROMPT     optional OIDC prompt, default "login"
"""
import hashlib
import os


def app_url() -> str | None:
    url = os.getenv("APP_URL")
    if not url and os.getenv("VERCEL_PROJECT_PRODUCTION_URL"):
        url = "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"]
    return url.rstrip("/") if url else None


def streamlit_secrets() -> dict | None:
    """{"auth": {...}} for st.App(secrets=...), or None when sign-in isn't configured."""
    client_id = os.getenv("CLERK_OAUTH_CLIENT_ID")
    client_secret = os.getenv("CLERK_OAUTH_CLIENT_SECRET")
    issuer = os.getenv("CLERK_ISSUER_URL")
    url = app_url()
    if not (client_id and client_secret and issuer and url):
        return None
    cookie_secret = os.getenv("AUTH_COOKIE_SECRET") or hashlib.sha256(
        b"portfolio-analyst-cookie:" + client_secret.encode()
    ).hexdigest()
    return {
        "auth": {
            "redirect_uri": f"{url}/oauth2callback",
            "cookie_secret": cookie_secret,
            "client_id": client_id,
            "client_secret": client_secret,
            "server_metadata_url": f"{issuer.rstrip('/')}/.well-known/openid-configuration",
            "client_kwargs": {"scope": "openid email profile", "prompt": os.getenv("CLERK_OAUTH_PROMPT", "login")},
        }
    }
