"""Tests for sign-in settings, the sign-in gate and saved portfolios.

Run: python -m unittest discover -s tests
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _isolation  # noqa: E402,F401  (temp database for the app)

sys.path.insert(0, str(ROOT))

import access  # noqa: E402
import auth_config  # noqa: E402
import db  # noqa: E402
import portfolio_metrics  # noqa: E402

TABLE = pd.DataFrame([
    {"Ticker": "xeqt.to", "Shares": 10, "Avg Buy Price": 30.0, "Currency": "", "Account": "TFSA"},
    {"Ticker": "AAPL", "Shares": 2.5, "Avg Buy Price": None, "Currency": "usd", "Account": None},
    {"Ticker": "", "Shares": 1, "Avg Buy Price": 1, "Currency": "", "Account": ""},  # blank row: skipped
])


def temp_engine():
    folder = tempfile.mkdtemp(prefix="portfolio-db-")
    return db.make_engine("sqlite:///" + os.path.join(folder, "t.db").replace("\\", "/"))


class StoreTest(unittest.TestCase):
    def setUp(self):
        engine = temp_engine()
        self.alice = db.Store(engine, "user_alice")
        self.bob = db.Store(engine, "user_bob")
        self.alice.touch_user(email="alice@example.com", name="Alice")
        self.bob.touch_user(email="bob@example.com", name="Bob")

    def test_save_and_load_round_trip(self):
        pid, replaced = self.alice.save("  Family TFSA ", TABLE)
        self.assertFalse(replaced)
        (row,) = self.alice.list()
        self.assertEqual(row[:2], (pid, "Family TFSA"))
        loaded = self.alice.load(pid)
        self.assertEqual(list(loaded.columns), ["Ticker", "Shares", "Avg Buy Price", "Currency", "Account"])
        records = loaded.to_dict("records")
        self.assertEqual(records[0], {"Ticker": "XEQT.TO", "Shares": 10.0, "Avg Buy Price": 30.0, "Currency": "", "Account": "TFSA"})
        self.assertEqual({k: v for k, v in records[1].items() if k != "Avg Buy Price"},
                         {"Ticker": "AAPL", "Shares": 2.5, "Currency": "USD", "Account": ""})
        self.assertTrue(pd.isna(records[1]["Avg Buy Price"]))
        self.assertEqual(len(records), 2)

    def test_saving_the_same_name_replaces(self):
        pid, _ = self.alice.save("Main", TABLE)
        pid2, replaced = self.alice.save("Main", TABLE.head(1))
        self.assertEqual(pid, pid2)
        self.assertTrue(replaced)
        self.assertEqual(len(self.alice.load(pid)), 1)
        self.assertEqual(self.alice.count(), 1)

    def test_users_never_see_each_others_portfolios(self):
        pid, _ = self.alice.save("Main", TABLE)
        self.bob.save("Main", TABLE.head(1))  # same name, different user: allowed
        self.assertEqual([name for _, name, _ in self.bob.list()], ["Main"])
        self.assertNotIn(pid, [p for p, _, _ in self.bob.list()])
        self.assertIsNone(self.bob.load(pid))
        self.assertFalse(self.bob.rename(pid, "Stolen"))
        self.assertFalse(self.bob.delete(pid))
        self.assertEqual(len(self.alice.load(pid)), 2)
        self.assertEqual([name for _, name, _ in self.alice.list()], ["Main"])

    def test_rename_and_delete(self):
        a, _ = self.alice.save("A", TABLE)
        self.alice.save("B", TABLE)
        with self.assertRaisesRegex(db.PortfolioNameError, "already have"):
            self.alice.rename(a, "B")
        self.assertTrue(self.alice.rename(a, "C"))
        self.assertEqual(sorted(name for _, name, _ in self.alice.list()), ["B", "C"])
        self.assertTrue(self.alice.delete(a))
        self.assertIsNone(self.alice.load(a))
        self.assertEqual([name for _, name, _ in self.alice.list()], ["B"])

    def test_names_are_validated(self):
        with self.assertRaises(db.PortfolioNameError):
            self.alice.save("   ", TABLE)
        with self.assertRaises(db.PortfolioNameError):
            self.alice.save("x" * 101, TABLE)

    def test_store_needs_a_user(self):
        with self.assertRaises(ValueError):
            db.Store(temp_engine(), "")


class DatabaseUrlTest(unittest.TestCase):
    def test_neon_urls_become_pg8000_arguments_with_ssl(self):
        args = db.postgres_connect_args("postgresql://neondb_owner:p%40ss@ep-x-pooler.neon.tech/neondb?sslmode=require&channel_binding=require")
        self.assertEqual(
            {k: args[k] for k in ("user", "password", "host", "port", "database")},
            {"user": "neondb_owner", "password": "p@ss", "host": "ep-x-pooler.neon.tech", "port": 5432, "database": "neondb"},
        )
        self.assertIn("ssl_context", args)
        self.assertNotIn("ssl_context", db.postgres_connect_args("postgres://u@localhost:5433/x?sslmode=disable"))
        with self.assertRaises(ValueError):
            db.Database("mysql://u@h/db")

    def test_postgres_schema_uses_identity_columns(self):
        ddl = " ".join(db.postgres_ddl(s) for s in db.SCHEMA)
        self.assertNotIn("AUTOINCREMENT", ddl)
        self.assertIn("BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY", ddl)
        self.assertIn("portfolio_id BIGINT", ddl)

    def test_no_database_on_vercel_without_a_url(self):
        env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "POSTGRES_URL")}
        with mock.patch.dict(os.environ, {**env, "VERCEL": "1"}, clear=True):
            self.assertIsNone(db.database_url())


CLERK_ENV = {
    "CLERK_OAUTH_CLIENT_ID": "client-123",
    "CLERK_OAUTH_CLIENT_SECRET": "secret-456",
    "CLERK_ISSUER_URL": "https://clerk.axiomft.ca/",
    "APP_URL": "https://portfolio.axiomft.ca/",
}


def without_auth_env():
    keys = set(CLERK_ENV) | {"VERCEL", "VERCEL_PROJECT_PRODUCTION_URL", "AUTH_COOKIE_SECRET", "CLERK_OAUTH_PROMPT"}
    return {k: v for k, v in os.environ.items() if k not in keys}


class AuthConfigTest(unittest.TestCase):
    def test_not_configured(self):
        with mock.patch.dict(os.environ, without_auth_env(), clear=True):
            self.assertIsNone(auth_config.streamlit_secrets())

    def test_clerk_settings(self):
        with mock.patch.dict(os.environ, {**without_auth_env(), **CLERK_ENV}, clear=True):
            auth = auth_config.streamlit_secrets()["auth"]
        self.assertEqual(auth["redirect_uri"], "https://portfolio.axiomft.ca/oauth2callback")
        self.assertEqual(auth["server_metadata_url"], "https://clerk.axiomft.ca/.well-known/openid-configuration")
        self.assertEqual(auth["client_id"], "client-123")
        self.assertEqual(auth["client_kwargs"], {"scope": "openid email profile", "prompt": "login"})
        self.assertGreaterEqual(len(auth["cookie_secret"]), 32)
        with mock.patch.dict(os.environ, {**without_auth_env(), **CLERK_ENV}, clear=True):
            self.assertEqual(auth_config.streamlit_secrets()["auth"]["cookie_secret"], auth["cookie_secret"])  # stable

    def test_vercel_production_url_is_the_default(self):
        env = {**without_auth_env(), **CLERK_ENV, "VERCEL_PROJECT_PRODUCTION_URL": "portfolioanalyst.vercel.app"}
        del env["APP_URL"]
        with mock.patch.dict(os.environ, env, clear=True):
            auth = auth_config.streamlit_secrets()["auth"]
        self.assertEqual(auth["redirect_uri"], "https://portfolioanalyst.vercel.app/oauth2callback")


def run_app(env, secrets=None, user=None):
    from streamlit.testing.v1 import AppTest

    with mock.patch.dict(os.environ, env, clear=True), \
            mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=lambda tickers: dict.fromkeys(tickers)):
        patches = [mock.patch.object(access, "current_user", return_value=user)] if user else []
        for p in patches:
            p.start()
        try:
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60)
            for key, value in (secrets or {}).items():
                app.secrets[key] = value
            app.run()
        finally:
            for p in patches:
                p.stop()
    return app


class GateTest(unittest.TestCase):
    def test_vercel_without_sign_in_settings_fails_closed(self):
        app = run_app({**without_auth_env(), "VERCEL": "1"})
        self.assertFalse(app.exception)
        self.assertTrue(any("Sign-in isn't configured" in e.value for e in app.error))
        self.assertEqual([b.label for b in app.button], [])
        self.assertFalse(app.text_area)

    def test_signed_out_visitors_see_the_sign_in_page(self):
        with mock.patch.dict(os.environ, {**without_auth_env(), **CLERK_ENV}, clear=True):
            secrets = auth_config.streamlit_secrets()
        app = run_app(without_auth_env(), secrets=secrets)
        self.assertFalse(app.exception)
        self.assertEqual([b.label for b in app.button], ["Sign in with Axiom"])
        self.assertFalse(app.text_area)

    def test_local_development_runs_as_the_local_user(self):
        app = run_app(without_auth_env())
        self.assertFalse(app.exception)
        self.assertTrue(any(b.label == "Analyze portfolio" for b in app.button))
        self.assertTrue(any("Running locally without sign-in" in c.value for c in app.caption))


class SavedPortfoliosUITest(unittest.TestCase):
    def test_save_then_load_for_a_signed_in_user(self):
        from streamlit.testing.v1 import AppTest

        user = access.User(id="user_ui_1", email="roger@example.com", name="Roger")
        env = without_auth_env()
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=lambda tickers: dict.fromkeys(tickers)), \
                mock.patch.object(access, "current_user", return_value=user):
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
            self.assertTrue(any("Signed in as **Roger**" in c.value for c in app.caption))
            app.text_input(key="save_name").set_value("Sample").run()
            app.button(key="save_portfolio").click().run()
            self.assertFalse(app.exception)
            self.assertTrue(any('Saved "Sample"' in s.value for s in app.success))
            self.assertEqual(app.selectbox(key="saved_portfolio").options, ["Sample"])

            # Change the holdings, then load the saved copy back.
            app.session_state.holdings = app.session_state.holdings.head(1)
            version = app.session_state.editor_version
            app.button(key="load_portfolio").click().run()
            self.assertFalse(app.exception)
            self.assertEqual(len(app.session_state.holdings), 3)
            self.assertEqual(app.session_state.editor_version, version + 1)

        other = access.User(id="user_ui_2", email=None, name="Someone else")
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=lambda tickers: dict.fromkeys(tickers)), \
                mock.patch.object(access, "current_user", return_value=other):
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
        self.assertTrue(any("No saved portfolios yet" in c.value for c in app.caption))


if __name__ == "__main__":
    unittest.main()
