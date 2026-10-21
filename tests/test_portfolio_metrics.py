"""Tests for portfolio_metrics and the dashboard, with Yahoo Finance mocked.

Run: python -m unittest discover -s tests
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd
from agno.run.response import RunResponseContentEvent

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling test helpers

import portfolio_analytics  # noqa: E402
import portfolio_metrics  # noqa: E402
from portfolio_metrics import Quote  # noqa: E402

QUOTES = {
    "AAPL": Quote(price=200.0, previous_close=190.0, currency="USD", name="Apple Inc.", sector="Technology", country="United States", quote_type="EQUITY"),
    "SHOP.TO": Quote(price=100.0, previous_close=None, currency="CAD", name="Shopify", sector="Technology", country="Canada", quote_type="EQUITY"),
    "XEQT.TO": Quote(price=40.0, previous_close=39.0, currency="CAD", name="iShares Core Equity", quote_type="ETF"),
    "VOD.L": Quote(price=120.0, previous_close=118.0, currency="GBp", name="Vodafone", sector="Communication Services", country="United Kingdom", quote_type="EQUITY"),
    "BOGUS": None,
}
FX = {"CAD": 1.0, "USD": 1.4, "GBP": 1.8}


def holding(ticker, shares, avg_price=None, currency=None):
    return {"ticker": ticker, "shares": shares, "avg_price": avg_price, "currency": currency}


class ComputeTest(unittest.TestCase):
    def setUp(self):
        self.holdings = [
            holding("AAPL", 10, 150, "USD"),
            holding("SHOP.TO", 5, 80),  # blank cost currency -> CAD, its listing currency
            holding("XEQT.TO", 25),  # no cost
            holding("VOD.L", 100, 1.0, "GBP"),
            holding("BOGUS", 3, 10, "USD"),
        ]
        self.figures = portfolio_metrics.compute(self.holdings, QUOTES, FX, "CAD")
        self.rows = {r["Ticker"]: r for r in self.figures.positions.to_dict("records")}

    def test_values_in_base_currency(self):
        self.assertAlmostEqual(self.rows["AAPL"]["Value"], 200 * 10 * 1.4)
        self.assertAlmostEqual(self.rows["AAPL"]["Cost"], 150 * 10 * 1.4)
        self.assertAlmostEqual(self.rows["SHOP.TO"]["Value"], 500)
        self.assertAlmostEqual(self.rows["SHOP.TO"]["Cost"], 400)
        # London quotes in pence: 120p -> 1.20 GBP.
        self.assertAlmostEqual(self.rows["VOD.L"]["Price"], 1.2)
        self.assertEqual(self.rows["VOD.L"]["Currency"], "GBP")
        self.assertAlmostEqual(self.rows["VOD.L"]["Value"], 1.2 * 100 * 1.8)
        self.assertAlmostEqual(self.rows["VOD.L"]["P/L %"], 20.0)

    def test_totals_and_weights(self):
        f = self.figures
        expected_value = 2800 + 500 + 1000 + 216
        self.assertAlmostEqual(f.total_value, expected_value)
        self.assertAlmostEqual(f.total_cost, 2100 + 400 + 180)
        # P/L only counts positions with a cost; XEQT has none.
        self.assertAlmostEqual(f.total_pl, (2800 + 500 + 216) - (2100 + 400 + 180))
        self.assertAlmostEqual(f.positions["Weight %"].sum(), 100)
        self.assertEqual(f.positions.iloc[0]["Ticker"], "AAPL")  # largest first
        self.assertEqual(f.unpriced, ["BOGUS"])
        # SHOP.TO has no previous close, so it adds nothing to today's change.
        self.assertAlmostEqual(f.day_change, 10 * 10 * 1.4 + 25 * 1 + 100 * 0.02 * 1.8)

    def test_funds_and_unknowns_are_labelled(self):
        self.assertEqual(self.rows["XEQT.TO"]["Sector"], "ETF")
        self.assertEqual(self.rows["XEQT.TO"]["Country"], "Fund (mixed)")
        self.assertTrue(self.rows["XEQT.TO"]["P/L"] != self.rows["XEQT.TO"]["P/L"])  # NaN

    def test_missing_fx_rate_leaves_position_out(self):
        figures = portfolio_metrics.compute([holding("AAPL", 1, 100, "USD")], QUOTES, {"CAD": 1.0}, "CAD")
        self.assertEqual(figures.unpriced, ["AAPL"])
        self.assertTrue(figures.positions.empty)

    def test_duplicate_tickers_merge_within_an_account(self):
        figures = portfolio_metrics.compute(
            [holding("AAPL", 10, 100, "USD"), holding("AAPL", 10, 200, "USD")], QUOTES, FX, "USD"
        )
        (row,) = figures.positions.to_dict("records")
        self.assertEqual(row["Shares"], 20)
        self.assertAlmostEqual(row["Cost"], (1000 + 2000) * 1.4)
        self.assertAlmostEqual(row["P/L %"], (4000 - 3000) / 3000 * 100)

    def test_accounts_stay_apart_and_combine_by_ticker(self):
        holdings = [
            {**holding("AAPL", 10, 100, "USD"), "account": "TFSA"},
            {**holding("AAPL", 5, 200, "USD"), "account": "RRSP"},
            {**holding("XEQT.TO", 25), "account": "TFSA"},
        ]
        figures = portfolio_metrics.compute(holdings, QUOTES, FX, "CAD")
        self.assertEqual(len(figures.positions), 3)
        accounts = figures.allocation("Account").set_index("Group")
        self.assertAlmostEqual(accounts.loc["TFSA", "Value"], 2800 + 1000)
        self.assertAlmostEqual(accounts.loc["RRSP", "Value"], 1400)
        aapl = figures.by_ticker().set_index("Ticker").loc["AAPL"]
        self.assertEqual(aapl["Shares"], 15)
        self.assertEqual(aapl["Account"], "TFSA, RRSP")
        self.assertAlmostEqual(aapl["Cost"], (1000 + 1000) * 1.4)
        self.assertAlmostEqual(aapl["Weight %"], 4200 / 5200 * 100)
        # XEQT has no cost, so its P/L stays unknown when combined.
        self.assertTrue(pd.isna(figures.by_ticker().set_index("Ticker").loc["XEQT.TO", "P/L"]))

    def test_allocation(self):
        by_sector = self.figures.allocation("Sector")
        self.assertEqual(by_sector.iloc[0]["Group"], "Technology")
        self.assertAlmostEqual(by_sector["Weight %"].sum(), 100)
        by_currency = self.figures.allocation("Currency").set_index("Group")
        self.assertAlmostEqual(by_currency.loc["USD", "Value"], 2800)

    def test_markdown_for_the_analyst(self):
        text = portfolio_metrics.to_markdown(self.figures)
        self.assertIn("Total market value: 4,516.00 CAD", text)
        self.assertIn("1 USD = 1.4000 CAD", text)
        self.assertIn("No live price found for: BOGUS", text)
        self.assertIn("| AAPL | Unspecified | Apple Inc. | 10 | 200.00 | USD | 2,800.00 | 2,100.00 | 700.00 | +33.33% |", text)
        self.assertIn("Allocation by sector: Technology", text)

    def test_needed_currencies(self):
        self.assertEqual(portfolio_metrics.needed_currencies(self.holdings, QUOTES), {"USD", "CAD", "GBP"})


def fake_fetch_quotes(tickers):
    return {t: QUOTES.get(t) for t in tickers}


def fake_history(symbols):
    from test_portfolio_analytics import BENCH, flat, make_history, ramp

    return make_history(
        {"AAPL": ramp(180, 200), "USDCAD=X": flat(1.4), "CADUSD=X": flat(1 / 1.4), **BENCH},
        {"AAPL": {"2025-12-01": 1.0}},
    )


def fake_fetch_fx(currencies, base):
    return {c: FX[c] / FX[base] for c in currencies}


class DashboardUITest(unittest.TestCase):
    def setUp(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("SNAPTRADE_", "AI_GATEWAY_"))}
        patches = [
            mock.patch.dict(os.environ, {**env, "AI_GATEWAY_API_KEY": "test"}, clear=True),
            mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=fake_fetch_quotes),
            mock.patch.object(portfolio_metrics, "fetch_fx", side_effect=fake_fetch_fx),
            mock.patch.object(portfolio_analytics, "fetch_history", side_effect=fake_history),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        import streamlit as st

        st.cache_data.clear()

    def test_dashboard_and_analyst_get_computed_figures(self):
        from streamlit.testing.v1 import AppTest

        prompts = []
        agent = mock.MagicMock()
        agent.return_value.run.side_effect = lambda prompt, **kwargs: prompts.append(prompt) or iter(
            [RunResponseContentEvent(content="Report")]
        )
        with mock.patch("agno.agent.Agent", agent):
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
            self.assertFalse(app.exception)
            tiles = {m.label: m.value for m in app.metric}
            # Default holdings: AAPL 10 @ 150 USD, MSFT 5 @ 310, NVDA 4 @ 420.
            # Only AAPL has a fake quote; MSFT and NVDA are reported as unpriced.
            self.assertEqual(tiles["Market value (CAD)"], "2,800")
            self.assertEqual(tiles["Unrealized P/L (CAD)"], "+700")
            self.assertTrue(any("MSFT, NVDA" in w.value for w in app.warning))
            self.assertIn("Expected annual income (CAD)", tiles)
            self.assertEqual(tiles["Expected annual income (CAD)"], "14")
            self.assertIn("Return (1Y)", tiles)

            next(b for b in app.button if b.label == "Analyze portfolio").click().run()

        self.assertFalse(app.exception)
        (prompt,) = prompts
        self.assertIn("Figures computed from live Yahoo Finance quotes, in CAD", prompt)
        self.assertIn("Total market value: 2,800.00 CAD", prompt)
        self.assertIn("Backtest of today's holdings", prompt)
        self.assertIn("(1Y)", prompt)
        self.assertIn("expected annual income 14.00 CAD", prompt)

    def test_report_currency_switch(self):
        from streamlit.testing.v1 import AppTest

        app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
        next(s for s in app.selectbox if s.label == "Report currency").select("USD").run()
        tiles = {m.label: m.value for m in app.metric}
        self.assertEqual(tiles["Market value (USD)"], "2,000")


if __name__ == "__main__":
    unittest.main()
