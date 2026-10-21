"""Market research lookups for the analyst's tools: what agno's YFinanceTools and
DuckDuckGoTools did for the Streamlit app, as plain functions returning JSON-ready data.

The Next.js analyst route (Vercel AI SDK) calls these through /api/py/research/*.
Every function raises LookupError when Yahoo or the search engine has nothing.
"""
import math

import yfinance as yf

FUNDAMENTAL_FIELDS = {
    "symbol": "symbol",
    "company_name": "longName",
    "sector": "sector",
    "industry": "industry",
    "market_cap": "marketCap",
    "pe_ratio": "trailingPE",
    "forward_pe": "forwardPE",
    "pb_ratio": "priceToBook",
    "peg_ratio": "pegRatio",
    "dividend_yield": "dividendYield",
    "eps": "trailingEps",
    "beta": "beta",
    "profit_margins": "profitMargins",
    "revenue_growth": "revenueGrowth",
    "debt_to_equity": "debtToEquity",
    "return_on_equity": "returnOnEquity",
    "52_week_high": "fiftyTwoWeekHigh",
    "52_week_low": "fiftyTwoWeekLow",
    "currency": "currency",
}
HISTORY_PERIODS = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max"}
HISTORY_INTERVALS = {"1d", "1wk", "1mo"}
MAX_NEWS = 10
MAX_RESULTS = 10


def _clean(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def price(symbol: str) -> dict:
    fast = yf.Ticker(symbol).fast_info
    last = _clean(fast.last_price)
    if last is None:
        raise LookupError(f"No price for {symbol}.")
    return {"symbol": symbol, "price": last, "currency": fast.currency, "previous_close": _clean(fast.previous_close)}


def fundamentals(symbol: str) -> dict:
    info = yf.Ticker(symbol).info or {}
    if not info.get("symbol") and not info.get("longName"):
        raise LookupError(f"No company data for {symbol}.")
    return {key: _clean(info.get(field)) for key, field in FUNDAMENTAL_FIELDS.items()}


def recommendations(symbol: str) -> list:
    table = yf.Ticker(symbol).recommendations
    if table is None or table.empty:
        raise LookupError(f"No analyst recommendations for {symbol}.")
    return [{k: _clean(v) for k, v in row.items()} for row in table.to_dict("records")]


def news(symbol: str, limit: int = 5) -> list:
    """Yahoo's stories for the ticker, or a web news search when Yahoo has none."""
    limit = max(1, min(limit, MAX_NEWS))
    items = (yf.Ticker(symbol).news or [])[:limit]
    if not items:
        try:
            results = search(f"{symbol} stock", news_only=True, limit=limit)
        except LookupError:
            raise LookupError(f"No news for {symbol}.") from None
        return [
            {"title": r["title"], "summary": r["snippet"], "published": r["date"], "publisher": r["source"], "url": r["url"]}
            for r in results
        ]
    stories = []
    for item in items:
        content = item.get("content") or item  # yfinance >= 0.2.50 nests the story under "content"
        url = (content.get("canonicalUrl") or {}).get("url") or content.get("link")
        stories.append({
            "title": content.get("title"),
            "summary": content.get("summary"),
            "published": content.get("pubDate") or content.get("providerPublishTime"),
            "publisher": (content.get("provider") or {}).get("displayName") or content.get("publisher"),
            "url": url,
        })
    return stories


def history(symbol: str, period: str = "1mo", interval: str = "1d") -> list:
    if period not in HISTORY_PERIODS or interval not in HISTORY_INTERVALS:
        raise ValueError(f"period must be one of {sorted(HISTORY_PERIODS)}, interval one of {sorted(HISTORY_INTERVALS)}.")
    table = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=True)
    if table.empty:
        raise LookupError(f"No price history for {symbol}.")
    return [
        {"date": day.strftime("%Y-%m-%d"), "close": round(float(row["Close"]), 4), "volume": int(row["Volume"])}
        for day, row in table.iterrows()
    ]


def search(query: str, news_only: bool = False, limit: int = 5) -> list:
    from ddgs import DDGS  # only the search endpoints pay for this import

    limit = max(1, min(limit, MAX_RESULTS))
    with DDGS() as ddgs:
        results = ddgs.news(query, max_results=limit) if news_only else ddgs.text(query, max_results=limit)
    if not results:
        raise LookupError(f"No results for {query!r}.")
    return [
        {"title": r.get("title"), "snippet": r.get("body") or r.get("excerpt"), "url": r.get("href") or r.get("url"),
         "date": r.get("date"), "source": r.get("source")}
        for r in results
    ]
