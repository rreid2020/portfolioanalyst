"""Tests for portfolio_analytics with synthetic price, FX and dividend history.

Run: python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import portfolio_analytics as pa  # noqa: E402
import portfolio_metrics  # noqa: E402
from portfolio_metrics import Quote  # noqa: E402

DAYS = pd.bdate_range("2025-01-01", periods=300)


def make_history(close: dict, dividends: dict | None = None) -> pd.DataFrame:
    """A yf.download-shaped frame: columns (field, symbol)."""
    close_df = pd.DataFrame(close, index=DAYS)
    div_df = pd.DataFrame(0.0, index=DAYS, columns=close_df.columns)
    for symbol, payments in (dividends or {}).items():
        for day, amount in payments.items():
            div_df.loc[pd.Timestamp(day), symbol] = amount
    return pd.concat({"Close": close_df, "Dividends": div_df}, axis=1)


def flat(value):
    return np.full(len(DAYS), float(value))


def ramp(start, end):
    return np.linspace(start, end, len(DAYS))


BENCH = {"XIC.TO": ramp(50, 55), "XEQT.TO": flat(30), "SPY": ramp(500, 550), "QQQ": flat(400)}


def figures_for(holdings, quotes, fx, base="CAD"):
    return portfolio_metrics.compute(holdings, quotes, fx, base)


def holding(ticker, shares, avg_price=None, currency=None):
    return {"ticker": ticker, "shares": shares, "avg_price": avg_price, "currency": currency}


class PerformanceTest(unittest.TestCase):
    def test_return_and_beta_match_a_proportional_benchmark(self):
        history = make_history({"AAPL": ramp(100, 110), "USDCAD=X": flat(1.4), **BENCH})
        figures = figures_for([holding("AAPL", 10)], {"AAPL": Quote(110, 109, "USD")}, {"CAD": 1, "USD": 1.4})
        p = pa.compute_performance(figures, history, "XIC.TO", "5Y")
        self.assertAlmostEqual(p.portfolio_return, 10.0, places=6)
        self.assertAlmostEqual(p.benchmark_return, 10.0, places=6)
        self.assertAlmostEqual(p.beta, 1.0, places=6)
        self.assertEqual(p.start, DAYS[0])
        self.assertEqual(list(p.series.columns), ["Portfolio", "Benchmark"])
        self.assertAlmostEqual(p.series["Portfolio"].iloc[0], 100)

    def test_lines_per_holding_account_and_type(self):
        # SHOP doubles, XEQT is flat. SHOP is split across two accounts; the TFSA also holds XEQT.
        history = make_history({"SHOP.TO": ramp(100, 200), "XEQT.TO": flat(30), **BENCH})
        holdings = [
            {**holding("SHOP.TO", 1), "account": "RRSP"},
            {**holding("SHOP.TO", 1), "account": "TFSA"},
            {**holding("XEQT.TO", 10), "account": "TFSA"},
        ]
        quotes = {"SHOP.TO": Quote(200, 199, "CAD", quote_type="EQUITY"), "XEQT.TO": Quote(30, 30, "CAD", quote_type="ETF")}
        figures = figures_for(holdings, quotes, {"CAD": 1})

        by_holding = pa.compute_performance(figures, history, "XIC.TO", "5Y", "Holding")
        self.assertEqual(list(by_holding.lines.columns), ["SHOP.TO", "XEQT.TO"])  # largest first
        self.assertAlmostEqual(by_holding.lines["SHOP.TO"].iloc[-1], 200)
        self.assertAlmostEqual(by_holding.lines["XEQT.TO"].iloc[-1], 100)

        by_account = pa.compute_performance(figures, history, "XIC.TO", "5Y", "Account")
        self.assertAlmostEqual(by_account.lines["RRSP"].iloc[-1], 200)
        # TFSA: 100 + 300 at the start, 200 + 300 at the end.
        self.assertAlmostEqual(by_account.lines["TFSA"].iloc[-1], 500 / 400 * 100)

        by_type = pa.compute_performance(figures, history, "XIC.TO", "5Y", "Type")
        self.assertEqual(set(by_type.lines.columns), {"Stock", "ETF"})

        plain = pa.compute_performance(figures, history, "XIC.TO", "5Y")
        self.assertTrue(plain.lines.empty)
        self.assertIsNone(plain.lines_by)

    def test_currency_moves_count_in_base(self):
        # AAPL is flat in USD while USD/CAD rises 10%: a 10% gain in CAD, none in USD.
        history = make_history({"AAPL": flat(100), "USDCAD=X": ramp(1.3, 1.43), "CADUSD=X": 1 / ramp(1.3, 1.43), **BENCH})
        quotes = {"AAPL": Quote(100, 100, "USD")}
        cad = pa.compute_performance(figures_for([holding("AAPL", 1)], quotes, {"CAD": 1, "USD": 1.43}), history, "SPY", "5Y")
        usd = pa.compute_performance(figures_for([holding("AAPL", 1)], quotes, {"USD": 1, "CAD": 0.7}, "USD"), history, "SPY", "5Y")
        self.assertAlmostEqual(cad.portfolio_return, 10.0, places=6)
        self.assertAlmostEqual(usd.portfolio_return, 0.0, places=6)

    def test_max_drawdown(self):
        # Up to 120, down to 90, then up to 130: the worst fall is 120 -> 90, -25%.
        path = np.concatenate([np.linspace(100, 120, 100), np.linspace(119, 90, 100), np.linspace(91, 130, 100)])
        history = make_history({"SHOP.TO": path, **BENCH})
        figures = figures_for([holding("SHOP.TO", 1)], {"SHOP.TO": Quote(130, 129, "CAD")}, {"CAD": 1})
        p = pa.compute_performance(figures, history, "XIC.TO", "5Y")
        self.assertAlmostEqual(p.max_drawdown, -25.0, places=6)
        self.assertEqual(p.drawdown_peak, DAYS[99])
        self.assertEqual(p.drawdown_trough, DAYS[199])
        # 300 business days span about 14 months, so there is an annualized figure.
        days = (DAYS[-1] - DAYS[0]).days
        self.assertAlmostEqual(p.annualized_return, ((130 / 100) ** (365.25 / days) - 1) * 100, places=6)

    def test_late_listing_moves_the_start_and_unpriced_is_excluded(self):
        late = ramp(10, 20)
        late[:150] = np.nan
        history = make_history({"SHOP.TO": ramp(100, 110), "NEWCO.TO": late, **BENCH})
        quotes = {"SHOP.TO": Quote(110, 109, "CAD"), "NEWCO.TO": Quote(20, 19, "CAD"), "GONE.TO": Quote(5, 5, "CAD")}
        figures = figures_for([holding("SHOP.TO", 1), holding("NEWCO.TO", 1), holding("GONE.TO", 1)], quotes, {"CAD": 1})
        p = pa.compute_performance(figures, history, "XIC.TO", "5Y")
        self.assertEqual(p.start, DAYS[150])
        self.assertEqual(p.late_starts, {"NEWCO.TO": DAYS[150]})
        self.assertEqual(p.excluded, ["GONE.TO"])
        self.assertEqual(sorted(p.correlation.columns), ["NEWCO.TO", "SHOP.TO"])

    def test_periods_slice_the_history(self):
        history = make_history({"SHOP.TO": ramp(100, 130), **BENCH})
        figures = figures_for([holding("SHOP.TO", 1)], {"SHOP.TO": Quote(130, 129, "CAD")}, {"CAD": 1})
        month = pa.compute_performance(figures, history, "XIC.TO", "1M")
        self.assertGreaterEqual(month.start, DAYS[-1] - pd.DateOffset(months=1))
        ytd = pa.compute_performance(figures, history, "XIC.TO", "YTD")
        self.assertEqual(ytd.start.year, DAYS[-1].year)
        self.assertEqual(ytd.start.month, 1)

    def test_pence_quotes_are_converted(self):
        history = make_history({"VOD.L": ramp(100, 120), "GBPCAD=X": flat(2.0), "USDCAD=X": flat(1.4), **BENCH})
        figures = figures_for([holding("VOD.L", 100)], {"VOD.L": Quote(120, 119, "GBp")}, {"CAD": 1, "GBP": 2.0})
        p = pa.compute_performance(figures, history, "XIC.TO", "5Y")
        self.assertAlmostEqual(p.portfolio_return, 20.0, places=6)
        self.assertEqual(figures.unit_divisors, {"VOD.L": 100})


class DividendsTest(unittest.TestCase):
    def test_trailing_twelve_months_in_base(self):
        last = DAYS[-1]
        payments = {last - pd.DateOffset(months=m): 0.25 for m in (1, 4, 7, 10)}
        payments[last - pd.DateOffset(months=14)] = 5.0  # older than a year: ignored
        history = make_history(
            {"AAPL": flat(100), "VOD.L": flat(120), "SHOP.TO": flat(50), **BENCH},
            {"AAPL": {d: v for d, v in payments.items() if d in DAYS}, "VOD.L": {DAYS[-20]: 2.0}},
        )
        quotes = {"AAPL": Quote(100, 100, "USD"), "VOD.L": Quote(120, 120, "GBp"), "SHOP.TO": Quote(50, 50, "CAD")}
        figures = figures_for(
            [holding("AAPL", 10), holding("VOD.L", 1000), holding("SHOP.TO", 3)], quotes, {"CAD": 1, "USD": 1.4, "GBP": 2.0}
        )
        d = pa.compute_dividends(figures, history)
        rows = d.rows.set_index("Ticker")
        aapl_paid = sum(v for day, v in payments.items() if day in DAYS and day > last - pd.DateOffset(years=1))
        self.assertAlmostEqual(rows.loc["AAPL", "Dividend/share"], aapl_paid)
        self.assertAlmostEqual(rows.loc["AAPL", "Annual income"], aapl_paid * 10 * 1.4)
        self.assertAlmostEqual(rows.loc["VOD.L", "Dividend/share"], 0.02)  # 2p
        self.assertAlmostEqual(rows.loc["VOD.L", "Yield %"], 0.02 / 1.2 * 100)
        self.assertAlmostEqual(rows.loc["VOD.L", "Annual income"], 0.02 * 1000 * 2.0)
        self.assertEqual(rows.loc["SHOP.TO", "Annual income"], 0)
        self.assertAlmostEqual(d.total_income, aapl_paid * 14 + 40)
        self.assertAlmostEqual(d.portfolio_yield, d.total_income / figures.total_value * 100)


class TrendsTest(unittest.TestCase):
    def test_trends_are_closes_oldest_first_skipping_thin_or_missing_symbols(self):
        close = {"AAA": ramp(10, 12), "THIN": [np.nan] * (len(DAYS) - 1) + [5.0]}
        with mock.patch.object(pa.yf, "download", return_value=make_history(close)) as download:
            trends = pa.fetch_trends(("AAA", "THIN", "GONE"))
        self.assertEqual(download.call_args.kwargs["period"], pa.TREND_PERIOD)
        self.assertEqual(set(trends), {"AAA"})
        self.assertEqual(trends["AAA"][0], 10.0)
        self.assertEqual(trends["AAA"][-1], 12.0)

    def test_no_symbols_skips_the_download(self):
        with mock.patch.object(pa.yf, "download") as download:
            self.assertEqual(pa.fetch_trends(()), {})
        download.assert_not_called()


class MarkdownTest(unittest.TestCase):
    def test_summary_for_the_analyst(self):
        history = make_history(
            {"AAPL": ramp(100, 110), "SHOP.TO": ramp(50, 60), "USDCAD=X": flat(1.4), **BENCH},
            {"AAPL": {DAYS[-5]: 1.0}},
        )
        quotes = {"AAPL": Quote(110, 109, "USD"), "SHOP.TO": Quote(60, 59, "CAD")}
        figures = figures_for([holding("AAPL", 10), holding("SHOP.TO", 10)], quotes, {"CAD": 1, "USD": 1.4})
        text = pa.to_markdown(pa.compute_performance(figures, history, "XIC.TO", "1Y"), pa.compute_dividends(figures, history))
        self.assertIn("Backtest of today's holdings", text)
        self.assertIn("benchmark S&P/TSX Composite (XIC)", text)
        self.assertIn("Annualized volatility", text)
        self.assertIn("Most correlated pairs", text)
        self.assertIn("expected annual income 14.00 CAD", text)
        self.assertIn("AAPL", text.split("Payers:")[1])

    def test_history_symbols_cover_all_benchmarks_and_fx(self):
        positions = pd.DataFrame({"Ticker": ["VOD.L", "SHOP.TO"], "Currency": ["GBP", "CAD"]})
        self.assertEqual(
            pa.history_symbols(positions, "CAD"),
            sorted(["VOD.L", "SHOP.TO", *pa.BENCHMARKS, "GBPCAD=X", "USDCAD=X"]),
        )


if __name__ == "__main__":
    unittest.main()
