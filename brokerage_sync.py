"""Pull holdings from a brokerage (Wealthsimple, Questrade, IBKR...) through SnapTrade, read-only.

The visitor signs in to their brokerage on SnapTrade's connection portal; this
app never sees brokerage credentials. Connections are requested with
connection_type="read", so they can't place trades.

Identity. The app has no login, so each visitor gets their own SnapTrade
user. Its id and secret are kept in st.session_state and, encrypted with a
key derived from SNAPTRADE_CONSUMER_KEY (seal_user), in the page URL. The URL
copy lets a session that Vercel recycled mid-sign-in, or the portal's
redirect back to the app, pick the user up again. Tokens expire after
STALE_USER_SECONDS. Nothing is written to disk or a cookie, so a visitor
reconnects on each visit. SnapTrade users are deleted after holdings are
loaded (by default) or on "Disconnect"; users left behind by closed tabs are
deleted on the next registration once they are older than STALE_USER_SECONDS.

With SNAPTRADE_KEY_TYPE=personal the keys belong to one person's SnapTrade
account: no users are registered and every visitor sees that account's
holdings. Only use it locally or behind Vercel Deployment Protection.
"""
import base64
import hashlib
import json
import os
import time
import uuid
from collections.abc import Mapping
from decimal import Decimal

import pandas as pd
from cryptography.fernet import Fernet, InvalidToken
from snaptrade_client import SnapTrade, SnapTradeAuth
from snaptrade_client.exceptions import ApiException

from portfolio_import import COLUMNS, _yfinance_symbol, normalize_account

USER_ID_PREFIX = "portfolio-analyst-"
STALE_USER_SECONDS = 60 * 60

# Instrument kinds yfinance can price by ticker. Options, crypto, bonds and
# mutual funds (e.g. TDB902) are skipped and reported in the warnings.
SUPPORTED_KINDS = {"stock", "etf", "adr", "cef"}


def is_configured() -> bool:
    return bool(os.getenv("SNAPTRADE_CLIENT_ID") and os.getenv("SNAPTRADE_CONSUMER_KEY"))


def is_personal() -> bool:
    return os.getenv("SNAPTRADE_KEY_TYPE", "commercial").strip().lower() == "personal"


def make_client() -> SnapTrade:
    auth = SnapTradeAuth.personal_api_key if is_personal() else SnapTradeAuth.commercial_api_key
    return SnapTrade(
        auth=auth(
            consumer_key=os.environ["SNAPTRADE_CONSUMER_KEY"],
            client_id=os.environ["SNAPTRADE_CLIENT_ID"],
        )
    )


def _user_kwargs(user):
    """Commercial keys pass the SnapTrade user on every call; personal keys don't."""
    if user is None:
        return {}
    return {"user_id": user["user_id"], "user_secret": user["user_secret"]}


def _text(value) -> str:
    # SDK bodies hold schema objects; NoneClass is falsy and str() of it isn't "".
    return str(value).strip() if value else ""


def _number(value):
    if not isinstance(value, (str, int, float, Decimal)):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def error_message(exc: Exception) -> str:
    """Short text for an error. str() of SDK errors includes every HTTP header."""
    if not isinstance(exc, ApiException):
        return str(exc)
    body = exc.body
    if isinstance(body, (bytes, str)):
        try:
            body = json.loads(body)
        except ValueError:
            body = None
    detail = _text(body.get("detail")) if isinstance(body, Mapping) else ""
    return f"SnapTrade returned HTTP {exc.status}: {detail or exc.reason}"


def _registered_at(user_id: str):
    """Registration time encoded in our user ids, or None for ids we didn't create."""
    if not user_id.startswith(USER_ID_PREFIX):
        return None
    try:
        return int(user_id[len(USER_ID_PREFIX):].split("-", 1)[0])
    except ValueError:
        return None


def delete_stale_users(client: SnapTrade, now=None) -> int:
    """Delete this app's SnapTrade users older than STALE_USER_SECONDS."""
    now = time.time() if now is None else now
    deleted = 0
    for user_id in client.authentication.list_snap_trade_users().body:
        registered = _registered_at(str(user_id))
        if registered is not None and now - registered > STALE_USER_SECONDS:
            client.authentication.delete_snap_trade_user(user_id=str(user_id))
            deleted += 1
    return deleted


def register_user(client: SnapTrade) -> dict:
    """Register a SnapTrade user for this browser session."""
    try:
        delete_stale_users(client)
    except Exception:
        pass  # Cleanup is best effort; it must not block connecting.
    user_id = f"{USER_ID_PREFIX}{int(time.time())}-{uuid.uuid4().hex}"
    body = client.authentication.register_snap_trade_user(user_id=user_id).body
    return {"user_id": str(body["userId"]), "user_secret": str(body["userSecret"])}


def delete_user(client: SnapTrade, user) -> None:
    """Delete the SnapTrade user and its brokerage connections (queued by SnapTrade)."""
    client.authentication.delete_snap_trade_user(user_id=user["user_id"])


def _fernet() -> Fernet:
    digest = hashlib.sha256(b"portfolio-analyst-user-token:" + os.environ["SNAPTRADE_CONSUMER_KEY"].encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def seal_user(user) -> str:
    """Encrypt the SnapTrade user into a URL-safe token only this server can read."""
    return _fernet().encrypt(json.dumps(user).encode()).decode()


def unseal_user(token: str):
    """The user from seal_user, or None if the token is invalid or older than STALE_USER_SECONDS."""
    try:
        user = json.loads(_fernet().decrypt(token.encode(), ttl=STALE_USER_SECONDS))
    except (InvalidToken, ValueError):
        return None
    if not isinstance(user, dict) or not {"user_id", "user_secret"} <= user.keys():
        return None
    return user


def connection_portal_url(client: SnapTrade, user, redirect_url=None) -> str:
    """Read-only connection portal link. SnapTrade expires it after 5 minutes.

    With redirect_url, the portal sends the browser there once the brokerage
    is connected instead of showing its own "Connection Complete" screen.
    """
    options = {"custom_redirect": redirect_url, "immediate_redirect": True} if redirect_url else {}
    body = client.authentication.login_snap_trade_user(
        connection_type="read", **options, **_user_kwargs(user)
    ).body
    return str(body["redirectURI"])


def account_type(account) -> str:
    """TFSA, RRSP, Non-registered... from SnapTrade's raw account type, else its name."""
    account_type = normalize_account(_text(account.get("raw_type")))
    if account_type in ("", "Other"):
        account_type = normalize_account(_text(account.get("display_name"))) or account_type
    return account_type


def positions_to_holdings(positions):
    """Merge SnapTrade positions into a DataFrame with COLUMNS plus warning strings.

    A position may carry an "account" type (see account_type); lots in the same
    account are combined, while different accounts stay separate rows.
    """
    holdings = {}
    skipped_kinds = {}
    skipped_short = 0
    for position in positions:
        instrument = position.get("instrument") or {}
        kind = _text(instrument.get("kind")) or "unknown"
        if kind not in SUPPORTED_KINDS:
            skipped_kinds[kind] = skipped_kinds.get(kind, 0) + 1
            continue
        shares = _number(position.get("units"))
        if shares is None or shares <= 0:
            skipped_short += 1
            continue
        symbol = _text(instrument.get("raw_symbol")) or _text(instrument.get("symbol"))
        if not symbol:
            continue
        ticker = _yfinance_symbol(symbol, _text(instrument.get("exchange")))
        currency = (_text(position.get("currency")) or _text(instrument.get("currency"))).upper()
        avg = _number(position.get("cost_basis"))
        account = position.get("account", "")

        pos = holdings.setdefault((ticker, currency, account), {"shares": 0.0, "cost": 0.0, "has_cost": True})
        pos["shares"] += shares
        if avg is None:
            pos["has_cost"] = False
        else:
            pos["cost"] += avg * shares

    warnings = []
    if skipped_kinds:
        kinds = ", ".join(f"{n} {kind}" for kind, n in sorted(skipped_kinds.items()))
        warnings.append(f"Skipped positions yfinance can't price ({kinds}).")
    if skipped_short:
        warnings.append(f"Skipped {skipped_short} position(s) without a positive quantity.")

    rows = [
        {
            "Ticker": ticker,
            "Shares": round(pos["shares"], 6),
            "Avg Buy Price": round(pos["cost"] / pos["shares"], 4) if pos["has_cost"] else None,
            "Currency": currency,
            "Account": account,
        }
        for (ticker, currency, account), pos in holdings.items()
    ]
    return pd.DataFrame(rows, columns=COLUMNS), warnings


def fetch_holdings(client: SnapTrade, user):
    """Positions from every connected investment account, merged. Returns (DataFrame, warnings)."""
    auth = _user_kwargs(user)
    connections = client.connections.list_brokerage_authorizations(**auth).body
    if not connections:
        raise ValueError(
            "No brokerage is connected to this session yet. Open the connection "
            "portal and sign in; if you already did, finish in the tab the "
            "portal returned you to, or connect again."
        )

    warnings = []
    positions = []
    account_count = 0
    for connection in connections:
        name = _text((connection.get("brokerage") or {}).get("display_name")) or _text(connection.get("name"))
        if connection.get("disabled"):
            warnings.append(f"The {name} connection is disabled; its holdings are the last cached copy.")
        accounts = client.connections.list_connection_accounts(
            connection_id=str(connection["id"]), **auth
        ).body["results"]
        for account in accounts:
            if _text(account.get("kind")) != "investment" or account.get("is_paper"):
                continue
            account_count += 1
            label = account_type(account)
            positions.extend(
                {**position, "account": label}
                for position in client.account_information.get_all_account_positions(
                    account_id=str(account["id"]), **auth
                ).body["results"]
            )

    if not account_count:
        raise ValueError("The connected brokerage has no investment accounts yet. If you just connected, try again in a minute.")
    holdings, position_warnings = positions_to_holdings(positions)
    if holdings.empty:
        raise ValueError(f"Found {account_count} account(s) but no stock or ETF positions. {' '.join(position_warnings)}".strip())
    return holdings, [*warnings, *position_warnings]
