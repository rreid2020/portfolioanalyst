"""Rebalancing calculator: trades that move holdings toward target weights.

Informational only; nothing here places orders. Targets are set per group
(a holding, sector or currency). A full rebalance buys and sells so each
group lands on its target after adding new cash. Buy-only never sells: the
new cash goes to the most underweight groups first ("water-filling"), so it
narrows the gaps as far as the cash allows. Within a group, trades are split
across its holdings in proportion to their current value.
"""
import math
from dataclasses import dataclass

import pandas as pd

GROUPINGS = {"Holding": "Ticker", "Sector": "Sector", "Currency": "Currency"}
ALL_ACCOUNTS = "All accounts"
FRACTION_DIGITS = 4  # share precision for fractional trading
MIN_TRADE = 1.0  # base currency; smaller trades are dropped as dust

TRADE_COLUMNS = ["Ticker", "Account", "Action", "Shares", "Price", "Currency", "Amount", "Current %", "After %"]
GROUP_COLUMNS = ["Group", "Current %", "Target %", "After %", "Change"]


@dataclass
class Plan:
    base: str
    group_by: str
    scope: str
    trades: pd.DataFrame  # TRADE_COLUMNS; Amount in base, signed (+ buy, - sell)
    groups: pd.DataFrame  # GROUP_COLUMNS; Change in base
    cash_added: float
    cash_left: float
    total_buys: float
    total_sells: float
    targets_scaled_from: float | None  # sum of entered targets when it wasn't 100
    realized_gain: float | None  # estimated, non-registered sells only

    @property
    def has_trades(self) -> bool:
        return not self.trades.empty


def universe(positions: pd.DataFrame, group_col: str) -> pd.DataFrame:
    """Rows to rebalance: Ticker, Account, Group, Shares, Price, Currency, FX, Value, Gain ratio."""
    rows = positions.copy()
    rows["Group"] = rows[group_col]
    rows["FX"] = rows["Value"] / (rows["Shares"] * rows["Price"])
    rows["Gain ratio"] = rows["P/L"] / rows["Value"]
    return rows[["Ticker", "Account", "Group", "Shares", "Price", "Currency", "FX", "Value", "Gain ratio"]].reset_index(drop=True)


def add_holding(rows: pd.DataFrame, ticker: str, price: float, currency: str, fx: float) -> pd.DataFrame:
    """A holding not yet owned, so a target can be set for it (holding grouping)."""
    new = pd.DataFrame([{
        "Ticker": ticker, "Account": "", "Group": ticker, "Shares": 0.0, "Price": price,
        "Currency": currency, "FX": fx, "Value": 0.0, "Gain ratio": float("nan"),
    }])
    return pd.concat([rows, new], ignore_index=True)


def _water_fill(values: pd.Series, weights: pd.Series, cash: float) -> pd.Series:
    """Buy amounts per group that spend `cash` lifting the most underweight groups first."""
    if cash <= 0:
        return values * 0.0
    total = values.sum() + cash

    def spent(level):
        return (weights * level - values).clip(lower=0).sum()

    low, high = 0.0, total
    for _ in range(100):
        mid = (low + high) / 2
        if spent(mid) < cash:
            low = mid
        else:
            high = mid
    buys = (weights * high - values).clip(lower=0)
    # Scale away the bisection's last bit of overshoot.
    return buys * (cash / buys.sum()) if buys.sum() > 0 else buys


def _round_shares(raw: float, held: float, fractional: bool, selling_all: bool) -> float:
    if selling_all:
        return -held
    if raw >= 0:  # buy: never round up past the cash
        factor = 10 ** FRACTION_DIGITS if fractional else 1
        return math.floor(raw * factor + 1e-9) / factor
    shares = round(raw, FRACTION_DIGITS) if fractional else float(round(raw))
    return max(shares, -held)


def plan(
    rows: pd.DataFrame, targets: dict, cash: float, buy_only: bool, fractional: bool,
    base: str, group_by: str, scope: str = ALL_ACCOUNTS,
) -> Plan:
    """Trades for `rows` (see universe) to reach `targets` (group -> %).

    Groups missing from `targets` keep their current value. Targets that don't
    add up to 100 are scaled to 100.
    """
    rows = rows.copy()
    values = rows.groupby("Group", sort=False)["Value"].sum()
    current_total = float(values.sum())
    targets = {g: max(float(t), 0.0) for g, t in targets.items() if g in values.index and pd.notna(t)}
    entered = sum(targets.values())
    untargeted = [g for g in values.index if g not in targets]
    # Untargeted groups hold still: their share of the end total is fixed by their value.
    end_total = current_total + max(cash, 0.0)
    fixed = values[untargeted].sum() / end_total * 100 if end_total else 0.0
    room = max(100.0 - fixed, 0.0)
    scaled_from = None
    if targets and abs(entered - room) > 0.05:
        scaled_from = entered + fixed
        targets = {g: t / entered * room for g, t in targets.items()} if entered else targets
    weights = pd.Series({g: targets.get(g, values[g] / end_total * 100 if end_total else 0) for g in values.index}) / 100

    if buy_only:
        group_trades = _water_fill(values, weights, cash)
    else:
        group_trades = weights * end_total - values
    group_trades[untargeted] = 0.0

    # Split each group's trade across its holdings by current value (equally if none held).
    shares = []
    for row in rows.itertuples(index=False):
        members = rows[rows["Group"] == row.Group]
        share_of_group = row.Value / values[row.Group] if values[row.Group] else 1 / len(members)
        amount = group_trades[row.Group] * share_of_group
        per_share = row.Price * row.FX
        raw = amount / per_share if per_share else 0.0
        selling_all = not buy_only and targets.get(row.Group, None) == 0 and row.Shares > 0
        shares.append(_round_shares(raw, row.Shares, fractional, selling_all) if per_share else 0.0)
    rows["Trade shares"] = shares
    rows["Amount"] = rows["Trade shares"] * rows["Price"] * rows["FX"]
    dust = rows["Amount"].abs() < MIN_TRADE
    rows.loc[dust, ["Trade shares", "Amount"]] = 0.0

    # Rounded sells can raise less than the buys assumed: trim buys until the cash covers them.
    step = 10 ** -FRACTION_DIGITS if fractional else 1.0
    cash_left = cash - rows["Amount"].sum()
    while cash_left < -1e-6:
        buys = rows[rows["Trade shares"] > 0]
        if buys.empty:
            break
        i = buys["Amount"].idxmax()
        if fractional:
            cut = math.ceil(-cash_left / (rows.at[i, "Price"] * rows.at[i, "FX"]) / step) * step
            rows.at[i, "Trade shares"] = max(rows.at[i, "Trade shares"] - cut, 0.0)
        else:
            rows.at[i, "Trade shares"] -= step
        rows.at[i, "Amount"] = rows.at[i, "Trade shares"] * rows.at[i, "Price"] * rows.at[i, "FX"]
        cash_left = cash - rows["Amount"].sum()

    rows["After value"] = rows["Value"] + rows["Amount"]
    invested = rows["After value"].sum()
    rows["Current %"] = rows["Value"] / current_total * 100 if current_total else 0.0
    rows["After %"] = rows["After value"] / invested * 100 if invested else 0.0

    trades = rows[rows["Trade shares"].abs() > 1e-9].copy()
    trades["Action"] = trades["Trade shares"].map(lambda s: "Buy" if s > 0 else "Sell")
    trades["Shares"] = trades["Trade shares"].abs()
    trades = trades.sort_values(["Action", "Amount"], ascending=[False, False], key=lambda c: c.abs() if c.name == "Amount" else c)
    trades = trades[TRADE_COLUMNS].reset_index(drop=True)

    after = rows.groupby("Group", sort=False)["After value"].sum()
    groups = pd.DataFrame({
        "Group": values.index,
        "Current %": (values / current_total * 100).values if current_total else 0.0,
        "Target %": [targets.get(g, float("nan")) for g in values.index],
        "After %": (after / invested * 100).reindex(values.index).values if invested else 0.0,
        "Change": (after - values).reindex(values.index).values,
    })

    sells = rows[rows["Amount"] < 0]
    gain = None
    taxable = sells[sells["Account"] == "Non-registered"]
    if not taxable.empty:
        gains = (-taxable["Amount"] * taxable["Gain ratio"]).dropna()
        gain = float(gains[gains > 0].sum()) if not gains.empty else None

    return Plan(
        base=base,
        group_by=group_by,
        scope=scope,
        trades=trades,
        groups=groups.sort_values("Current %", ascending=False, ignore_index=True),
        cash_added=cash,
        cash_left=float(cash_left) + 0.0,
        total_buys=float(rows.loc[rows["Amount"] > 0, "Amount"].sum()),
        total_sells=float(-sells["Amount"].sum()) + 0.0,  # + 0.0 turns -0.0 into 0.0
        targets_scaled_from=scaled_from,
        realized_gain=gain or None,
    )


def to_markdown(p: Plan) -> str:
    """The proposed trades for the analyst's prompt."""
    mode = f"{p.group_by.lower()} targets, {p.scope.lower()}"
    lines = [
        f"Proposed rebalance ({mode}, in {p.base}; informational, no orders placed):",
        "",
        f"- New cash {p.cash_added:,.2f}; buys {p.total_buys:,.2f}; sells {p.total_sells:,.2f}; cash left {p.cash_left:,.2f}",
    ]
    if p.realized_gain:
        lines.append(f"- Estimated capital gain realized in non-registered accounts: {p.realized_gain:,.2f}")
    lines.append("- Targets: " + ", ".join(
        f"{g['Group']} {g['Current %']:.1f}% -> {g['After %']:.1f}% (target {g['Target %']:.1f}%)"
        for g in p.groups.to_dict("records") if pd.notna(g["Target %"])
    ))
    for t in p.trades.to_dict("records"):
        lines.append(f"- {t['Action']} {t['Shares']:g} {t['Ticker']}"
                     + (f" in {t['Account']}" if t["Account"] else "") + f" (~{abs(t['Amount']):,.2f})")
    return "\n".join(lines)
