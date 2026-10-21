"""Who is using the app: the sign-in gate and the sign-in page.

- Sign-in configured (an [auth] section in st.secrets): visitors must sign in
  with their Axiom (Clerk) account.
- Not configured on Vercel: the app refuses to run, so a missing setting
  never leaves it open to the public.
- Not configured locally: a single local user, so development works without
  Clerk.
"""
import importlib
import os
import threading
from dataclasses import dataclass

import streamlit as st

import branding

LOCAL_USER_ID = "local"

_preload_started = False


def preload(modules) -> None:
    """Import `modules` on a background thread, once per server process."""
    global _preload_started
    if _preload_started:
        return
    _preload_started = True

    def run():
        for name in modules:
            try:
                importlib.import_module(name)
            except Exception:  # the real import later reports any error
                pass

    threading.Thread(target=run, name="preload", daemon=True).start()


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


SIGN_IN_LABEL = "Sign in with Axiom"

# Sends a signed-out visitor straight to the Clerk sign-in page by clicking the
# button below, so there's no extra click. sessionStorage remembers the attempt
# for this tab: coming back still signed out within two minutes (a cancelled or
# failed sign-in) shows this page instead of redirecting again, so a sign-in
# problem can't turn into a redirect loop. Fixed script; nothing user-supplied.
AUTO_SIGN_IN_SCRIPT = """<script>
(function () {
  var KEY = "axiom-auto-sign-in", now = Date.now(), last = 0;
  try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch (e) {}
  if (now - last < 120000) return;
  try { sessionStorage.setItem(KEY, String(now)); } catch (e) {}
  (function click(tries) {
    var button = Array.from(document.querySelectorAll("button"))
      .find(function (b) { return b.innerText.indexOf("%s") >= 0; });
    if (button) button.click();
    else if (tries < 50) setTimeout(function () { click(tries + 1); }, 100);
  })(0);
})();
</script>""" % SIGN_IN_LABEL


def sign_in_page() -> None:
    """Sign-in page in the Axiom style; usually skipped straight to Clerk. Stops the script."""
    branding.apply()
    st.html(branding.SIGN_IN_STYLE)
    left, right = st.columns([1.35, 1], gap="large", vertical_alignment="center")
    with left:
        st.html(branding.sign_in_panel())
    with right:
        st.html('<div class="ax-header"><h1>Sign in</h1><p>Use your Axiom account to open your portfolios.</p></div>')
        if sign_in_configured():
            st.button(SIGN_IN_LABEL, type="primary", icon=":material/login:", on_click=st.login, width="stretch")
            st.caption("New here? Choose Sign up on the next screen to create your Axiom account.")
            st.html(AUTO_SIGN_IN_SCRIPT, unsafe_allow_javascript=True)
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
