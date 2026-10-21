"""Account placement hints: general Canadian tax rules applied to holdings by account.

Two well-established rules, kept deliberately narrow:

- US dividends paid into a TFSA, FHSA, RESP or RDSP have 15% withheld by the
  US that the account can't recover. US-listed shares held directly in an
  RRSP, RRIF or LIRA are generally exempt under the Canada-US tax treaty, and
  in a non-registered account the tax can usually be claimed as a foreign tax
  credit.
- Eligible Canadian dividends get the dividend tax credit only in a
  non-registered account; in an RRSP or RRIF they are taxed as ordinary
  income on withdrawal.

These are informational, not tax advice.
"""
from dataclasses import dataclass, field

import pandas as pd

TREATY_EXEMPT = {"RRSP", "RRIF", "LIRA"}
NO_US_RELIEF = {"TFSA", "FHSA", "RESP", "RDSP"}
CANADIAN_SUFFIXES = (".TO", ".V", ".NE", ".CN")
US_WITHHOLDING = 0.15
CANADIAN_DIVIDEND_MIN_YIELD = 2.0  # %, below this the credit hardly matters

DISCLAIMER = "General Canadian tax rules, not tax advice. Check contribution room and your own situation before moving anything."


# "an RRSP" but "a TFSA": the article follows how the abbreviation is said.
ARTICLES = {"TFSA": "a", "LIRA": "a"}


def _a(account: str) -> str:
    return f"{ARTICLES.get(account, 'an')} {account}"


@dataclass
class Hint:
    account: str
    title: str
    detail: str
    tickers: list = field(default_factory=list)
    amount: float | None = None  # base currency per year, when the hint has a cost


def _us_listed(position) -> bool:
    return (
        position["Currency"] == "USD"
        and not position["Ticker"].endswith(CANADIAN_SUFFIXES)
        and position["Country"] in ("United States", "Fund (mixed)")
    )


def _canadian_dividend_stock(position) -> bool:
    return position["Ticker"].endswith(CANADIAN_SUFFIXES) and position["Country"] == "Canada"


def _mask(rows: pd.DataFrame, test) -> pd.Series:
    """Boolean Series of test(row); DataFrame.apply returns a frame when rows is empty."""
    return pd.Series([bool(test(r)) for r in rows.to_dict("records")], index=rows.index, dtype=bool)


def placement_hints(figures, dividends) -> list:
    """Hints for the holdings' accounts, given per-position dividend income."""
    if dividends is None or figures.positions.empty or dividends.rows.empty:
        return []
    base = figures.base
    rows = figures.positions[["Ticker", "Account", "Currency", "Country"]].merge(
        dividends.rows[["Ticker", "Account", "Yield %", "Annual income"]], on=["Ticker", "Account"], how="left"
    )
    rows["Annual income"] = rows["Annual income"].fillna(0.0)

    hints = []
    for account, group in rows.groupby("Account", sort=False):
        payers = group[group["Annual income"] > 0]
        if account in NO_US_RELIEF:
            us = payers[_mask(payers, _us_listed)]
            if not us.empty:
                lost = float(us["Annual income"].sum() * US_WITHHOLDING)
                tickers = list(us["Ticker"])
                hints.append(Hint(
                    account=account,
                    title=f"US dividends in your {account} lose 15% to US withholding tax",
                    detail=(
                        f"{', '.join(tickers)} {'pays' if len(tickers) == 1 else 'pay'} US dividends into your "
                        f"{account}. The US keeps 15%, about {lost:,.0f} {base} a year here, and {_a(account)} "
                        "generally can't recover it. US-listed shares held "
                        "in an RRSP or RRIF are generally exempt under the Canada-US tax treaty, and in a "
                        "non-registered account the tax can usually be claimed as a foreign tax credit."
                    ),
                    tickers=tickers,
                    amount=lost,
                ))
        if account in TREATY_EXEMPT:
            canadian = payers[
                _mask(payers, _canadian_dividend_stock) & (payers["Yield %"] >= CANADIAN_DIVIDEND_MIN_YIELD)
            ]
            if not canadian.empty:
                tickers = list(canadian["Ticker"])
                yields = ", ".join(f"{t} {y:.1f}%" for t, y in zip(canadian["Ticker"], canadian["Yield %"]))
                hints.append(Hint(
                    account=account,
                    title=f"Canadian dividends in your {account} miss the dividend tax credit",
                    detail=(
                        f"{yields} yield. In a non-registered account, eligible Canadian dividends get the "
                        f"dividend tax credit; in {_a(account)} they're taxed as ordinary income when withdrawn. "
                        "A TFSA shelters them entirely."
                    ),
                    tickers=tickers,
                ))
    return hints


def account_summary(figures, dividends) -> pd.DataFrame:
    """Per account: holdings, value, cost, P/L, weight and dividend income, largest first."""
    positions = figures.positions
    summary = positions.groupby("Account", sort=False).agg(
        Holdings=("Ticker", "nunique"),
        Value=("Value", "sum"),
        Cost=("Cost", lambda c: c.sum(min_count=1)),
        PL=("P/L", lambda c: c.sum(min_count=1)),
    ).rename(columns={"PL": "P/L"})
    summary["P/L %"] = summary["P/L"] / summary["Cost"] * 100
    summary["Weight %"] = summary["Value"] / figures.total_value * 100 if figures.total_value else 0.0
    if dividends is not None and not dividends.rows.empty:
        summary["Annual income"] = dividends.rows.groupby("Account")["Annual income"].sum().reindex(summary.index).fillna(0.0)
    else:
        summary["Annual income"] = 0.0
    return summary.reset_index().sort_values("Value", ascending=False, ignore_index=True)


def to_markdown(figures, dividends, hints) -> str:
    """Account breakdown and placement hints for the analyst's prompt."""
    base = figures.base
    summary = account_summary(figures, dividends)
    lines = [f"Accounts (in {base}):", ""]
    for r in summary.to_dict("records"):
        pl = "n/a" if pd.isna(r["P/L"]) else f"{r['P/L']:+,.2f} ({r['P/L %']:+.1f}%)"
        lines.append(
            f"- {r['Account']}: {r['Holdings']} holding(s), value {r['Value']:,.2f}, P/L {pl}, "
            f"{r['Weight %']:.1f}% of the portfolio, dividends {r['Annual income']:,.2f}/yr"
        )
    if hints:
        lines += ["", "Account placement hints (general Canadian tax rules, not tax advice):"]
        lines += [f"- {h.title}: {h.detail}" for h in hints]
    return "\n".join(lines)
