"""The app's flow without Streamlit: holdings in, figures and the analyst's prompt out.

Shared by the Streamlit pages (main.py, dashboard.py) and the HTTP API
(api/index.py), so both compute the same numbers from the same steps.
"""
import math
import threading
import time

import pandas as pd

import account_hints
import portfolio_analytics
import portfolio_metrics
import rebalance
from portfolio_import import normalize_account

QUOTE_TTL = 300  # seconds; quotes and FX
HISTORY_TTL = 3600
TREND_TTL = 900  # one month of daily closes; today's bar moves, so not the full hour


class TTLCache:
    """A small thread-safe cache of function results by key, each kept for `ttl` seconds."""

    def __init__(self, ttl: float):
        self.ttl = ttl
        self._items = {}
        self._lock = threading.Lock()

    def get(self, key, compute):
        now = time.monotonic()
        with self._lock:
            hit = self._items.get(key)
            if hit and now - hit[0] < self.ttl:
                return hit[1]
        value = compute()
        with self._lock:
            self._items[key] = (now, value)
        return value

    def clear(self):
        with self._lock:
            self._items.clear()


_quote_cache = TTLCache(QUOTE_TTL)
_fx_cache = TTLCache(QUOTE_TTL)
_history_cache = TTLCache(HISTORY_TTL)
_trend_cache = TTLCache(TREND_TTL)


def clear_caches() -> None:
    for cache in (_quote_cache, _fx_cache, _history_cache, _trend_cache):
        cache.clear()


def quotes(tickers: tuple) -> dict:
    return _quote_cache.get(tickers, lambda: portfolio_metrics.fetch_quotes(tickers))


def fx_rates(currencies: tuple, base: str) -> dict:
    return _fx_cache.get((currencies, base), lambda: portfolio_metrics.fetch_fx(currencies, base))


def history(symbols: tuple):
    return _history_cache.get(symbols, lambda: portfolio_analytics.fetch_history(symbols))


def trends(symbols: tuple) -> dict:
    return _trend_cache.get(symbols, lambda: portfolio_analytics.fetch_trends(symbols))


def _cell(value):
    """Data editor cells can be None, NaN or strings; normalize to str/None."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return value


def _balance_row(row):
    """A balance-only holding (managed account, pension...) from a row with a Balance, or None to skip it."""
    name = str(_cell(row.get("Ticker")) or "").strip()
    try:
        balance = float(_cell(row.get("Balance")))
        invested = _cell(row.get("Avg Buy Price"))
        invested = float(invested) if invested is not None else None
    except (TypeError, ValueError):
        return None
    if not name or balance <= 0:
        return None
    return {
        "ticker": name,
        "shares": balance,
        "balance": balance,
        "avg_price": invested,  # the total amount put in, for P/L
        "currency": str(_cell(row.get("Currency")) or "").strip().upper() or "CAD",
        "account": normalize_account(_cell(row.get("Account"))) or None,
    }


def parse_portfolio(rows):
    holdings = []
    for row in rows:
        if _cell(row.get("Balance")) is not None:
            balance = _balance_row(row)
            if balance:
                holdings.append(balance)
            continue
        ticker = str(_cell(row.get("Ticker")) or "").strip().upper()
        if not ticker:
            continue
        try:
            shares = float(_cell(row.get("Shares")) or 0)
            avg_price = _cell(row.get("Avg Buy Price"))
            avg_price = float(avg_price) if avg_price is not None else None
        except ValueError:
            continue
        if shares <= 0:
            continue
        currency = str(_cell(row.get("Currency")) or "").strip().upper()
        holdings.append(
            {
                "ticker": ticker,
                "shares": shares,
                "avg_price": avg_price,
                # Blank means the cost is in the currency the ticker trades in.
                "currency": currency or None,
                "account": normalize_account(_cell(row.get("Account"))) or None,
            }
        )
    return holdings


def load_figures(holdings, base: str, quotes_fn=quotes, fx_fn=fx_rates):
    """Figures for the holdings, or None without holdings."""
    if not holdings:
        return None
    found = quotes_fn(tuple(sorted({h["ticker"] for h in holdings if h.get("balance") is None})))
    currencies = portfolio_metrics.needed_currencies(holdings, found) | {base}
    fx = fx_fn(tuple(sorted(currencies)), base)
    return portfolio_metrics.compute(holdings, found, fx, base)


def load_history(figures, history_fn=history):
    priced = figures.positions[~figures.positions["Ticker"].isin(figures.balance_tickers)]
    return history_fn(tuple(portfolio_analytics.history_symbols(priced, figures.base)))


def rebalance_rows(figures, group_by: str, scope: str) -> pd.DataFrame:
    """The rows rebalance.plan works on, for one grouping and account scope."""
    if scope == rebalance.ALL_ACCOUNTS:
        positions = figures.by_ticker()
    else:
        positions = figures.positions[figures.positions["Account"] == scope]
    return rebalance.universe(positions, rebalance.GROUPINGS[group_by])


def current_weights(rows: pd.DataFrame) -> pd.Series:
    """Exact % of value per group, in the rows' order."""
    current = rows.groupby("Group", sort=False)["Value"].sum()
    return current / current.sum() * 100


def resolve_targets(targets: dict, exact: pd.Series) -> dict:
    """A target left at its (rounded) current weight means "keep it": use the exact
    weight, so rounding alone doesn't produce trades."""
    weights = exact.round(1)
    resolved = dict(targets)
    for group, target in resolved.items():
        if group in weights.index and abs(target - weights[group]) < 1e-9:
            resolved[group] = exact[group]
    return resolved


def new_holding_rows(rows, wanted, base, quotes_fn=quotes, fx_fn=fx_rates):
    """Add holdings typed into the targets table that aren't owned yet. Returns (rows, unknown)."""
    unknown = []
    for ticker in wanted:
        quote = quotes_fn((ticker,)).get(ticker)
        if quote is None:
            unknown.append(ticker)
            continue
        price, currency = portfolio_metrics.normalize(quote.price, quote.currency)
        fx = fx_fn(tuple(sorted({currency, base})), base).get(currency)
        if fx is None:
            unknown.append(ticker)
            continue
        rows = rebalance.add_holding(rows, ticker, price, currency, fx)
    return rows, unknown


def format_prompt(
    holdings, question: str, figures=None, performance=None, dividends=None, hints=None, rebalance_plan=None
) -> str:
    lines = ["Here is my current stock portfolio:", ""]
    lines.append("| Ticker | Shares | Avg Buy Price | Currency | Account |")
    lines.append("|--------|--------|---------------|----------|---------|")
    for h in holdings:
        if h.get("balance") is not None:
            invested = f"{h['avg_price']:,.2f} invested" if h["avg_price"] is not None else "amount invested unknown"
            lines.append(f"| {h['ticker']} (managed account, holdings unknown) | balance {h['balance']:,.2f} | {invested} | {h['currency']} | {h.get('account') or 'unspecified'} |")
            continue
        avg = h["avg_price"] if h["avg_price"] is not None else "unknown"
        currency = h["currency"] or "same as listing"
        account = h.get("account") or "unspecified"
        lines.append(
            f"| {h['ticker']} | {h['shares']} | {avg} | {currency} | {account} |"
        )
    if figures is not None:
        lines += ["", portfolio_metrics.to_markdown(figures)]
    if performance is not None or dividends is not None:
        lines += ["", portfolio_analytics.to_markdown(performance, dividends)]
    if figures is not None and not figures.positions.empty:
        lines += ["", account_hints.to_markdown(figures, dividends, hints or [])]
    if rebalance_plan is not None:
        lines += ["", rebalance.to_markdown(rebalance_plan)]
    lines.append("")
    lines.append(question.strip() or "Analyze my portfolio end-to-end.")
    return "\n".join(lines)
