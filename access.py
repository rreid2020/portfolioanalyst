"""Who is using the app: the sign-in gate and the sign-in page.

- Sign-in configured (an [auth] section in st.secrets): visitors must sign in
  with their Axiom (Clerk) account.
- Not configured on Vercel: the app refuses to run, so a missing setting
  never leaves it open to the public.
- Not configured locally: a single local user, so development works without
  Clerk.
"""
import os
from dataclasses import dataclass

import streamlit as st

import branding

LOCAL_USER_ID = "local"


@dataclass(frozen=True)
class User:
    id: str
    email: str | None
    name: str | None
    local: bool = False

    @property
    def label(self) -> str:
        return self.name or self.email or ("Local user" if self.local else self.id)


def sign_in_configured() -> bool:
    try:
        return "auth" in st.secrets
    except Exception:  # no secrets file at all
        return False


def current_user() -> User | None:
    """The signed-in user, the local user in development, or None (show the sign-in page)."""
    if sign_in_configured():
        # .get: st.user has no is_logged_in key until a session cookie exists.
        if not st.user.get("is_logged_in", False):
            return None
        subject = st.user.get("sub")
        if not subject:  # every saved portfolio hangs off this id; never fall back to a shared one
            return None
        return User(id=str(subject), email=st.user.get("email"), name=st.user.get("name"))
    if os.getenv("VERCEL"):
        return None
    return User(id=LOCAL_USER_ID, email=None, name=None, local=True)


def sign_in_page() -> None:
    """Full-page sign-in in the style of the ProjectCost sign-in page; stops the script."""
    branding.apply()
    st.html(branding.SIGN_IN_STYLE)
    left, right = st.columns([1.35, 1], gap="large", vertical_alignment="center")
    with left:
        st.html(branding.sign_in_panel())
    with right:
        st.html('<div class="ax-header"><h1>Sign in</h1><p>Use your Axiom account to open your portfolios.</p></div>')
        if sign_in_configured():
            st.button("Sign in with Axiom", type="primary", icon=":material/login:", on_click=st.login, width="stretch")
            st.caption("The same account you use for ProjectCost. New here? You can create one on the next screen.")
        else:
            st.error(
                "Sign-in isn't configured for this deployment. Set CLERK_OAUTH_CLIENT_ID, "
                "CLERK_OAUTH_CLIENT_SECRET and CLERK_ISSUER_URL (see the README)."
            )
    st.stop()


def account_menu(user: User) -> None:
    """Signed-in user and sign-out, for the sidebar."""
    if user.local:
        st.caption("Running locally without sign-in. Portfolios are saved on this computer.")
        return
    st.caption(f"Signed in as **{user.label}**" + (f" · {user.email}" if user.email and user.name else ""))
    st.button("Sign out", icon=":material/logout:", on_click=st.logout, key="sign_out")
