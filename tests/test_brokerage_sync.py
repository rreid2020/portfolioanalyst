"""Tests for brokerage_sync with SnapTrade's HTTP API mocked.

Run: python -m unittest discover -s tests
"""
import json
import os
import sys
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from urllib.parse import parse_qs, urlparse

import urllib3

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _isolation  # noqa: E402,F401  (temp database for the app)
sys.path.insert(0, str(ROOT))

import brokerage_sync  # noqa: E402

ENV = {"SNAPTRADE_CLIENT_ID": "TEST-CLIENT", "SNAPTRADE_CONSUMER_KEY": "test-consumer-key"}
CONN_WS, CONN_QT, ACCT_TFSA, ACCT_PAPER, ACCT_RRSP, ACCT_1 = (str(uuid.uuid4()) for _ in range(6))


def environ(extra):
    """The real environment without SnapTrade settings, plus extra."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("SNAPTRADE_")}
    return {**env, **extra}


def stock(symbol, exchange, units, cost, currency, kind="stock"):
    return {
        "instrument": {"kind": kind, "id": str(uuid.uuid5(uuid.NAMESPACE_URL, symbol)), "symbol": symbol, "raw_symbol": symbol, "exchange": exchange},
        "units": str(units),
        "price": "1.0",
        "cost_basis": None if cost is None else str(cost),
        "currency": currency,
    }


def investment_account(account_id, connection_id, is_paper=False, raw_type=None, display_name=None):
    account = {
        "kind": "investment",
        "id": account_id,
        "connection_id": connection_id,
        "masked_account_number": "****1234",
        "sync_status": {},
        "is_paper": is_paper,
    }
    if raw_type is not None:
        account["raw_type"] = raw_type
    if display_name is not None:
        account["display_name"] = display_name
    return account


class HTTPError:
    def __init__(self, status, payload):
        self.status, self.payload = status, payload


class FakeSnapTradeAPI:
    """Stands in for api.snaptrade.com at the urllib3 layer, so the real SDK
    signs, sends and deserializes every request."""

    def __init__(self, routes):
        self.routes = routes  # (method, path suffix) -> JSON-able body
        self.requests = []

    def request(self, pool, method, url, **kwargs):
        parsed = urlparse(url)
        body = kwargs.get("body")
        self.requests.append({
            "method": method,
            "path": parsed.path,
            "query": {k: v[0] for k, v in parse_qs(parsed.query).items()},
            "body": json.loads(body) if body else None,
        })
        for (route_method, suffix), payload in self.routes.items():
            if method == route_method and parsed.path.endswith(suffix):
                status = 200
                if isinstance(payload, HTTPError):
                    status, payload = payload.status, payload.payload
                return urllib3.HTTPResponse(
                    body=json.dumps(payload).encode(),
                    status=status,
                    headers={"content-type": "application/json"},
                    preload_content=True,
                )
        raise AssertionError(f"Unexpected SnapTrade request {method} {parsed.path}")

    def __enter__(self):
        fake = self

        def request(pool, method, url, **kwargs):
            return fake.request(pool, method, url, **kwargs)

        self._patch = mock.patch.object(urllib3.PoolManager, "request", request)
        self._patch.start()
        return self

    def __exit__(self, *exc):
        self._patch.stop()

    def find(self, method, suffix):
        return [r for r in self.requests if r["method"] == method and r["path"].endswith(suffix)]


USER = {"user_id": "portfolio-analyst-1-abc", "user_secret": "secret-1"}

HOLDINGS_ROUTES = {
    ("GET", "/authorizations"): [
        {"id": CONN_WS, "brokerage": {"display_name": "Wealthsimple", "slug": "WEALTHSIMPLETRADE"}, "disabled": False},
        {"id": CONN_QT, "brokerage": {"display_name": "Questrade", "slug": "QUESTRADE"}, "disabled": True},
    ],
    ("GET", f"/connections/{CONN_WS}/accounts"): {"results": [
        investment_account(ACCT_TFSA, CONN_WS, raw_type="ca_tfsa"),
        investment_account(ACCT_PAPER, CONN_WS, is_paper=True),
    ]},
    ("GET", f"/connections/{CONN_QT}/accounts"): {"results": [
        investment_account(ACCT_RRSP, CONN_QT, display_name="My Spousal RRSP"),
    ]},
    ("GET", f"/accounts/{ACCT_TFSA}/positions/all"): {
        "results": [
            stock("SHOP", "XTSE", 10, 100, "CAD"),
            stock("AAPL", "XNAS", 2, 150, "USD"),
            {"instrument": {"kind": "mutualfund", "id": str(uuid.uuid4()), "symbol": "TDB902", "raw_symbol": "TDB902"}, "units": "5"},
        ],
        "data_freshness": {"as_of": "2026-10-21T12:00:00Z"},
    },
    ("GET", f"/accounts/{ACCT_RRSP}/positions/all"): {
        "results": [stock("SHOP", "XTSE", 30, 120, "CAD"), stock("RCI.B", "XTSE", 4, 50, "CAD")],
        "data_freshness": {"as_of": "2026-10-21T12:00:00Z"},
    },
}


@mock.patch.dict(os.environ, environ(ENV), clear=True)
class FetchHoldingsTest(unittest.TestCase):
    def test_keeps_accounts_apart_through_the_sdk(self):
        with FakeSnapTradeAPI(HOLDINGS_ROUTES) as api:
            holdings, warnings = brokerage_sync.fetch_holdings(brokerage_sync.make_client(), USER)

        rows = {(r["Ticker"], r["Account"]): r for r in holdings.to_dict("records")}
        self.assertEqual(list(holdings.columns), ["Ticker", "Shares", "Avg Buy Price", "Currency", "Account"])
        # raw_type "ca_tfsa" -> TFSA; without a raw_type the name "My Spousal RRSP" -> RRSP.
        self.assertEqual(set(rows), {("SHOP.TO", "TFSA"), ("AAPL", "TFSA"), ("SHOP.TO", "RRSP"), ("RCI-B.TO", "RRSP")})
        self.assertEqual(rows[("SHOP.TO", "TFSA")]["Shares"], 10)
        self.assertEqual(rows[("SHOP.TO", "RRSP")]["Shares"], 30)
        self.assertAlmostEqual(rows[("SHOP.TO", "RRSP")]["Avg Buy Price"], 120)
        self.assertEqual(rows[("SHOP.TO", "TFSA")]["Currency"], "CAD")
        self.assertEqual(rows[("AAPL", "TFSA")]["Currency"], "USD")
        # The paper account is never read.
        self.assertFalse(api.find("GET", f"/accounts/{ACCT_PAPER}/positions/all"))
        self.assertTrue(any("Questrade connection is disabled" in w for w in warnings))
        self.assertTrue(any("1 mutualfund" in w for w in warnings))
        # Commercial keys send the SnapTrade user on every account call.
        for request in api.find("GET", "/positions/all"):
            self.assertEqual(request["query"]["userId"], USER["user_id"])
            self.assertEqual(request["query"]["userSecret"], USER["user_secret"])

    def test_no_connections_raises(self):
        with FakeSnapTradeAPI({("GET", "/authorizations"): []}):
            with self.assertRaisesRegex(ValueError, "No brokerage is connected"):
                brokerage_sync.fetch_holdings(brokerage_sync.make_client(), USER)

    def test_portal_link_is_read_only(self):
        routes = {("POST", "/snapTrade/login"): {"redirectURI": "https://app.snaptrade.com/connect?x=1", "sessionId": "s"}}
        with FakeSnapTradeAPI(routes) as api:
            url = brokerage_sync.connection_portal_url(brokerage_sync.make_client(), USER)
        self.assertEqual(url, "https://app.snaptrade.com/connect?x=1")
        (login,) = api.find("POST", "/snapTrade/login")
        self.assertEqual(login["body"]["connectionType"], "read")
        self.assertEqual(login["query"]["userId"], USER["user_id"])

    def test_portal_redirects_back_to_the_app(self):
        routes = {("POST", "/snapTrade/login"): {"redirectURI": "https://app.snaptrade.com/connect", "sessionId": "s"}}
        with FakeSnapTradeAPI(routes) as api:
            brokerage_sync.connection_portal_url(
                brokerage_sync.make_client(), USER, redirect_url="https://stocks.example.com/?brokerage=tok"
            )
        (login,) = api.find("POST", "/snapTrade/login")
        self.assertEqual(login["body"]["customRedirect"], "https://stocks.example.com/?brokerage=tok")
        self.assertTrue(login["body"]["immediateRedirect"])

    @mock.patch.dict(os.environ, {"SNAPTRADE_KEY_TYPE": "personal"})
    def test_personal_key_sends_no_user(self):
        routes = {("POST", "/snapTrade/login"): {"redirectURI": "https://app.snaptrade.com/connect", "sessionId": "s"}}
        with FakeSnapTradeAPI(routes) as api:
            brokerage_sync.connection_portal_url(brokerage_sync.make_client(), None)
        (login,) = api.find("POST", "/snapTrade/login")
        self.assertNotIn("userId", login["query"])
        self.assertNotIn("userSecret", login["query"])

    def test_api_errors_are_shortened(self):
        routes = {("POST", "/snapTrade/login"): HTTPError(401, {"detail": "Invalid clientId", "status_code": 401})}
        with FakeSnapTradeAPI(routes):
            with self.assertRaises(Exception) as caught:
                brokerage_sync.connection_portal_url(brokerage_sync.make_client(), USER)
        self.assertEqual(brokerage_sync.error_message(caught.exception), "SnapTrade returned HTTP 401: Invalid clientId")
        self.assertEqual(brokerage_sync.error_message(ValueError("plain")), "plain")

    def test_register_deletes_only_stale_users_of_this_app(self):
        now = int(time.time())
        stale = f"portfolio-analyst-{now - 2 * brokerage_sync.STALE_USER_SECONDS}-old"
        fresh = f"portfolio-analyst-{now - 60}-new"
        routes = {
            ("GET", "/snapTrade/listUsers"): [stale, fresh, "someone-elses-user"],
            ("DELETE", "/snapTrade/deleteUser"): {"status": "deleted", "detail": "queued", "userId": stale},
            ("POST", "/snapTrade/registerUser"): {"userId": "portfolio-analyst-x", "userSecret": "generated"},
        }
        with FakeSnapTradeAPI(routes) as api:
            user = brokerage_sync.register_user(brokerage_sync.make_client())

        self.assertEqual(user, {"user_id": "portfolio-analyst-x", "user_secret": "generated"})
        deleted = [r["query"]["userId"] for r in api.find("DELETE", "/snapTrade/deleteUser")]
        self.assertEqual(deleted, [stale])
        (register,) = api.find("POST", "/snapTrade/registerUser")
        self.assertTrue(register["body"]["userId"].startswith(brokerage_sync.USER_ID_PREFIX))

    def test_register_survives_cleanup_failure(self):
        routes = {("POST", "/snapTrade/registerUser"): {"userId": "u", "userSecret": "s"}}
        with FakeSnapTradeAPI(routes):  # listUsers is unrouted, so cleanup fails
            self.assertEqual(brokerage_sync.register_user(brokerage_sync.make_client())["user_secret"], "s")


class PositionsToHoldingsTest(unittest.TestCase):
    def test_lots_in_one_account_merge(self):
        holdings, _ = brokerage_sync.positions_to_holdings([
            {**stock("XEQT", "XTSE", 10, 30, "CAD"), "account": "TFSA"},
            {**stock("XEQT", "XTSE", 10, 40, "CAD"), "account": "TFSA"},
            {**stock("XEQT", "XTSE", 5, 50, "CAD"), "account": "RRSP"},
        ])
        self.assertEqual(holdings.to_dict("records"), [
            {"Ticker": "XEQT.TO", "Shares": 20.0, "Avg Buy Price": 35.0, "Currency": "CAD", "Account": "TFSA"},
            {"Ticker": "XEQT.TO", "Shares": 5.0, "Avg Buy Price": 50.0, "Currency": "CAD", "Account": "RRSP"},
        ])

    def test_account_type_falls_back_to_the_name(self):
        self.assertEqual(brokerage_sync.account_type({"raw_type": "RRSP"}), "RRSP")
        self.assertEqual(brokerage_sync.account_type({"raw_type": "weird", "display_name": "Kids RESP"}), "RESP")
        self.assertEqual(brokerage_sync.account_type({"raw_type": "weird"}), "Other")
        self.assertEqual(brokerage_sync.account_type({}), "")

    def test_symbol_mapping(self):
        holdings, _ = brokerage_sync.positions_to_holdings([
            stock("VFV", "TSX", 1, 100, "CAD"),
            stock("ABC", "XTSX", 1, 1, "CAD"),
            stock("BRK.B", "XNYS", 1, 300, "USD"),
            stock("ZZZ", None, 1, 1, "USD", kind="etf"),
        ])
        self.assertEqual(list(holdings["Ticker"]), ["VFV.TO", "ABC.V", "BRK-B", "ZZZ"])

    def test_missing_cost_and_short_positions(self):
        holdings, warnings = brokerage_sync.positions_to_holdings([
            stock("AAPL", "XNAS", 1, 150, "USD"),
            stock("AAPL", "XNAS", 1, None, "USD"),
            stock("TSLA", "XNAS", -3, 200, "USD"),
            stock("SPY 260116C00500000", None, 1, 5, "USD", kind="option"),
        ])
        self.assertEqual(holdings.to_dict("records"), [
            {"Ticker": "AAPL", "Shares": 2.0, "Avg Buy Price": None, "Currency": "USD", "Account": ""},
        ])
        self.assertIn("Skipped positions yfinance can't price (1 option).", warnings)
        self.assertIn("Skipped 1 position(s) without a positive quantity.", warnings)


@mock.patch.dict(os.environ, environ(ENV), clear=True)
class UserTokenTest(unittest.TestCase):
    def test_round_trip(self):
        token = brokerage_sync.seal_user(USER)
        self.assertNotIn(USER["user_secret"], token)
        self.assertEqual(brokerage_sync.unseal_user(token), USER)

    def test_rejects_expired_tampered_and_foreign_tokens(self):
        token = brokerage_sync.seal_user(USER)
        later = time.time() + brokerage_sync.STALE_USER_SECONDS + 5
        with mock.patch("cryptography.fernet.time.time", return_value=later):
            self.assertIsNone(brokerage_sync.unseal_user(token))
        self.assertIsNone(brokerage_sync.unseal_user(token[:-4] + "AAAA"))
        self.assertIsNone(brokerage_sync.unseal_user("not-a-token"))
        with mock.patch.dict(os.environ, {"SNAPTRADE_CONSUMER_KEY": "another-key"}):
            self.assertIsNone(brokerage_sync.unseal_user(token))


class ConfigTest(unittest.TestCase):
    def test_hidden_without_keys(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(brokerage_sync.is_configured())
        with mock.patch.dict(os.environ, ENV, clear=True):
            self.assertTrue(brokerage_sync.is_configured())
            self.assertFalse(brokerage_sync.is_personal())


def fake_client():
    client = mock.MagicMock()
    client.authentication.list_snap_trade_users.return_value = SimpleNamespace(body=[])
    client.authentication.register_snap_trade_user.return_value = SimpleNamespace(
        body={"userId": "portfolio-analyst-1-ui", "userSecret": "ui-secret"}
    )
    client.authentication.login_snap_trade_user.return_value = SimpleNamespace(
        body={"redirectURI": "https://app.snaptrade.com/connect?ui", "sessionId": "s"}
    )
    client.connections.list_brokerage_authorizations.return_value = SimpleNamespace(
        body=[{"id": CONN_WS, "brokerage": {"display_name": "Wealthsimple"}, "disabled": False}]
    )
    client.connections.list_connection_accounts.return_value = SimpleNamespace(
        body={"results": [investment_account(ACCT_1, CONN_WS, raw_type="TFSA")]}
    )
    client.account_information.get_all_account_positions.return_value = SimpleNamespace(
        body={"results": [stock("XEQT", "XTSE", 12.5, 30, "CAD")]}
    )
    return client


class StreamlitUITest(unittest.TestCase):
    def setUp(self):
        # Keep the dashboard offline: no live quotes, so nothing is priced.
        import portfolio_metrics

        patcher = mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=lambda tickers: dict.fromkeys(tickers))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_app(self, env):
        from streamlit.testing.v1 import AppTest

        with mock.patch.dict(os.environ, environ(env), clear=True):
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60)
            app.run()
        return app

    def test_expander_hidden_without_keys(self):
        app = self.run_app({})
        self.assertNotIn("Connect brokerage", [e.label for e in app.expander])

    def test_connect_and_load_holdings(self):
        client = fake_client()
        with mock.patch.object(brokerage_sync, "make_client", return_value=client), \
                mock.patch.dict(os.environ, environ(ENV), clear=True):
            from streamlit.testing.v1 import AppTest

            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
            self.assertIn("Connect brokerage", [e.label for e in app.expander])
            load = next(b for b in app.button if b.label == "Load holdings")
            self.assertTrue(load.disabled)

            next(b for b in app.button if b.label == "Open connection portal").click().run()
            self.assertEqual(app.session_state.snaptrade_user["user_id"], "portfolio-analyst-1-ui")
            client.authentication.login_snap_trade_user.assert_called_once_with(
                connection_type="read", user_id="portfolio-analyst-1-ui", user_secret="ui-secret"
            )

            version = app.session_state.editor_version
            next(b for b in app.button if b.label == "Load holdings").click().run()

        self.assertFalse(app.exception)
        self.assertEqual(app.session_state.holdings.to_dict("records"), [
            {"Ticker": "XEQT.TO", "Shares": 12.5, "Avg Buy Price": 30.0, "Currency": "CAD", "Account": "TFSA"},
        ])
        self.assertEqual(app.session_state.editor_version, version + 1)
        # "Disconnect after loading" is on by default.
        client.authentication.delete_snap_trade_user.assert_called_once_with(user_id="portfolio-analyst-1-ui")
        self.assertNotIn("snaptrade_user", app.session_state)
        self.assertTrue(any("Loaded 1 holding(s)" in m.value for m in app.success))
        self.assertNotIn("brokerage", app.query_params)

    def test_session_reset_restores_user_from_url(self):
        client = fake_client()
        with mock.patch.object(brokerage_sync, "make_client", return_value=client),                 mock.patch.dict(os.environ, environ(ENV), clear=True):
            from streamlit.testing.v1 import AppTest

            first = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
            next(b for b in first.button if b.label == "Open connection portal").click().run()
            token = first.query_params["brokerage"]
            token = token[0] if isinstance(token, list) else token

            # A fresh session (Vercel recycled the WebSocket, or the portal
            # redirected a new tab back) with the same URL.
            second = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60)
            second.query_params["brokerage"] = token
            second.run()
            self.assertEqual(second.session_state.snaptrade_user["user_id"], "portfolio-analyst-1-ui")
            self.assertTrue(any("Brokerage connection found" in i.value for i in second.info))
            next(b for b in second.button if b.label == "Load holdings").click().run()

        self.assertEqual(list(second.session_state.holdings["Ticker"]), ["XEQT.TO"])
        client.authentication.register_snap_trade_user.assert_called_once()

    def test_bad_token_in_url_is_dropped(self):
        with mock.patch.dict(os.environ, environ(ENV), clear=True):
            from streamlit.testing.v1 import AppTest

            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60)
            app.query_params["brokerage"] = "garbage"
            app.run()
        self.assertNotIn("snaptrade_user", app.session_state)
        self.assertNotIn("brokerage", app.query_params)
        self.assertTrue(any("expired" in w.value for w in app.warning))


if __name__ == "__main__":
    unittest.main()
