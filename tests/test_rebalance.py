"""Tests for the rebalancing calculator.

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
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _isolation  # noqa: E402,F401  (temp database for the app)
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling test helpers

import portfolio_analytics  # noqa: E402
import portfolio_metrics  # noqa: E402
import rebalance as rb  # noqa: E402
from portfolio_metrics import Quote  # noqa: E402

# 7,000 CAD: AAPL 2,800 (40%), SHOP 2,000 (28.6%), XIC 2,000 (28.6%), BNS 200 (2.9%).
POSITIONS = pd.DataFrame([
    {"Ticker": "AAPL", "Account": "TFSA", "Shares": 10, "Price": 200.0, "Currency": "USD", "Value": 2800.0, "P/L": 700.0, "Sector": "Technology"},
    {"Ticker": "SHOP.TO", "Account": "Non-registered", "Shares": 20, "Price": 100.0, "Currency": "CAD", "Value": 2000.0, "P/L": 1000.0, "Sector": "Technology"},
    {"Ticker": "XIC.TO", "Account": "RRSP", "Shares": 50, "Price": 40.0, "Currency": "CAD", "Value": 2000.0, "P/L": 0.0, "Sector": "ETF"},
    {"Ticker": "BNS.TO", "Account": "Non-registered", "Shares": 4, "Price": 50.0, "Currency": "CAD", "Value": 200.0, "P/L": -40.0, "Sector": "Financial Services"},
])


def holding_rows():
    return rb.universe(POSITIONS, "Ticker")


def trades(plan):
    return {t["Ticker"]: t for t in plan.trades.to_dict("records")}


class FullRebalanceTest(unittest.TestCase):
    def test_lands_on_targets_with_fractional_shares(self):
        targets = {"AAPL": 30, "SHOP.TO": 20, "XIC.TO": 40, "BNS.TO": 10}
        plan = rb.plan(holding_rows(), targets, 1000, False, True, "CAD", "Holding")
        after = plan.groups.set_index("Group")["After %"]
        for ticker, target in targets.items():
            self.assertAlmostEqual(after[ticker], target, places=1)
        t = trades(plan)
        self.assertEqual(t["AAPL"]["Action"], "Sell")
        self.assertAlmostEqual(t["AAPL"]["Shares"], (2800 - 2400) / (200 * 1.4), places=3)
        self.assertEqual(t["XIC.TO"]["Action"], "Buy")
        self.assertAlmostEqual(plan.cash_left, 0, delta=0.05)
        self.assertAlmostEqual(plan.total_buys - plan.total_sells, 1000, delta=0.05)

    def test_whole_shares_never_overspend(self):
        plan = rb.plan(holding_rows(), {"AAPL": 30, "SHOP.TO": 20, "XIC.TO": 40, "BNS.TO": 10}, 1000, False, False, "CAD", "Holding")
        for t in plan.trades.to_dict("records"):
            self.assertEqual(t["Shares"], int(t["Shares"]))
        self.assertGreaterEqual(plan.cash_left, 0)
        self.assertAlmostEqual(plan.cash_left, 1000 - plan.total_buys + plan.total_sells, places=6)

    def test_zero_target_sells_everything(self):
        plan = rb.plan(holding_rows(), {"AAPL": 0, "SHOP.TO": 40, "XIC.TO": 50, "BNS.TO": 10}, 0, False, False, "CAD", "Holding")
        self.assertEqual(trades(plan)["AAPL"]["Shares"], 10)
        self.assertEqual(plan.groups.set_index("Group").loc["AAPL", "After %"], 0)

    def test_targets_are_scaled_to_100(self):
        plan = rb.plan(holding_rows(), {"AAPL": 15, "SHOP.TO": 10, "XIC.TO": 20, "BNS.TO": 5}, 0, False, True, "CAD", "Holding")
        self.assertAlmostEqual(plan.targets_scaled_from, 50)
        self.assertAlmostEqual(plan.groups.set_index("Group").loc["XIC.TO", "After %"], 40, places=1)

    def test_current_weights_mean_no_trades(self):
        values = POSITIONS.set_index("Ticker")["Value"]
        current = (values / values.sum() * 100).to_dict()
        plan = rb.plan(holding_rows(), current, 0, False, True, "CAD", "Holding")
        self.assertFalse(plan.has_trades)

    def test_untargeted_groups_hold_still(self):
        plan = rb.plan(holding_rows(), {"AAPL": 30, "SHOP.TO": 38.57}, 0, False, True, "CAD", "Holding")
        self.assertNotIn("XIC.TO", trades(plan))
        self.assertNotIn("BNS.TO", trades(plan))
        self.assertIsNone(plan.targets_scaled_from)

    def test_dust_is_dropped(self):
        plan = rb.plan(holding_rows(), {"AAPL": 40.005, "SHOP.TO": 28.57, "XIC.TO": 28.57, "BNS.TO": 2.855}, 0, False, True, "CAD", "Holding")
        self.assertTrue(all(abs(t["Amount"]) >= rb.MIN_TRADE for t in plan.trades.to_dict("records")))


class BuyOnlyTest(unittest.TestCase):
    def test_never_sells_and_fills_the_most_underweight_first(self):
        targets = {"AAPL": 25, "SHOP.TO": 25, "XIC.TO": 25, "BNS.TO": 25}
        plan = rb.plan(holding_rows(), targets, 1000, True, True, "CAD", "Holding")
        self.assertEqual(plan.total_sells, 0)
        self.assertEqual(set(trades(plan)), {"BNS.TO"})  # 200 vs a 2,000 target: all 1,000 goes there
        self.assertAlmostEqual(plan.total_buys, 1000, delta=0.01)

    def test_spreads_cash_once_gaps_close(self):
        targets = {"AAPL": 25, "SHOP.TO": 25, "XIC.TO": 25, "BNS.TO": 25}
        plan = rb.plan(holding_rows(), targets, 3000, True, True, "CAD", "Holding")
        t = trades(plan)
        # At 10,000 each target is 2,500, so AAPL (2,800) stays overweight and gets nothing.
        self.assertNotIn("AAPL", t)
        # BNS's gap (2,300) is filled most; SHOP and XIC, equally underweight, rise together.
        self.assertGreater(t["BNS.TO"]["Amount"], t["XIC.TO"]["Amount"])
        self.assertAlmostEqual(t["SHOP.TO"]["Amount"], t["XIC.TO"]["Amount"], delta=0.5)
        self.assertAlmostEqual(plan.total_buys, 3000, delta=0.01)


class GroupsTest(unittest.TestCase):
    def test_sector_trades_split_by_current_value(self):
        rows = rb.universe(POSITIONS, "Sector")
        plan = rb.plan(rows, {"Technology": 50, "ETF": 40, "Financial Services": 10}, 0, False, True, "CAD", "Sector")
        t = trades(plan)
        tech_sold = t["AAPL"]["Amount"] + t["SHOP.TO"]["Amount"]
        self.assertAlmostEqual(tech_sold, 3500 - 4800, delta=0.05)
        self.assertAlmostEqual(t["AAPL"]["Amount"] / tech_sold, 2800 / 4800, places=3)
        self.assertAlmostEqual(plan.groups.set_index("Group").loc["ETF", "After %"], 40, places=1)

    def test_capital_gain_only_from_non_registered_sales(self):
        plan = rb.plan(holding_rows(), {"AAPL": 20, "SHOP.TO": 10, "XIC.TO": 60, "BNS.TO": 10}, 0, False, True, "CAD", "Holding")
        t = trades(plan)
        shop_sold = -t["SHOP.TO"]["Amount"]
        # SHOP's gain is half its value (1,000 of 2,000); the AAPL sale is in a TFSA.
        self.assertAlmostEqual(plan.realized_gain, shop_sold * 0.5, delta=0.05)

    def test_new_holding_can_get_a_target(self):
        rows = rb.add_holding(holding_rows(), "VFV.TO", 150.0, "CAD", 1.0)
        plan = rb.plan(rows, {"AAPL": 40, "SHOP.TO": 28.57, "XIC.TO": 20, "BNS.TO": 2.86, "VFV.TO": 8.57}, 0, False, False, "CAD", "Holding")
        self.assertEqual(trades(plan)["VFV.TO"]["Action"], "Buy")
        self.assertEqual(trades(plan)["VFV.TO"]["Shares"], 3)  # ~600 / 150 = 4 at most; whole shares, after XIC sale rounding

    def test_markdown(self):
        plan = rb.plan(holding_rows(), {"AAPL": 30, "SHOP.TO": 20, "XIC.TO": 40, "BNS.TO": 10}, 500, False, True, "CAD", "Holding")
        text = rb.to_markdown(plan)
        self.assertIn("Proposed rebalance (holding targets, all accounts, in CAD", text)
        self.assertIn("Sell", text)
        self.assertIn("XIC.TO in RRSP", text)
        self.assertIn("New cash 500.00", text)


def fake_quotes(tickers):
    quotes = {
        "AAPL": Quote(200, 199, "USD", name="Apple", sector="Technology", country="United States", quote_type="EQUITY"),
        "MSFT": Quote(400, 399, "USD", name="Microsoft", sector="Technology", country="United States", quote_type="EQUITY"),
        "NVDA": Quote(100, 99, "USD", name="NVIDIA", sector="Technology", country="United States", quote_type="EQUITY"),
    }
    return {t: quotes.get(t) for t in tickers}


class RebalanceUITest(unittest.TestCase):
    def setUp(self):
        from test_portfolio_metrics import fake_fetch_fx, fake_history

        env = {k: v for k, v in os.environ.items() if not k.startswith(("SNAPTRADE_", "AI_GATEWAY_"))}
        patches = [
            mock.patch.dict(os.environ, {**env, "AI_GATEWAY_API_KEY": "test"}, clear=True),
            mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=fake_quotes),
            mock.patch.object(portfolio_metrics, "fetch_fx", side_effect=fake_fetch_fx),
            mock.patch.object(portfolio_analytics, "fetch_history", side_effect=fake_history),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        import streamlit as st

        st.cache_data.clear()

    def test_new_cash_and_buy_only_flow_into_the_prompt(self):
        from streamlit.testing.v1 import AppTest

        prompts = []
        agent = mock.MagicMock()
        agent.return_value.run.side_effect = lambda prompt, **kwargs: prompts.append(prompt) or iter(
            [RunResponseContentEvent(content="Report")]
        )
        with mock.patch("agno.agent.Agent", agent):
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
            self.assertTrue(any("Already on target" in i.value for i in app.info))
            next(n for n in app.number_input if n.label.startswith("New cash")).set_value(1000).run()
            next(t for t in app.toggle if t.label.startswith("Buy only")).set_value(True).run()
            self.assertFalse(app.exception)
            tiles = {m.label: m.value for m in app.metric}
            self.assertEqual(tiles["Buys (CAD)"], "1,000")
            self.assertEqual(tiles["Sells (CAD)"], "0")
            next(b for b in app.button if b.label == "Analyze portfolio").click().run()

        self.assertFalse(app.exception)
        (prompt,) = prompts
        self.assertIn("Proposed rebalance (holding targets, all accounts, in CAD", prompt)
        self.assertIn("New cash 1,000.00", prompt)

    def test_account_scope_lists_accounts(self):
        from streamlit.testing.v1 import AppTest

        app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
        scope = next(s for s in app.selectbox if s.label == "Account")
        self.assertEqual(scope.options, ["All accounts", "TFSA", "RRSP", "Non-registered"])
        scope.select("RRSP").run()
        self.assertFalse(app.exception)


if __name__ == "__main__":
    unittest.main()
