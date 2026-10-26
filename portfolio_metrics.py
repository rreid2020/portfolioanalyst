"""Portfolio figures computed in code from live Yahoo Finance quotes.

Market value, unrealized P/L, weights, day change and allocation are worked
out here and converted to one base currency, so the dashboard shows them
instantly and the analyst gets verified numbers instead of doing the math.
"""
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import pandas as pd
import yfinance as yf

BASE_CURRENCIES = ("CAD", "USD")

# Some exchanges quote in minor units, e.g. London in pence ("GBp").
MINOR_UNITS = {"GBp": ("GBP", 100), "GBX": ("GBP", 100), "ZAc": ("ZAR", 100), "ILA": ("ILS", 100)}

FUND_TYPES = {"ETF": "ETF", "MUTUALFUND": "Mutual fund"}
# What kind of holding each Yahoo quoteType is, for grouping (the Performance chart's "Type" lines).
HOLDING_TYPES = {"EQUITY": "Stock", **FUND_TYPES, "MONEYMARKET": "Money market", "CRYPTOCURRENCY": "Crypto", "INDEX": "Index"}

POSITION_COLUMNS = [
    "Ticker", "Account", "Name", "Shares", "Price", "Currency", "Value", "Cost", "P/L",
    "P/L %", "Day change", "Weight %", "Sector", "Country", "Type",
]
UNSPECIFIED_ACCOUNT = "Unspecified"

# Columns summed when rows of one ticker are combined; the rest take the first row.
_SUMMED = ["Shares", "Value", "Cost", "P/L", "Day change"]


def _combine(positions: pd.DataFrame, keys) -> pd.DataFrame:
    """Combine rows sharing `keys`; money is summed, P/L % and weights recomputed."""
    if not positions.duplicated(keys).any():
        return positions
    aggregations = {c: "first" for c in positions.columns if c not in keys}
    # A sum with any unknown cost (NaN) stays unknown rather than understating it.
    aggregations.update({c: (lambda col: col.sum(min_count=len(col))) for c in _SUMMED if c not in ("Shares", "Value")})
    aggregations.update({"Shares": "sum", "Value": "sum"})
    combined = positions.groupby(keys, as_index=False, sort=False, dropna=False).agg(aggregations)
    combined["P/L %"] = combined["P/L"] / combined["Cost"] * 100
    return combined


@dataclass
class Quote:
    price: float
    previous_close: float | None
    currency: str
    name: str = ""
    sector: str = ""
    country: str = ""
    quote_type: str = ""
    as_of: float | None = None  # epoch seconds of the price: Yahoo's last trade, else when fetched


@dataclass
class Figures:
    base: str
    positions: pd.DataFrame  # POSITION_COLUMNS, money columns in the base currency
    fx: dict  # currency -> base-currency units per 1 unit
    unpriced: list = field(default_factory=list)
    # ticker -> divisor from the quote's units to its currency (100 for GBp)
    unit_divisors: dict = field(default_factory=dict)
    # names of balance-only holdings (managed accounts and the like): valued at their stated balance,
    # with no quote, price history or dividends
    balance_tickers: list = field(default_factory=list)
    total_value: float = 0.0
    total_cost: float | None = None  # positions with a known average price only
    cost_covered_value: float = 0.0  # market value of those positions
    day_change: float | None = None
    prices_as_of: float | None = None  # epoch seconds of the newest quote used

    @property
    def total_pl(self):
        return None if self.total_cost is None else self.cost_covered_value - self.total_cost

    @property
    def total_pl_pct(self):
        if not self.total_cost:
            return None
        return self.total_pl / self.total_cost * 100

    @property
    def day_change_pct(self):
        if self.day_change is None:
            return None
        previous = self.total_value - self.day_change
        return self.day_change / previous * 100 if previous else None

    def by_ticker(self) -> pd.DataFrame:
        """Positions with each ticker's accounts combined into one row, largest first."""
        combined = _combine(self.positions.drop(columns="Weight %"), ["Ticker"])
        combined["Account"] = (
            self.positions.groupby("Ticker")["Account"].agg(lambda a: ", ".join(dict.fromkeys(a))).reindex(combined["Ticker"]).values
        )
        combined["Weight %"] = combined["Value"] / self.total_value * 100 if self.total_value else 0.0
        return combined[POSITION_COLUMNS].sort_values("Value", ascending=False, ignore_index=True)

    def allocation(self, by: str) -> pd.DataFrame:
        """Value and weight per group of `by` (a POSITION_COLUMNS name), largest first."""
        grouped = self.positions.groupby(by, dropna=False)["Value"].sum().reset_index()
        grouped.columns = ["Group", "Value"]
        grouped["Weight %"] = grouped["Value"] / self.total_value * 100 if self.total_value else 0.0
        return grouped.sort_values("Value", ascending=False, ignore_index=True)


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None  # NaN -> None


def fetch_quote(ticker: str):
    """Price, previous close and profile for one ticker, or None if Yahoo has no price."""
    try:
        yt = yf.Ticker(ticker)
        fast = yt.fast_info
        price = _number(fast.last_price)
        currency = fast.currency
    except Exception:
        return None
    if price is None or not currency:
        return None
    try:
        previous_close = _number(fast.previous_close)
    except Exception:
        previous_close = None
    try:
        info = yt.info or {}
    except Exception:  # profile data is optional; the price is what matters
        info = {}
    return Quote(
        price=price,
        previous_close=previous_close,
        currency=currency,
        name=(info.get("shortName") or info.get("longName") or "").strip(),
        sector=info.get("sector") or "",
        country=info.get("country") or "",
        quote_type=info.get("quoteType") or "",
        as_of=_number(info.get("regularMarketTime")) or time.time(),
    )


def fetch_quotes(tickers) -> dict:
    tickers = sorted(set(tickers))
    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(zip(tickers, pool.map(fetch_quote, tickers)))


def fetch_fx(currencies, base: str) -> dict:
    """Base-currency units per unit of each currency, from Yahoo's XXXYYY=X pairs."""
    def rate(currency):
        if currency == base:
            return 1.0
        quote = fetch_quote(f"{currency}{base}=X")
        return quote.price if quote else None

    currencies = sorted(set(currencies))
    with ThreadPoolExecutor(max_workers=4) as pool:
        rates = dict(zip(currencies, pool.map(rate, currencies)))
    return {c: r for c, r in rates.items() if r is not None}


def normalize(price, currency):
    """Convert minor-unit quotes (GBp) to major units (GBP)."""
    major, factor = MINOR_UNITS.get(currency, (currency, 1))
    return (None if price is None else price / factor), major


BALANCE_SECTOR = "Managed (holdings unknown)"
BALANCE_NAME = "Balance only"


def needed_currencies(holdings, quotes) -> set:
    currencies = {h["currency"] for h in holdings if h.get("balance") is not None}
    for h in holdings:
        quote = quotes.get(h["ticker"])
        if quote:
            currencies.add(normalize(quote.price, quote.currency)[1])
            if h.get("avg_price") is not None and h.get("currency"):
                currencies.add(h["currency"])
    return currencies


def compute(holdings, quotes: dict, fx: dict, base: str) -> Figures:
    """Figures for holdings as returned by main.parse_portfolio.

    A holding's Currency is the currency of its average buy price; when blank
    it is taken to be the currency the ticker trades in.
    """
    rows = []
    unpriced = []
    unit_divisors = {}
    total_cost = 0.0
    cost_covered_value = 0.0
    has_cost = False
    day_change = 0.0
    has_day_change = False
    balance_tickers = []
    for h in holdings:
        if h.get("balance") is not None:
            # A managed account or other balance: its value is what the user entered, in its currency;
            # avg_price holds the total amount put in. Shares are currency units at a price of 1.
            currency = h["currency"]
            if currency not in fx:
                unpriced.append(h["ticker"])
                continue
            value = h["balance"] * fx[currency]
            cost = pl = pl_pct = None
            if h.get("avg_price") is not None:
                cost = h["avg_price"] * fx[currency]
                pl = value - cost
                pl_pct = pl / cost * 100 if cost else None
                total_cost += cost
                cost_covered_value += value
                has_cost = True
            balance_tickers.append(h["ticker"])
            rows.append({
                "Ticker": h["ticker"], "Account": h.get("account") or UNSPECIFIED_ACCOUNT, "Name": BALANCE_NAME,
                "Shares": h["balance"], "Price": 1.0, "Currency": currency, "Value": value, "Cost": cost,
                "P/L": pl, "P/L %": pl_pct, "Day change": None, "Sector": BALANCE_SECTOR, "Country": "Unknown", "Type": "Managed balance",
            })
            continue
        quote = quotes.get(h["ticker"])
        if quote is None:
            unpriced.append(h["ticker"])
            continue
        price, currency = normalize(quote.price, quote.currency)
        previous_close, _ = normalize(quote.previous_close, quote.currency)
        unit_divisors[h["ticker"]] = MINOR_UNITS.get(quote.currency, (currency, 1))[1]
        cost_currency = h.get("currency") or currency
        if currency not in fx or (h.get("avg_price") is not None and cost_currency not in fx):
            unpriced.append(h["ticker"])
            continue

        shares = h["shares"]
        value = price * shares * fx[currency]
        cost = pl = pl_pct = None
        if h.get("avg_price") is not None:
            cost = h["avg_price"] * shares * fx[cost_currency]
            pl = value - cost
            pl_pct = pl / cost * 100 if cost else None
            total_cost += cost
            cost_covered_value += value
            has_cost = True
        change = None
        if previous_close is not None:
            change = (price - previous_close) * shares * fx[currency]
            day_change += change
            has_day_change = True

        rows.append({
            "Ticker": h["ticker"],
            "Account": h.get("account") or UNSPECIFIED_ACCOUNT,
            "Name": quote.name,
            "Shares": shares,
            "Price": price,
            "Currency": currency,
            "Value": value,
            "Cost": cost,
            "P/L": pl,
            "P/L %": pl_pct,
            "Day change": change,
            "Sector": quote.sector or FUND_TYPES.get(quote.quote_type, "Unknown"),
            "Country": quote.country or ("Fund (mixed)" if quote.quote_type in FUND_TYPES else "Unknown"),
            "Type": HOLDING_TYPES.get(quote.quote_type, "Other"),
        })

    positions = pd.DataFrame(rows, columns=[c for c in POSITION_COLUMNS if c != "Weight %"])
    # A ticker can appear twice in one account in the editor; combine it like the importers do.
    positions = _combine(positions, ["Ticker", "Account"])
    total_value = float(positions["Value"].sum())
    positions["Weight %"] = positions["Value"] / total_value * 100 if total_value else 0.0
    positions = positions[POSITION_COLUMNS].sort_values("Value", ascending=False, ignore_index=True)

    priced = {h["ticker"] for h in holdings} - set(unpriced) - set(balance_tickers)
    return Figures(
        base=base,
        positions=positions,
        fx={c: r for c, r in fx.items() if c != base},
        unpriced=unpriced,
        unit_divisors=unit_divisors,
        balance_tickers=sorted(set(balance_tickers)),
        total_value=total_value,
        total_cost=total_cost if has_cost else None,
        cost_covered_value=cost_covered_value,
        day_change=day_change if has_day_change else None,
        prices_as_of=max((q.as_of for t, q in quotes.items() if q and q.as_of and t in priced), default=None),
    )


def _amount(value):
    return "n/a" if value is None or pd.isna(value) else f"{value:,.2f}"


def _money(value, base):
    return "n/a" if value is None or pd.isna(value) else f"{value:,.2f} {base}"


def _pct(value):
    return "n/a" if value is None or pd.isna(value) else f"{value:+.2f}%"


def to_markdown(figures: Figures) -> str:
    """The figures as Markdown for the analyst's prompt."""
    base = figures.base
    lines = [
        f"Figures computed from live Yahoo Finance quotes, in {base}:",
        "",
        f"- Total market value: {_money(figures.total_value, base)}",
        f"- Total cost basis (positions with a known average price): {_money(figures.total_cost, base)}",
        f"- Unrealized P/L: {_money(figures.total_pl, base)} ({_pct(figures.total_pl_pct)})",
        f"- Change today: {_money(figures.day_change, base)} ({_pct(figures.day_change_pct)})",
    ]
    if figures.fx:
        rates = ", ".join(f"1 {c} = {r:.4f} {base}" for c, r in sorted(figures.fx.items()))
        lines.append(f"- FX rates used: {rates}")
    if figures.unpriced:
        lines.append(f"- No live price found for: {', '.join(figures.unpriced)} (excluded from totals)")
    lines += [
        "",
        f"| Ticker | Account | Name | Shares | Price | Ccy | Value ({base}) | Cost ({base}) | P/L ({base}) | P/L % | Weight % | Sector | Country |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in figures.positions.to_dict("records"):
        if r["Ticker"] in figures.balance_tickers:
            lines.append(
                f"| {r['Ticker']} | {r['Account']} | balance only, holdings unknown | — | — | {r['Currency']} "
                f"| {r['Value']:,.2f} | {_amount(r['Cost'])} | {_amount(r['P/L'])} | {_pct(r['P/L %'])} "
                f"| {r['Weight %']:.1f} | — | — |"
            )
            continue
        lines.append(
            f"| {r['Ticker']} | {r['Account']} | {r['Name']} | {r['Shares']:g} | {r['Price']:,.2f} | {r['Currency']} "
            f"| {r['Value']:,.2f} | {_amount(r['Cost'])} | {_amount(r['P/L'])} | {_pct(r['P/L %'])} "
            f"| {r['Weight %']:.1f} | {r['Sector']} | {r['Country']} |"
        )
    for by in ("Account", "Sector", "Country", "Currency"):
        parts = ", ".join(f"{g} {w:.1f}%" for g, w in figures.allocation(by)[["Group", "Weight %"]].itertuples(index=False))
        lines.append("")
        lines.append(f"Allocation by {by.lower()}: {parts}")
    return "\n".join(lines)
