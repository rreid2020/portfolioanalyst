"""Tests for the HTTP API (api/index.py) and its Clerk session check, with Yahoo Finance mocked.

Run: python -m unittest discover -s tests
"""
import base64
import json
import os
import re
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

import jwt
import pandas as pd
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling test helpers
import _isolation  # noqa: E402,F401  (temp database for the brokerage store)
sys.path.insert(0, str(ROOT))

import api.index  # noqa: E402
import brokerage_store  # noqa: E402
import brokerage_sync  # noqa: E402
import clerk_auth  # noqa: E402
import portfolio_analytics  # noqa: E402
import portfolio_metrics  # noqa: E402
import portfolio_service  # noqa: E402
import research  # noqa: E402
from api.index import app  # noqa: E402
from test_portfolio_metrics import fake_fetch_fx, fake_fetch_quotes, fake_history  # noqa: E402
from test_rebalance import fake_quotes as all_priced_quotes  # noqa: E402

# The Streamlit app's starting portfolio; only AAPL has a fake quote in fake_fetch_quotes.
HOLDINGS = [
    {"ticker": "AAPL", "shares": 10, "avgBuyPrice": 150.0, "currency": "USD", "account": "TFSA"},
    {"ticker": "MSFT", "shares": 5, "avgBuyPrice": 310.0, "currency": "USD", "account": "RRSP"},
    {"ticker": "NVDA", "shares": 4, "avgBuyPrice": 420.0, "currency": "USD", "account": "Non-registered"},
]
NO_AUTH_ENV = ("CLERK_", "NEXT_PUBLIC_CLERK_", "VERCEL")


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith(NO_AUTH_ENV)}
    return mock.patch.dict(os.environ, {**env, **extra}, clear=True)


class ApiTestCase(unittest.TestCase):
    quotes = staticmethod(fake_fetch_quotes)

    def setUp(self):
        patches = [
            clean_env(),
            mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=self.quotes),
            mock.patch.object(portfolio_metrics, "fetch_fx", side_effect=fake_fetch_fx),
            mock.patch.object(portfolio_analytics, "fetch_history", side_effect=fake_history),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        portfolio_service.clear_caches()
        self.addCleanup(portfolio_service.clear_caches)
        self.client = TestClient(app)


class FiguresTest(ApiTestCase):
    def test_totals_and_unpriced(self):
        r = self.client.post("/api/py/figures", json={"holdings": HOLDINGS, "base": "CAD"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["totals"]["value"], 2800)
        self.assertEqual(body["totals"]["pl"], 700)
        self.assertEqual(body["unpriced"], ["MSFT", "NVDA"])
        self.assertEqual(body["fx"], {"USD": 1.4})
        (position,) = body["positions"]
        self.assertEqual(position["ticker"], "AAPL")
        self.assertEqual(position["account"], "TFSA")
        self.assertAlmostEqual(position["plPct"], 100 * 700 / 2100, places=12)
        self.assertEqual(position["weightPct"], 100)
        self.assertEqual(set(body["allocation"]), {"Holding", "Account", "Sector", "Country", "Currency"})
        self.assertEqual(body["allocation"]["Sector"], [{"group": "Technology", "value": 2800.0, "weightPct": 100.0}])

    def test_usd_base(self):
        r = self.client.post("/api/py/figures", json={"holdings": HOLDINGS, "base": "USD"})
        self.assertEqual(r.json()["totals"]["value"], 2000)

    def test_rows_are_cleaned_like_the_editor(self):
        holdings = [
            {"ticker": " aapl ", "shares": 10, "account": "tax-free savings"},
            {"ticker": "", "shares": 3},
            {"ticker": "MSFT", "shares": 0},
        ]
        r = self.client.post("/api/py/figures", json={"holdings": holdings})
        (position,) = r.json()["positions"]
        self.assertEqual((position["ticker"], position["account"], position["cost"]), ("AAPL", "TFSA", None))

    def test_needs_a_holding(self):
        r = self.client.post("/api/py/figures", json={"holdings": [{"ticker": "AAPL", "shares": 0}]})
        self.assertEqual(r.status_code, 422)

    def test_rejects_unknown_currency(self):
        r = self.client.post("/api/py/figures", json={"holdings": HOLDINGS, "base": "EUR"})
        self.assertEqual(r.status_code, 422)


class AnalyticsTest(ApiTestCase):
    def test_performance_dividends_and_accounts(self):
        r = self.client.post("/api/py/analytics", json={"holdings": HOLDINGS, "benchmark": "SPY", "period": "6M"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        performance = body["performance"]
        self.assertEqual((performance["period"], performance["benchmark"]), ("6M", "SPY"))
        self.assertEqual(performance["benchmarkName"], "S&P 500 (SPY)")
        self.assertRegex(performance["start"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(performance["series"][0]["portfolio"], 100)
        self.assertEqual(set(performance["series"][0]), {"date", "portfolio", "benchmark"})
        self.assertRegex(performance["series"][-1]["date"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(performance["correlation"], {"tickers": [], "matrix": []})
        self.assertAlmostEqual(body["dividends"]["totalIncome"], 14)
        self.assertEqual(body["accountSummary"][0]["account"], "TFSA")
        self.assertEqual(body["accountSummary"][0]["annualIncome"], 14)
        # US dividends in a TFSA lose the 15% withholding.
        self.assertTrue(any(h["account"] == "TFSA" and "AAPL" in h["tickers"] for h in body["hints"]))

    def test_unknown_period(self):
        r = self.client.post("/api/py/analytics", json={"holdings": HOLDINGS, "period": "2W"})
        self.assertEqual(r.status_code, 422)


class RebalanceTest(ApiTestCase):
    quotes = staticmethod(all_priced_quotes)

    def test_starts_on_target(self):
        r = self.client.post("/api/py/rebalance", json={"holdings": HOLDINGS})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertFalse(body["plan"]["hasTrades"])
        self.assertEqual(body["accounts"], ["TFSA", "RRSP", "Non-registered"])
        self.assertEqual([c["group"] for c in body["current"]], ["AAPL", "MSFT", "NVDA"])

    def test_rounded_current_weights_mean_keep(self):
        current = self.client.post("/api/py/rebalance", json={"holdings": HOLDINGS}).json()["current"]
        targets = {c["group"]: c["currentPct"] for c in current}
        r = self.client.post("/api/py/rebalance", json={"holdings": HOLDINGS, "targets": targets})
        self.assertFalse(r.json()["plan"]["hasTrades"])

    def test_buy_only_new_cash(self):
        r = self.client.post("/api/py/rebalance", json={"holdings": HOLDINGS, "cash": 1000, "buyOnly": True})
        plan = r.json()["plan"]
        self.assertTrue(plan["hasTrades"])
        self.assertAlmostEqual(plan["totalBuys"], 1000, delta=1)
        self.assertEqual(plan["totalSells"], 0)
        self.assertTrue(all(t["action"] == "Buy" for t in plan["trades"]))

    def test_new_holding_and_unknown_ticker(self):
        targets = {"aapl": 0, "MSFT": 50, "NVDA": 25, "nope": 25}
        with mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=lambda t: {
            **all_priced_quotes(t), **({"NOPE": None} if "NOPE" in t else {})
        }):
            r = self.client.post("/api/py/rebalance", json={"holdings": HOLDINGS, "targets": targets})
        body = r.json()
        self.assertEqual(body["unknown"], ["NOPE"])
        self.assertIn("AAPL", {t["ticker"] for t in body["plan"]["trades"]})

    def test_one_account_scope(self):
        r = self.client.post("/api/py/rebalance", json={"holdings": HOLDINGS, "scope": "RRSP", "groupBy": "Sector"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["plan"]["scope"], "RRSP")
        r = self.client.post("/api/py/rebalance", json={"holdings": HOLDINGS, "scope": "FHSA"})
        self.assertEqual(r.status_code, 422)


class PromptTest(ApiTestCase):
    def test_prompt_has_every_figure(self):
        r = self.client.post("/api/py/prompt", json={"holdings": HOLDINGS, "question": "Focus on risk."})
        self.assertEqual(r.status_code, 200, r.text)
        prompt = r.json()["prompt"]
        self.assertIn("| AAPL | 10.0 | 150.0 | USD | TFSA |", prompt)
        self.assertIn("Figures computed from live Yahoo Finance quotes, in CAD", prompt)
        self.assertIn("Total market value: 2,800.00 CAD", prompt)
        self.assertIn("Backtest of today's holdings", prompt)
        self.assertIn("(1Y)", prompt)
        self.assertIn("expected annual income 14.00 CAD", prompt)
        self.assertNotIn("Proposed rebalance", prompt)
        self.assertTrue(prompt.endswith("Focus on risk."))

    def test_rebalance_flows_into_the_prompt(self):
        with mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=all_priced_quotes):
            r = self.client.post("/api/py/prompt", json={
                "holdings": HOLDINGS, "rebalance": {"cash": 1000, "buyOnly": True},
            })
        prompt = r.json()["prompt"]
        self.assertIn("Proposed rebalance (holding targets, all accounts, in CAD", prompt)
        self.assertIn("New cash 1,000.00", prompt)
        self.assertTrue(prompt.endswith("Analyze my portfolio end-to-end."))


class ImportTest(ApiTestCase):
    def test_template_round_trip(self):
        template = self.client.get("/api/py/template.csv")
        self.assertEqual(template.status_code, 200)
        r = self.client.post("/api/py/import", files={"file": ("portfolio.csv", template.content, "text/csv")})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["holdings"], [
            {"ticker": "AAPL", "shares": 10.0, "avgBuyPrice": 150.0, "currency": "USD", "account": "RRSP"},
            {"ticker": "SHOP.TO", "shares": 20.0, "avgBuyPrice": 95.5, "currency": "CAD", "account": "TFSA"},
        ])

    def test_unreadable_file(self):
        r = self.client.post("/api/py/import", files={"file": ("notes.csv", b"hello,world\n1,2\n", "text/csv")})
        self.assertEqual(r.status_code, 422)
        self.assertIn("header row", r.json()["detail"])


class MetaAndResearchTest(ApiTestCase):
    def test_meta(self):
        body = self.client.get("/api/py/meta").json()
        self.assertEqual(body["columns"], ["ticker", "shares", "avgBuyPrice", "currency", "account"])
        self.assertIn("TFSA", body["accountTypes"])
        self.assertEqual(body["defaultBenchmark"], "XIC.TO")

    def test_editor_account_types_match(self):
        source = (ROOT / "src" / "lib" / "accounts.ts").read_text(encoding="utf-8")
        listed = json.loads(re.search(r"ACCOUNT_TYPES = (\[.*?\]) as const", source).group(1))
        self.assertEqual(listed, self.client.get("/api/py/meta").json()["accountTypes"])

    def test_research_lookups(self):
        with mock.patch.object(research, "fundamentals", return_value={"symbol": "AAPL", "pe_ratio": 30.0}) as f:
            r = self.client.get("/api/py/research/fundamentals", params={"symbol": "aapl"})
        self.assertEqual(r.json()["pe_ratio"], 30.0)
        f.assert_called_once_with("AAPL")
        with mock.patch.object(research, "price", side_effect=LookupError("No price for ZZZZ.")):
            r = self.client.get("/api/py/research/price", params={"symbol": "ZZZZ"})
        self.assertEqual((r.status_code, r.json()["detail"]), (404, "No price for ZZZZ."))

    def test_news_falls_back_to_a_web_search(self):
        found = [{"title": "Apple rallies", "snippet": "...", "url": "https://news.test/a", "date": "2026-10-20", "source": "Wire"}]
        with mock.patch.object(research.yf, "Ticker") as ticker,                 mock.patch.object(research, "search", return_value=found) as search:
            ticker.return_value.news = []
            r = self.client.get("/api/py/research/news", params={"symbol": "AAPL", "limit": 3})
        search.assert_called_once_with("AAPL stock", news_only=True, limit=3)
        self.assertEqual(r.json(), [{"title": "Apple rallies", "summary": "...", "published": "2026-10-20",
                                     "publisher": "Wire", "url": "https://news.test/a"}])

    def test_history_rejects_bad_period(self):
        r = self.client.get("/api/py/research/history", params={"symbol": "AAPL", "period": "forever"})
        self.assertEqual(r.status_code, 422)


class BrokerageTest(ApiTestCase):
    """SnapTrade itself is faked; test_brokerage_sync.py covers the SDK calls."""

    USER = {"user_id": "portfolio-user-abc", "user_secret": "secret"}

    def setUp(self):
        super().setUp()
        self.snaptrade = mock.MagicMock()
        patches = [
            mock.patch.dict(os.environ, {"SNAPTRADE_CLIENT_ID": "id", "SNAPTRADE_CONSUMER_KEY": "key"}),
            mock.patch.object(brokerage_sync, "make_client", return_value=self.snaptrade),
            mock.patch.object(brokerage_sync, "register_user", return_value=dict(self.USER)),
            mock.patch.object(brokerage_sync, "connection_portal_url", return_value="https://app.snaptrade.com/portal?x"),
            mock.patch.object(brokerage_sync, "delete_user"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        api.index._engine.cache_clear()
        self.store = brokerage_store.BrokerageStore(api.index._engine(), clerk_auth.LOCAL_USER_ID)
        self.store.delete()
        self.addCleanup(self.store.delete)

    def connect(self, redirect="http://testserver/portfolios/1/edit?brokerage=connected"):
        return self.client.post("/api/py/brokerage/connect", json={"redirectUrl": redirect})

    def test_hidden_without_keys(self):
        with mock.patch.dict(os.environ, {"SNAPTRADE_CLIENT_ID": ""}):
            self.assertEqual(self.client.get("/api/py/brokerage").json(), {"configured": False, "connected": False})
            self.assertEqual(self.connect().status_code, 404)

    def test_connect_saves_one_snaptrade_user_and_reuses_it(self):
        self.assertFalse(self.client.get("/api/py/brokerage").json()["connected"])
        r = self.connect()
        self.assertEqual(r.json(), {"url": "https://app.snaptrade.com/portal?x"})
        brokerage_sync.register_user.assert_called_once_with(self.snaptrade, saved=True)
        args, kwargs = brokerage_sync.connection_portal_url.call_args
        self.assertEqual(args[1], self.USER)
        self.assertEqual(kwargs["redirect_url"], "http://testserver/portfolios/1/edit?brokerage=connected")
        self.assertTrue(self.client.get("/api/py/brokerage").json()["connected"])
        self.connect()
        brokerage_sync.register_user.assert_called_once()  # the saved user is reused

    def test_secret_is_stored_encrypted(self):
        self.connect()
        with api.index._engine().connect() as conn:
            (sealed,) = api.index._engine().execute(conn, "SELECT sealed_user FROM brokerage_connections").fetchone()
        self.assertNotIn("secret", sealed)
        self.assertEqual(self.store.get()["user_secret"], "secret")

    def test_return_address_must_be_this_site(self):
        self.assertEqual(self.connect("https://evil.example/steal").status_code, 422)
        self.assertEqual(self.connect("javascript:alert(1)").status_code, 422)
        brokerage_sync.register_user.assert_not_called()

    def test_load_holdings(self):
        self.assertEqual(self.client.post("/api/py/brokerage/holdings").status_code, 409)
        self.connect()
        table = pd.DataFrame([{"Ticker": "SHOP.TO", "Shares": 3.0, "Avg Buy Price": 90.0, "Currency": "CAD", "Account": "TFSA"}])
        with mock.patch.object(brokerage_sync, "fetch_holdings", return_value=(table, ["Skipped 1 option."])) as fetch:
            r = self.client.post("/api/py/brokerage/holdings")
        self.assertEqual(fetch.call_args.args[1]["user_secret"], "secret")
        self.assertEqual(r.json(), {
            "holdings": [{"ticker": "SHOP.TO", "shares": 3.0, "avgBuyPrice": 90.0, "currency": "CAD", "account": "TFSA"}],
            "warnings": ["Skipped 1 option."],
        })
        with mock.patch.object(brokerage_sync, "fetch_holdings", side_effect=ValueError("No brokerage is connected")):
            r = self.client.post("/api/py/brokerage/holdings")
        self.assertEqual((r.status_code, r.json()["detail"]), (409, "No brokerage is connected"))

    def test_disconnect_deletes_the_snaptrade_user(self):
        self.connect()
        self.assertEqual(self.client.delete("/api/py/brokerage").json(), {"connected": False})
        brokerage_sync.delete_user.assert_called_once()
        self.assertIsNone(self.store.get())
        self.assertFalse(self.client.get("/api/py/brokerage").json()["connected"])

    def test_snaptrade_errors_are_reported(self):
        brokerage_sync.register_user.side_effect = RuntimeError("down")
        r = self.connect()
        self.assertEqual((r.status_code, r.json()["detail"]), (502, "Couldn't reach SnapTrade: down"))
        self.assertIsNone(self.store.get())


def make_key():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return key, public.decode()


class ClerkSessionTest(unittest.TestCase):
    KEY, PUBLIC_PEM = make_key()
    ISSUER = "https://clerk.example.test"

    def token(self, key=None, **claims):
        now = int(time.time())
        payload = {"sub": "user_123", "iss": self.ISSUER, "azp": "https://portfolio.example.test",
                   "iat": now, "nbf": now, "exp": now + 60, **claims}
        return jwt.encode(payload, key or self.KEY, algorithm="RS256")

    def configured(self, **extra):
        # Vercel-style PEM on one line with literal \n.
        return clean_env(
            CLERK_JWT_KEY=self.PUBLIC_PEM.replace("\n", "\\n"), CLERK_ISSUER_URL=self.ISSUER + "/", **extra
        )

    def setUp(self):
        self.client = TestClient(app)

    def get_private(self, **kwargs):
        with mock.patch.object(research, "price", return_value={"symbol": "AAPL"}):
            return self.client.get("/api/py/research/price", params={"symbol": "AAPL"}, **kwargs)

    def test_local_development_needs_no_token(self):
        with clean_env():
            self.assertEqual(self.get_private().status_code, 200)

    def test_vercel_without_settings_fails_closed(self):
        with clean_env(VERCEL="1"):
            r = self.get_private()
        self.assertEqual(r.status_code, 503)
        self.assertEqual(self.client.get("/api/py/health").status_code, 200)

    def test_bearer_token(self):
        with self.configured():
            self.assertEqual(self.get_private().status_code, 401)
            r = self.get_private(headers={"Authorization": f"Bearer {self.token()}"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_session_cookie(self):
        with self.configured():
            self.client.cookies.set("__session", self.token())
            r = self.get_private()
            self.client.cookies.clear()
        self.assertEqual(r.status_code, 200, r.text)

    def test_rejected_tokens(self):
        other_key, _ = make_key()
        bad = {
            "expired": self.token(exp=int(time.time()) - 60),
            "other key": self.token(key=other_key),
            "other issuer": self.token(iss="https://clerk.elsewhere.test"),
            "no subject": self.token(sub=None),
            "garbage": "not-a-token",
        }
        with self.configured():
            for name, token in bad.items():
                with self.subTest(name):
                    r = self.get_private(headers={"Authorization": f"Bearer {token}"})
                    self.assertEqual(r.status_code, 401)

    def test_issuer_comes_from_the_publishable_key(self):
        key = "pk_test_" + base64.b64encode(b"clerk.example.test$").decode().rstrip("=")
        self.assertEqual(clerk_auth.issuer_from_publishable_key(key), self.ISSUER)
        self.assertIsNone(clerk_auth.issuer_from_publishable_key("sk_test_abc"))
        self.assertIsNone(clerk_auth.issuer_from_publishable_key("pk_test_!!!"))
        with clean_env(CLERK_JWT_KEY=self.PUBLIC_PEM, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=key):
            ok = self.get_private(headers={"Authorization": f"Bearer {self.token()}"})
            other = self.get_private(headers={"Authorization": f"Bearer {self.token(iss='https://clerk.elsewhere.test')}"})
        self.assertEqual((ok.status_code, other.status_code), (200, 401))
        # The publishable key wins over a stale CLERK_ISSUER_URL from the Streamlit app.
        with clean_env(CLERK_JWT_KEY=self.PUBLIC_PEM, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=key, CLERK_ISSUER_URL="https://old.example.test"):
            self.assertEqual(self.get_private(headers={"Authorization": f"Bearer {self.token()}"}).status_code, 200)

    def test_authorized_parties(self):
        with self.configured(CLERK_AUTHORIZED_PARTIES="https://portfolio.example.test/, http://localhost:3000"):
            ok = self.get_private(headers={"Authorization": f"Bearer {self.token()}"})
            other = self.get_private(headers={"Authorization": f"Bearer {self.token(azp='https://evil.test')}"})
        self.assertEqual((ok.status_code, other.status_code), (200, 401))


if __name__ == "__main__":
    unittest.main()
