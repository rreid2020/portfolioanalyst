"""Performance, risk and dividend figures from daily price history.

Performance is a backtest of today's holdings: the current share counts are
valued on each past day, so it shows how this mix would have done, not the
returns actually earned. Closes are adjusted (dividends reinvested) and
converted to the base currency with each day's exchange rate.
"""
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import yfinance as yf

# Total-return ETFs rather than price indexes, so the comparison includes dividends.
BENCHMARKS = {
    "XIC.TO": ("S&P/TSX Composite (XIC)", "CAD"),
    "XEQT.TO": ("Global equity (XEQT)", "CAD"),
    "SPY": ("S&P 500 (SPY)", "USD"),
    "QQQ": ("Nasdaq 100 (QQQ)", "USD"),
}
PERIODS = {
    "1M": pd.DateOffset(months=1),
    "3M": pd.DateOffset(months=3),
    "6M": pd.DateOffset(months=6),
    "YTD": None,
    "1Y": pd.DateOffset(years=1),
    "3Y": pd.DateOffset(years=3),
    "5Y": pd.DateOffset(years=5),
}
HISTORY_PERIOD = "5y"
TRADING_DAYS = 252
MAX_CORRELATION_HOLDINGS = 12


def fx_symbol(currency: str, base: str) -> str:
    return f"{currency}{base}=X"


def history_symbols(positions: pd.DataFrame, base: str) -> list:
    """Tickers, every benchmark and the FX pairs needed to value them in base.

    All benchmarks are fetched up front so switching between them needs no download.
    """
    currencies = set(positions["Currency"]) | {currency for _, currency in BENCHMARKS.values()}
    fx = {fx_symbol(c, base) for c in currencies if c != base}
    return sorted(set(positions["Ticker"]) | set(BENCHMARKS) | fx)


def fetch_history(symbols) -> pd.DataFrame:
    """Daily adjusted closes and dividends for 5 years, columns (field, symbol)."""
    return yf.download(
        list(symbols), period=HISTORY_PERIOD, interval="1d", auto_adjust=True, actions=True,
        progress=False, threads=True, multi_level_index=True,
    )


def _field(history: pd.DataFrame, name: str) -> pd.DataFrame:
    if history is None or history.empty or name not in history.columns.get_level_values(0):
        return pd.DataFrame()
    return history[name]


def _fx_series(close: pd.DataFrame, currency: str, base: str, index):
    if currency == base:
        return pd.Series(1.0, index=index)
    symbol = fx_symbol(currency, base)
    if symbol not in close:
        return None
    return close[symbol].reindex(index).ffill().bfill()


def period_start(last: pd.Timestamp, period: str) -> pd.Timestamp:
    offset = PERIODS[period]
    if offset is None:
        return pd.Timestamp(year=last.year, month=1, day=1)
    return last - offset


@dataclass
class Performance:
    period: str
    benchmark: str
    base: str
    start: pd.Timestamp
    end: pd.Timestamp
    series: pd.DataFrame  # Portfolio and Benchmark, indexed to 100 at start
    portfolio_return: float  # % over the period
    benchmark_return: float | None
    annualized_return: float | None  # % per year, for periods of a year or more
    volatility: float | None  # annualized %, from daily returns
    beta: float | None
    max_drawdown: float  # % (negative)
    drawdown_peak: pd.Timestamp
    drawdown_trough: pd.Timestamp
    correlation: pd.DataFrame
    excluded: list = field(default_factory=list)  # no price history
    late_starts: dict = field(default_factory=dict)  # ticker -> first date, when after the period start


def compute_performance(figures, history: pd.DataFrame, benchmark: str, period: str):
    """Backtest of figures.positions over `period`, or None without enough history."""
    close = _field(history, "Close")
    positions = figures.by_ticker() if not figures.positions.empty else figures.positions
    # Balance-only holdings have no price history; the backtest covers the priced holdings.
    positions = positions[~positions["Ticker"].isin(figures.balance_tickers)]
    if close.empty or positions.empty:
        return None
    base = figures.base
    tickers = [t for t in positions["Ticker"] if t in close and close[t].notna().any()]
    excluded = [t for t in positions["Ticker"] if t not in tickers]
    if not tickers:
        return None

    # Days when at least one holding traded (FX quotes also trade on stock holidays).
    traded = close.loc[close[tickers].notna().any(axis=1)]
    index = traded.index
    # The period can reach back past the downloaded history; start no earlier than the data.
    start = max(period_start(index[-1], period), index[0])
    first_dates = {t: traded[t].first_valid_index() for t in tickers}
    # A week's slack keeps holidays at the window's edge from counting as a late listing.
    late_starts = {t: d for t, d in first_dates.items() if d > start + pd.Timedelta(days=7)}
    start = max([start, *late_starts.values()])
    window = index[index >= start]
    if len(window) < 2:
        return None

    values = {}
    for row in positions.itertuples(index=False):
        if row.Ticker not in tickers:
            continue
        fx = _fx_series(close, row.Currency, base, window)
        if fx is None:
            excluded.append(row.Ticker)
            continue
        price = traded[row.Ticker].reindex(window).ffill() / figures.unit_divisors.get(row.Ticker, 1)
        values[row.Ticker] = price * fx
    if not values:
        return None
    per_share = pd.DataFrame(values)
    shares = positions.set_index("Ticker")["Shares"].reindex(per_share.columns)
    portfolio = (per_share * shares).sum(axis=1, min_count=len(per_share.columns)).dropna()

    bench_currency = BENCHMARKS[benchmark][1]
    bench = None
    if benchmark in close:
        bench_fx = _fx_series(close, bench_currency, base, portfolio.index)
        if bench_fx is not None:
            bench = (close[benchmark].reindex(portfolio.index).ffill() * bench_fx).dropna()
            if len(bench) < 2:
                bench = None

    returns = portfolio.pct_change().dropna()
    series = pd.DataFrame({"Portfolio": portfolio / portfolio.iloc[0] * 100})
    beta = benchmark_return = None
    if bench is not None:
        series["Benchmark"] = bench / bench.iloc[0] * 100
        benchmark_return = (bench.iloc[-1] / bench.iloc[0] - 1) * 100
        bench_returns = bench.pct_change().dropna()
        joined = pd.concat([returns, bench_returns], axis=1, join="inner").dropna()
        if len(joined) > 10 and joined.iloc[:, 1].var() > 0:
            beta = joined.cov().iloc[0, 1] / joined.iloc[:, 1].var()

    days = (portfolio.index[-1] - portfolio.index[0]).days
    total = portfolio.iloc[-1] / portfolio.iloc[0] - 1
    drawdown = portfolio / portfolio.cummax() - 1
    trough = drawdown.idxmin()
    peak = portfolio.loc[:trough].idxmax()

    top = positions[positions["Ticker"].isin(per_share.columns)].head(MAX_CORRELATION_HOLDINGS)["Ticker"]
    correlation = per_share[list(top)].pct_change().dropna(how="all").corr() if len(top) > 1 else pd.DataFrame()

    return Performance(
        period=period,
        benchmark=benchmark,
        base=base,
        start=portfolio.index[0],
        end=portfolio.index[-1],
        series=series,
        portfolio_return=total * 100,
        benchmark_return=benchmark_return,
        annualized_return=((1 + total) ** (365.25 / days) - 1) * 100 if days >= 365 else None,
        volatility=returns.std() * np.sqrt(TRADING_DAYS) * 100 if len(returns) > 10 else None,
        beta=beta,
        max_drawdown=drawdown.min() * 100,
        drawdown_peak=peak,
        drawdown_trough=trough,
        correlation=correlation,
        excluded=excluded,
        late_starts=late_starts,
    )


@dataclass
class Dividends:
    base: str
    rows: pd.DataFrame  # Ticker, Account, Dividend/share, Currency, Yield %, Annual income; one row per position
    total_income: float
    portfolio_yield: float | None  # % of total market value

    def by_ticker(self) -> pd.DataFrame:
        """Income per ticker across accounts, largest first."""
        if self.rows.empty:
            return self.rows
        return (
            self.rows.groupby("Ticker", as_index=False, sort=False)
            .agg({"Dividend/share": "first", "Currency": "first", "Yield %": "first", "Annual income": "sum"})
            .sort_values("Annual income", ascending=False, ignore_index=True)
        )


def compute_dividends(figures, history: pd.DataFrame, as_of=None) -> Dividends:
    """Trailing 12-month dividends per holding, as expected annual income in base."""
    dividends = _field(history, "Dividends")
    base = figures.base
    fx = {**figures.fx, base: 1.0}
    end = pd.Timestamp(as_of) if as_of is not None else (dividends.index[-1] if not dividends.empty else pd.Timestamp.now())
    recent = dividends.loc[dividends.index > end - pd.DateOffset(years=1)] if not dividends.empty else dividends

    rows = []
    for p in figures.positions.itertuples(index=False):
        paid = recent[p.Ticker].sum() if p.Ticker in recent else 0.0
        per_share = paid / figures.unit_divisors.get(p.Ticker, 1)
        rows.append({
            "Ticker": p.Ticker,
            "Account": p.Account,
            "Dividend/share": per_share,
            "Currency": p.Currency,
            "Yield %": per_share / p.Price * 100 if p.Price else None,
            "Annual income": per_share * p.Shares * fx.get(p.Currency, np.nan),
        })
    table = pd.DataFrame(rows, columns=["Ticker", "Account", "Dividend/share", "Currency", "Yield %", "Annual income"])
    table = table.sort_values("Annual income", ascending=False, ignore_index=True)
    total = float(table["Annual income"].sum())
    return Dividends(
        base=base,
        rows=table,
        total_income=total,
        portfolio_yield=total / figures.total_value * 100 if figures.total_value else None,
    )


def _pct(value):
    return "n/a" if value is None or pd.isna(value) else f"{value:+.2f}%"


def to_markdown(performance, dividends) -> str:
    """Risk and income figures for the analyst's prompt."""
    lines = []
    if performance is not None:
        p = performance
        name = BENCHMARKS[p.benchmark][0]
        lines += [
            f"Backtest of today's holdings from {p.start:%Y-%m-%d} to {p.end:%Y-%m-%d} ({p.period}), "
            f"in {p.base}, dividends reinvested:",
            "",
            f"- Portfolio return: {_pct(p.portfolio_return)}; benchmark {name}: {_pct(p.benchmark_return)}",
        ]
        if p.annualized_return is not None:
            lines.append(f"- Annualized return: {_pct(p.annualized_return)}")
        lines += [
            f"- Annualized volatility: {'n/a' if p.volatility is None else f'{p.volatility:.1f}%'}",
            f"- Beta vs {name}: {'n/a' if p.beta is None else f'{p.beta:.2f}'}",
            f"- Max drawdown: {p.max_drawdown:.1f}% ({p.drawdown_peak:%Y-%m-%d} to {p.drawdown_trough:%Y-%m-%d})",
        ]
        if not p.correlation.empty:
            pairs = []
            tickers = list(p.correlation.columns)
            for i, a in enumerate(tickers):
                for b in tickers[i + 1:]:
                    pairs.append((p.correlation.loc[a, b], a, b))
            pairs.sort(reverse=True)
            shown = ", ".join(f"{a}/{b} {c:.2f}" for c, a, b in pairs[:5])
            lines.append(f"- Most correlated pairs (daily returns): {shown}")
        if p.excluded:
            lines.append(f"- No price history for: {', '.join(p.excluded)}")
    if dividends is not None:
        d = dividends
        payers = d.by_ticker()
        payers = payers[payers["Annual income"] > 0]
        lines += [
            "",
            f"Dividends (trailing 12 months, in {d.base}): expected annual income "
            f"{d.total_income:,.2f} {d.base}, portfolio yield "
            f"{'n/a' if d.portfolio_yield is None else f'{d.portfolio_yield:.2f}%'}.",
        ]
        if not payers.empty:
            lines.append("Payers: " + ", ".join(
                f"{r['Ticker']} {r['Yield %']:.2f}% ({r['Annual income']:,.2f} {d.base}/yr)"
                for r in payers.to_dict("records")
            ))
    return "\n".join(lines)
