"""Tests for account types: CSV parsing, normalization and placement hints.

Run: python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling test helpers

import account_hints  # noqa: E402
import portfolio_analytics as pa  # noqa: E402
import portfolio_metrics  # noqa: E402
from portfolio_import import normalize_account, read_holdings  # noqa: E402
from portfolio_metrics import Quote  # noqa: E402
from test_portfolio_analytics import BENCH, DAYS, flat, make_history  # noqa: E402

WEALTHSIMPLE_CSV = b"""Account Name,Account Type,Account Classification,Account Number,Symbol,Exchange,MIC,Name,Security Type,Quantity,Position Direction,Market Price,Market Price Currency,Book Value (CAD),Book Value Currency (CAD)
TFSA,TFSA,Self Directed,HQ1,XEQT,TSX,XTSE,iShares Core Equity,EXCHANGE_TRADED_FUND,10,LONG,45.5,CAD,300,CAD
RRSP,RRSP,Self Directed,HQ2,XEQT,TSX,XTSE,iShares Core Equity,EXCHANGE_TRADED_FUND,5,LONG,45.5,CAD,200,CAD
TFSA,TFSA,Self Directed,HQ1,XEQT,TSX,XTSE,iShares Core Equity,EXCHANGE_TRADED_FUND,2,LONG,45.5,CAD,90,CAD
Non-registered,Personal,Self Directed,HQ3,AAPL,NASDAQ,XNAS,Apple,EQUITY,2,LONG,340,USD,500,CAD
"""


class NormalizeTest(unittest.TestCase):
    def test_labels(self):
        cases = {
            "TFSA": "TFSA", "Tax-Free Savings Account": "TFSA", "ca_tfsa": "TFSA",
            "Spousal RRSP": "RRSP", "RRSP": "RRSP", "RRIF": "RRIF", "FHSA": "FHSA", "RESP": "RESP",
            "Locked-in retirement account": "LIRA", "Personal": "Non-registered", "Individual margin": "Non-registered",
            "Crypto": "Other", "": "", None: "", float("nan"): "",
        }
        for label, expected in cases.items():
            with self.subTest(label=label):
                self.assertEqual(normalize_account(label), expected)


class CsvAccountsTest(unittest.TestCase):
    def test_wealthsimple_holdings_report_keeps_accounts_apart(self):
        holdings, warnings = read_holdings("holdings.csv", WEALTHSIMPLE_CSV)
        rows = {(r["Ticker"], r["Account"]): r for r in holdings.to_dict("records")}
        self.assertEqual(set(rows), {("XEQT.TO", "TFSA"), ("XEQT.TO", "RRSP"), ("AAPL", "Non-registered")})
        # Two TFSA lots combine: 12 shares, book value 390.
        self.assertEqual(rows[("XEQT.TO", "TFSA")]["Shares"], 12)
        self.assertAlmostEqual(rows[("XEQT.TO", "TFSA")]["Avg Buy Price"], 390 / 12, places=4)
        self.assertEqual(rows[("XEQT.TO", "RRSP")]["Shares"], 5)
        self.assertEqual(warnings, [])

    def test_name_column_used_when_there_is_no_type(self):
        csv = b"Account,Symbol,Quantity\nMy TFSA,VFV.TO,3\nJoint cash,VFV.TO,1\n"
        holdings, _ = read_holdings("h.csv", csv)
        self.assertEqual(sorted(holdings["Account"]), ["Non-registered", "TFSA"])

    def test_files_without_accounts_still_import(self):
        holdings, _ = read_holdings("h.csv", b"Ticker,Shares\nAAPL,1\nAAPL,2\n")
        self.assertEqual(holdings.to_dict("records"), [
            {"Ticker": "AAPL", "Shares": 3.0, "Avg Buy Price": None, "Currency": "", "Account": ""},
        ])


QUOTES = {
    "AAPL": Quote(200, 199, "USD", name="Apple", sector="Technology", country="United States", quote_type="EQUITY"),
    "SPY": Quote(500, 499, "USD", name="SPDR S&P 500", quote_type="ETF"),
    "TSM": Quote(100, 99, "USD", name="Taiwan Semi", sector="Technology", country="Taiwan", quote_type="EQUITY"),
    "BNS.TO": Quote(60, 60, "CAD", name="Scotiabank", sector="Financial Services", country="Canada", quote_type="EQUITY"),
    "SHOP.TO": Quote(100, 100, "CAD", name="Shopify", sector="Technology", country="Canada", quote_type="EQUITY"),
}


def holding(ticker, shares, account):
    return {"ticker": ticker, "shares": shares, "avg_price": None, "currency": None, "account": account}


class HintsTest(unittest.TestCase):
    def setUp(self):
        last = DAYS[-1]
        history = make_history(
            {"AAPL": flat(200), "SPY": flat(500), "TSM": flat(100), "BNS.TO": flat(60), "SHOP.TO": flat(100),
             "USDCAD=X": flat(1.4), **BENCH},
            {"AAPL": {last: 2.0}, "SPY": {last: 10.0}, "TSM": {last: 3.0}, "BNS.TO": {last: 3.0}},
        )
        holdings = [
            holding("AAPL", 10, "TFSA"),  # US-listed payer in a TFSA: hint
            holding("SPY", 2, "FHSA"),  # US-listed ETF in an FHSA: hint
            holding("TSM", 5, "TFSA"),  # Taiwanese ADR: not US withholding, no hint
            holding("AAPL", 5, "RRSP"),  # treaty-exempt account: no hint
            holding("BNS.TO", 100, "RRSP"),  # 5% Canadian yield in an RRSP: hint
            holding("SHOP.TO", 10, "RRSP"),  # no dividend: no hint
            holding("BNS.TO", 10, "Non-registered"),  # gets the credit: no hint
        ]
        self.figures = portfolio_metrics.compute(holdings, QUOTES, {"CAD": 1.0, "USD": 1.4}, "CAD")
        self.dividends = pa.compute_dividends(self.figures, history)
        self.hints = account_hints.placement_hints(self.figures, self.dividends)

    def test_hints(self):
        by_account = {(h.account, h.title.split()[0]): h for h in self.hints}
        self.assertEqual(set(by_account), {("TFSA", "US"), ("FHSA", "US"), ("RRSP", "Canadian")})
        tfsa = by_account[("TFSA", "US")]
        self.assertEqual(tfsa.tickers, ["AAPL"])
        self.assertAlmostEqual(tfsa.amount, 2.0 * 10 * 1.4 * 0.15)
        self.assertIn("AAPL pays US dividends", tfsa.detail)
        self.assertIn("a TFSA generally can't recover it", tfsa.detail)
        self.assertIn("an FHSA generally can't recover it", by_account[("FHSA", "US")].detail)
        rrsp = by_account[("RRSP", "Canadian")]
        self.assertEqual(rrsp.tickers, ["BNS.TO"])
        self.assertIn("BNS.TO 5.0%", rrsp.detail)
        self.assertIn("in an RRSP", rrsp.detail)

    def test_accounts_without_payers_give_no_hints(self):
        # Regression: an RRSP with only non-payers once crashed placement_hints.
        figures = portfolio_metrics.compute([holding("SHOP.TO", 10, "RRSP"), holding("AAPL", 1, "TFSA")], QUOTES, {"CAD": 1.0, "USD": 1.4}, "CAD")
        history = make_history({"SHOP.TO": flat(100), "AAPL": flat(200), "USDCAD=X": flat(1.4), **BENCH})
        self.assertEqual(account_hints.placement_hints(figures, pa.compute_dividends(figures, history)), [])

    def test_no_hints_without_dividends_or_accounts(self):
        self.assertEqual(account_hints.placement_hints(self.figures, None), [])
        figures = portfolio_metrics.compute([holding("SHOP.TO", 1, None)], QUOTES, {"CAD": 1.0}, "CAD")
        self.assertEqual(figures.positions["Account"].tolist(), ["Unspecified"])

    def test_summary_and_markdown(self):
        summary = account_hints.account_summary(self.figures, self.dividends).set_index("Account")
        self.assertEqual(summary.loc["RRSP", "Holdings"], 3)
        self.assertAlmostEqual(summary.loc["RRSP", "Annual income"], 2.0 * 5 * 1.4 + 3.0 * 100)
        self.assertAlmostEqual(summary["Weight %"].sum(), 100)
        text = account_hints.to_markdown(self.figures, self.dividends, self.hints)
        self.assertIn("- RRSP: 3 holding(s)", text)
        self.assertIn("not tax advice", text)
        self.assertIn("US dividends in your TFSA lose 15%", text)


if __name__ == "__main__":
    unittest.main()
