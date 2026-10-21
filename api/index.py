"""HTTP API over the portfolio logic, for the Next.js frontend (see docs/migration-plan.md).

Stateless: every request carries the holdings it's about; saved portfolios
live in Neon and are read by Next.js. All routes are under /api/py and,
except /health, /meta and /template.csv, need a Clerk session (clerk_auth.py).

Local: uvicorn api.index:app --reload --port 8000   (docs at /api/py/docs)
"""
import json
import sys
from pathlib import Path
from typing import Literal

# On Vercel this file runs from api/; the logic modules sit one level up.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

load_dotenv()

import account_hints  # noqa: E402
import clerk_auth  # noqa: E402
import portfolio_analytics  # noqa: E402
import portfolio_metrics  # noqa: E402
import portfolio_service  # noqa: E402
import rebalance  # noqa: E402
import research  # noqa: E402
from portfolio_import import ACCOUNT_TYPES, COLUMNS, read_holdings, template_csv  # noqa: E402

ALLOCATION_VIEWS = {
    "Holding": "Ticker", "Account": "Account", "Sector": "Sector", "Country": "Country", "Currency": "Currency",
}
DEFAULT_BENCHMARK = next(iter(portfolio_analytics.BENCHMARKS))
DEFAULT_PERIOD = "1Y"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

Base = Literal["CAD", "USD"]
Benchmark = Literal[tuple(portfolio_analytics.BENCHMARKS)]
Period = Literal[tuple(portfolio_analytics.PERIODS)]
GroupBy = Literal[tuple(rebalance.GROUPINGS)]

app = FastAPI(title="Portfolio by Axiom API", docs_url="/api/py/docs", redoc_url=None, openapi_url="/api/py/openapi.json")


@app.exception_handler(clerk_auth.AuthError)
def _auth_error(request: Request, exc: clerk_auth.AuthError):
    return JSONResponse({"detail": str(exc)}, status_code=exc.status)


def signed_in(request: Request) -> clerk_auth.Caller:
    return clerk_auth.caller(request.headers.get("authorization"), request.cookies.get(clerk_auth.SESSION_COOKIE))


public = APIRouter(prefix="/api/py")
private = APIRouter(prefix="/api/py", dependencies=[Depends(signed_in)])


# ---- JSON shapes -------------------------------------------------------------

def camel(name: str) -> str:
    """'P/L %' -> 'plPct', 'Dividend/share' -> 'dividendPerShare', 'Avg Buy Price' -> 'avgBuyPrice'."""
    words = name.replace("P/L", "PL").replace("%", " Pct").replace("/", " per ").split()
    return "".join(w.lower() if i == 0 else w[:1].upper() + w[1:].lower() for i, w in enumerate(words))


def records(df: pd.DataFrame) -> list:
    """DataFrame rows as dicts with camelCase keys, NaN as null and dates as YYYY-MM-DD."""
    if df is None or df.empty:
        return []
    out = df.rename(columns=camel)
    return json.loads(out.to_json(orient="records", date_format="iso", date_unit="s", double_precision=15))


def number(value):
    return None if value is None or pd.isna(value) else float(value)


def day(value) -> str | None:
    return None if value is None or pd.isna(value) else pd.Timestamp(value).strftime("%Y-%m-%d")


class Holding(BaseModel):
    ticker: str
    shares: float | None = None
    avgBuyPrice: float | None = None
    currency: str | None = None
    account: str | None = None


class PortfolioIn(BaseModel):
    holdings: list[Holding] = Field(max_length=500)
    base: Base = "CAD"


class AnalyticsIn(PortfolioIn):
    benchmark: Benchmark = DEFAULT_BENCHMARK
    period: Period = DEFAULT_PERIOD


class RebalanceOptions(BaseModel):
    groupBy: GroupBy = "Holding"
    scope: str = rebalance.ALL_ACCOUNTS
    cash: float = Field(0.0, ge=0)
    buyOnly: bool = False
    fractional: bool = True
    # Group -> target %. None starts from the current weights (no trades).
    targets: dict[str, float | None] | None = None


class RebalanceIn(PortfolioIn, RebalanceOptions):
    pass


class PromptIn(AnalyticsIn):
    question: str = Field("", max_length=4000)
    rebalance: RebalanceOptions | None = None


def parse(holdings: list[Holding]) -> list:
    rows = [
        {"Ticker": h.ticker, "Shares": h.shares, "Avg Buy Price": h.avgBuyPrice, "Currency": h.currency, "Account": h.account}
        for h in holdings
    ]
    return portfolio_service.parse_portfolio(rows)


def figures_for(body: PortfolioIn):
    holdings = parse(body.holdings)
    if not holdings:
        raise HTTPException(422, "Add at least one holding with a ticker and shares > 0.")
    return holdings, portfolio_service.load_figures(holdings, body.base)


def accounts_of(figures) -> list:
    return [a for a in dict.fromkeys(figures.positions["Account"]) if a != portfolio_metrics.UNSPECIFIED_ACCOUNT]


def figures_json(figures) -> dict:
    return {
        "base": figures.base,
        "totals": {
            "value": figures.total_value,
            "cost": number(figures.total_cost),
            "pl": number(figures.total_pl),
            "plPct": number(figures.total_pl_pct),
            "dayChange": number(figures.day_change),
            "dayChangePct": number(figures.day_change_pct),
        },
        "fx": figures.fx,
        "unpriced": figures.unpriced,
        "positions": records(figures.positions),
        "byTicker": records(figures.by_ticker()) if not figures.positions.empty else [],
        "allocation": {
            view: records(figures.allocation(column)) if not figures.positions.empty else []
            for view, column in ALLOCATION_VIEWS.items()
        },
        "accounts": accounts_of(figures),
    }


def performance_json(p) -> dict | None:
    if p is None:
        return None
    series = p.series.rename_axis("date").reset_index()
    correlation = p.correlation
    return {
        "period": p.period,
        "benchmark": p.benchmark,
        "benchmarkName": portfolio_analytics.BENCHMARKS[p.benchmark][0],
        "start": day(p.start),
        "end": day(p.end),
        "series": records(series),
        "portfolioReturn": number(p.portfolio_return),
        "benchmarkReturn": number(p.benchmark_return),
        "annualizedReturn": number(p.annualized_return),
        "volatility": number(p.volatility),
        "beta": number(p.beta),
        "maxDrawdown": number(p.max_drawdown),
        "drawdownPeak": day(p.drawdown_peak),
        "drawdownTrough": day(p.drawdown_trough),
        "correlation": {
            "tickers": list(correlation.columns),
            "matrix": [[number(v) for v in row] for row in correlation.to_numpy()],
        },
        "excluded": p.excluded,
        "lateStarts": {t: day(d) for t, d in p.late_starts.items()},
    }


def dividends_json(d) -> dict:
    return {
        "base": d.base,
        "rows": records(d.rows),
        "byTicker": records(d.by_ticker()),
        "totalIncome": number(d.total_income),
        "portfolioYield": number(d.portfolio_yield),
    }


def hints_json(hints) -> list:
    return [
        {"account": h.account, "title": h.title, "detail": h.detail, "tickers": h.tickers, "amount": number(h.amount)}
        for h in hints
    ]


def analytics_for(figures, benchmark: str, period: str):
    history = portfolio_service.load_history(figures)
    performance = portfolio_analytics.compute_performance(figures, history, benchmark, period)
    dividends = portfolio_analytics.compute_dividends(figures, history)
    hints = account_hints.placement_hints(figures, dividends)
    return performance, dividends, hints


def plan_for(figures, options):
    """(current weights, Plan, unknown tickers) for the rebalance options."""
    if options.scope != rebalance.ALL_ACCOUNTS and options.scope not in accounts_of(figures):
        raise HTTPException(422, f"No holdings in account {options.scope!r}.")
    rows = portfolio_service.rebalance_rows(figures, options.groupBy, options.scope)
    exact = portfolio_service.current_weights(rows)
    if options.targets is None:  # start from the current weights, like the Streamlit targets table
        targets = exact.to_dict()
    else:
        targets = {}
        for group, target in options.targets.items():
            group = group.strip().upper() if options.groupBy == "Holding" else group.strip()
            if group:
                targets[group] = 0.0 if target is None else float(target)
    targets = portfolio_service.resolve_targets(targets, exact)
    unknown = []
    if options.groupBy == "Holding":
        new = [t for t in targets if t not in set(rows["Group"]) and targets[t] > 0]
        rows, unknown = portfolio_service.new_holding_rows(rows, new, figures.base)
    p = rebalance.plan(
        rows, targets, options.cash, options.buyOnly, options.fractional, figures.base, options.groupBy, options.scope
    )
    return exact, p, unknown


def plan_json(p) -> dict:
    return {
        "groupBy": p.group_by,
        "scope": p.scope,
        "hasTrades": p.has_trades,
        "trades": records(p.trades),
        "groups": records(p.groups),
        "cashAdded": number(p.cash_added),
        "cashLeft": number(p.cash_left),
        "totalBuys": number(p.total_buys),
        "totalSells": number(p.total_sells),
        "targetsScaledFrom": number(p.targets_scaled_from),
        "realizedGain": number(p.realized_gain),
    }


# ---- Routes ------------------------------------------------------------------

@public.get("/health")
def health():
    return {"ok": True}


@public.get("/meta")
def meta():
    return {
        "columns": [camel(c) for c in COLUMNS],
        "accountTypes": ACCOUNT_TYPES,
        "baseCurrencies": list(portfolio_metrics.BASE_CURRENCIES),
        "benchmarks": [
            {"symbol": s, "name": name, "currency": currency}
            for s, (name, currency) in portfolio_analytics.BENCHMARKS.items()
        ],
        "periods": list(portfolio_analytics.PERIODS),
        "defaultBenchmark": DEFAULT_BENCHMARK,
        "defaultPeriod": DEFAULT_PERIOD,
        "groupings": list(rebalance.GROUPINGS),
        "allAccounts": rebalance.ALL_ACCOUNTS,
        "allocationViews": list(ALLOCATION_VIEWS),
        "disclaimer": account_hints.DISCLAIMER,
    }


@public.get("/template.csv")
def template():
    return Response(
        template_csv(), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="portfolio-template.csv"'},
    )


@private.post("/figures")
def figures(body: PortfolioIn):
    """Live quotes valued in the base currency: totals, positions and allocations."""
    _, f = figures_for(body)
    return figures_json(f)


@private.post("/analytics")
def analytics(body: AnalyticsIn):
    """Backtest, risk, dividends, per-account summary and placement hints."""
    _, f = figures_for(body)
    if f.positions.empty:
        return {"performance": None, "dividends": None, "hints": [], "accountSummary": []}
    performance, dividends, hints = analytics_for(f, body.benchmark, body.period)
    return {
        "performance": performance_json(performance),
        "dividends": dividends_json(dividends),
        "hints": hints_json(hints),
        "accountSummary": records(account_hints.account_summary(f, dividends)),
    }


@private.post("/rebalance")
def rebalance_plan(body: RebalanceIn):
    """Current weights per group and the trades that reach the targets."""
    _, f = figures_for(body)
    if f.positions.empty:
        raise HTTPException(422, "None of the holdings has a live price.")
    exact, p, unknown = plan_for(f, body)
    return {
        "current": [{"group": g, "currentPct": round(w, 1), "exactPct": w} for g, w in exact.items()],
        "accounts": accounts_of(f),
        "unknown": unknown,
        "plan": plan_json(p),
    }


@private.post("/prompt")
def prompt(body: PromptIn):
    """The analyst's first message: the holdings plus every computed figure, as Markdown."""
    holdings, f = figures_for(body)
    performance = dividends = plan = None
    hints = []
    if not f.positions.empty:
        performance, dividends, hints = analytics_for(f, body.benchmark, body.period)
        if body.rebalance is not None:
            _, p, _ = plan_for(f, body.rebalance)
            plan = p if p.has_trades else None
    return {"prompt": portfolio_service.format_prompt(holdings, body.question, f, performance, dividends, hints, plan)}


@private.post("/import")
async def import_file(file: UploadFile = File(...)):
    """Holdings from a broker's CSV or Excel export."""
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "The file is larger than 5 MB.")
    try:
        table, warnings = read_holdings(file.filename or "", data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"holdings": records(table), "warnings": warnings}


def _lookup(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@private.get("/research/price")
def research_price(symbol: str):
    return _lookup(research.price, symbol.upper())


@private.get("/research/fundamentals")
def research_fundamentals(symbol: str):
    return _lookup(research.fundamentals, symbol.upper())


@private.get("/research/recommendations")
def research_recommendations(symbol: str):
    return _lookup(research.recommendations, symbol.upper())


@private.get("/research/news")
def research_news(symbol: str, limit: int = 5):
    return _lookup(research.news, symbol.upper(), limit)


@private.get("/research/history")
def research_history(symbol: str, period: str = "1mo", interval: str = "1d"):
    return _lookup(research.history, symbol.upper(), period, interval)


@private.get("/research/search")
def research_search(q: str = Query(..., max_length=300), news: bool = False, limit: int = 5):
    return _lookup(research.search, q, news, limit)


app.include_router(public)
app.include_router(private)
