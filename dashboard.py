"""Live portfolio dashboard: summary tiles, allocation, P/L, performance, risk and dividends."""
import altair as alt
import pandas as pd
import streamlit as st

import account_hints
import portfolio_analytics
import portfolio_metrics
import rebalance

# Validated with the dataviz palette checker: both clear the chroma floor and
# stay apart under every colour-vision deficiency (worst ΔE 17).
GAIN = "#008C99"  # brand teal, nudged for chart legibility
LOSS = "#C2571A"
INK_MUTED = "#475569"
GRID = "#E5E9EF"
BENCHMARK_GRAY = "#94A3B8"  # context series in emphasis charts
NEUTRAL = "#EEF1F4"  # diverging midpoint

MAX_BARS = 12  # longer lists fold their tail into "Other"

ALLOCATION_VIEWS = {
    "Holding": "Ticker", "Account": "Account", "Sector": "Sector", "Country": "Country", "Currency": "Currency",
}


@st.cache_data(ttl=300, show_spinner=False)
def _quotes(tickers: tuple) -> dict:
    return portfolio_metrics.fetch_quotes(tickers)


@st.cache_data(ttl=300, show_spinner=False)
def _fx(currencies: tuple, base: str) -> dict:
    return portfolio_metrics.fetch_fx(currencies, base)


@st.cache_data(ttl=3600, show_spinner=False)
def _history(symbols: tuple):
    return portfolio_analytics.fetch_history(symbols)


def load_figures(holdings, base: str):
    """Figures for the holdings from quotes cached for 5 minutes, or None without holdings."""
    if not holdings:
        return None
    quotes = _quotes(tuple(sorted({h["ticker"] for h in holdings})))
    currencies = portfolio_metrics.needed_currencies(holdings, quotes) | {base}
    fx = _fx(tuple(sorted(currencies)), base)
    return portfolio_metrics.compute(holdings, quotes, fx, base)


def _money(value, signed=False):
    if value is None or pd.isna(value):
        return "—"
    return f"{value:+,.0f}" if signed else f"{value:,.0f}"


def _pct(value):
    return None if value is None or pd.isna(value) else f"{value:+.2f}%"


def _fold(df: pd.DataFrame) -> pd.DataFrame:
    if len(df) <= MAX_BARS:
        return df
    head, tail = df.iloc[: MAX_BARS - 1], df.iloc[MAX_BARS - 1:]
    other = pd.DataFrame([{"Group": f"Other ({len(tail)})", "Value": tail["Value"].sum(), "Weight %": tail["Weight %"].sum()}])
    return pd.concat([head, other], ignore_index=True)


def _axis_config(chart):
    chart = chart.properties(padding={"left": 4, "right": 12, "top": 4, "bottom": 4}).configure(
        autosize=alt.AutoSizeParams(type="fit-x", contains="padding")
    )
    return chart.configure_view(stroke=None).configure_axis(
        labelColor=INK_MUTED, titleColor=INK_MUTED, labelFontSize=12, domain=False, ticks=False, gridColor=GRID
    )


def allocation_chart(allocation: pd.DataFrame, base: str):
    """Horizontal weight bars, largest first. Returns (chart, height in px)."""
    data = _fold(allocation).assign(Label=lambda d: d["Weight %"].map(lambda w: f"{w:.1f}%"))
    y = alt.Y("Group:N", sort=None, title=None, axis=alt.Axis(labelLimit=180, labelOverlap=False))
    tooltip = [
        alt.Tooltip("Group:N", title="Group"),
        alt.Tooltip("Value:Q", title=f"Value ({base})", format=",.2f"),
        alt.Tooltip("Weight %:Q", title="Weight", format=".1f"),
    ]
    bars = alt.Chart(data).mark_bar(color=GAIN, cornerRadiusEnd=4, height=alt.RelativeBandSize(0.6)).encode(
        x=alt.X(
            "Weight %:Q", title="Weight (%)", axis=alt.Axis(grid=True, tickCount=5),
            scale=alt.Scale(domain=[0, data["Weight %"].max() * 1.15], nice=False),
        ),
        y=y,
        tooltip=tooltip,
    )
    labels = alt.Chart(data).mark_text(align="left", dx=6, color=INK_MUTED, fontSize=12).encode(
        x="Weight %:Q", y=y, text="Label:N", tooltip=tooltip
    )
    return _axis_config(bars + labels), 34 * len(data) + 70


def _padded_domain(values: pd.Series):
    """Domain including zero, with room past each end for the value labels."""
    low, high = min(values.min(), 0), max(values.max(), 0)
    pad = (high - low) * 0.18 or 1
    return [low - pad if low < 0 else 0, high + pad if high > 0 else 0]


def pl_chart(positions: pd.DataFrame, base: str):
    """Unrealized P/L bars, gains teal and losses orange. Returns (chart, height in px)."""
    data = positions.dropna(subset=["P/L"]).sort_values("P/L", ascending=False)
    data = data.assign(
        Direction=lambda d: d["P/L"].map(lambda v: "Gain" if v >= 0 else "Loss"),
        Label=lambda d: d["P/L %"].map(lambda p: "" if pd.isna(p) else f"{p:+.1f}%"),
    )
    y = alt.Y("Ticker:N", sort=None, title=None, axis=alt.Axis(labelOverlap=False))
    tooltip = [
        alt.Tooltip("Ticker:N"),
        alt.Tooltip("P/L:Q", title=f"P/L ({base})", format="+,.2f"),
        alt.Tooltip("P/L %:Q", title="P/L %", format="+.2f"),
        alt.Tooltip("Value:Q", title=f"Value ({base})", format=",.2f"),
    ]
    bars = alt.Chart(data).mark_bar(cornerRadiusEnd=4, height=alt.RelativeBandSize(0.6)).encode(
        x=alt.X(
            "P/L:Q", title=f"Unrealized P/L ({base})", axis=alt.Axis(grid=True, tickCount=5, format="~s"),
            scale=alt.Scale(domain=_padded_domain(data["P/L"]), nice=False),
        ),
        y=y,
        color=alt.Color(
            "Direction:N",
            scale=alt.Scale(domain=["Gain", "Loss"], range=[GAIN, LOSS]),
            legend=alt.Legend(title=None, orient="top"),
        ),
        tooltip=tooltip,
    )
    zero = alt.Chart(pd.DataFrame({"x": [0]})).mark_rule(color=INK_MUTED, strokeWidth=1).encode(x="x:Q")
    # Labels sit past the bar end, on whichever side of zero the bar points.
    gain_labels = alt.Chart(data[data["P/L"] >= 0]).mark_text(align="left", dx=6, color=INK_MUTED, fontSize=12).encode(
        x="P/L:Q", y=y, text="Label:N", tooltip=tooltip
    )
    loss_labels = alt.Chart(data[data["P/L"] < 0]).mark_text(align="right", dx=-6, color=INK_MUTED, fontSize=12).encode(
        x="P/L:Q", y=y, text="Label:N", tooltip=tooltip
    )
    layers = bars + zero + gain_labels + loss_labels
    return _axis_config(layers), 34 * len(data) + 110


def performance_chart(performance):
    """Portfolio vs benchmark, indexed to 100, with a hover crosshair. Returns (chart, height)."""
    name = portfolio_analytics.BENCHMARKS[performance.benchmark][0]
    wide = performance.series.rename(columns={"Portfolio": "Your holdings", "Benchmark": name}).reset_index(names="Date")
    data = wide.melt("Date", var_name="Series", value_name="Index")
    series = [c for c in ["Your holdings", name] if c in wide.columns]
    color = alt.Color(
        "Series:N",
        scale=alt.Scale(domain=series, range=[GAIN, BENCHMARK_GRAY][: len(series)]),
        legend=alt.Legend(title=None, orient="top", labelLimit=320),
    )
    x = alt.X("Date:T", title=None, axis=alt.Axis(grid=False, format="%b %Y", labelAngle=0, tickCount=6))
    y = alt.Y("Index:Q", title="Growth of 100", scale=alt.Scale(zero=False), axis=alt.Axis(tickCount=5))
    lines = alt.Chart(data).mark_line(strokeWidth=2).encode(x=x, y=y, color=color)

    hover = alt.selection_point(fields=["Date"], nearest=True, on="pointerover", empty=False, clear="pointerout")
    tooltip = [alt.Tooltip("Date:T", format="%Y-%m-%d")] + [alt.Tooltip(f"{s}:Q", format=".1f") for s in series]
    rule = alt.Chart(wide).mark_rule(color=INK_MUTED, strokeWidth=1).encode(
        x="Date:T", opacity=alt.condition(hover, alt.value(0.6), alt.value(0)), tooltip=tooltip
    ).add_params(hover)
    points = lines.mark_point(filled=True, size=70, stroke="#fff", strokeWidth=2).encode(
        opacity=alt.condition(hover, alt.value(1), alt.value(0))
    ).transform_filter(hover)
    last = data.sort_values("Date").groupby("Series").tail(1)
    end_labels = alt.Chart(last).mark_text(align="left", dx=6, fontSize=12, color=INK_MUTED).encode(
        x="Date:T", y="Index:Q", text=alt.Text("Index:Q", format=".0f")
    )
    return _axis_config(lines + rule + points + end_labels), 320


def correlation_chart(correlation: pd.DataFrame):
    """Heatmap of daily-return correlations, teal positive and orange negative. Returns (chart, height)."""
    order = list(correlation.columns)
    data = correlation.rename_axis("A").reset_index().melt("A", var_name="B", value_name="Correlation")
    cells_base = alt.Chart(data).encode(
        x=alt.X("B:N", sort=order, title=None, axis=alt.Axis(labelAngle=0, orient="top", labelOverlap=False)),
        y=alt.Y("A:N", sort=order, title=None, axis=alt.Axis(labelOverlap=False)),
    )
    cells = cells_base.mark_rect(stroke="#fff", strokeWidth=2, cornerRadius=3).encode(
        color=alt.Color(
            "Correlation:Q",
            scale=alt.Scale(domain=[-1, 0, 1], range=[LOSS, NEUTRAL, GAIN], interpolate="lab"),
            legend=alt.Legend(title="Correlation", orient="right", gradientLength=140),
        ),
        tooltip=[
            alt.Tooltip("A:N", title="Holding"),
            alt.Tooltip("B:N", title="With"),
            alt.Tooltip("Correlation:Q", format=".2f"),
        ],
    )
    text = cells_base.mark_text(fontSize=11).encode(
        text=alt.Text("Correlation:Q", format=".2f"),
        color=alt.condition("abs(datum.Correlation) > 0.6", alt.value("#fff"), alt.value("#0F172A")),
    )
    return _axis_config(cells + text), 40 * len(order) + 50


def income_chart(rows: pd.DataFrame, base: str):
    """Expected annual dividend income per holding, largest first. Returns (chart, height)."""
    data = rows[rows["Annual income"] > 0].head(MAX_BARS).assign(
        Label=lambda d: d["Annual income"].map(lambda v: f"{v:,.0f}")
    )
    y = alt.Y("Ticker:N", sort=None, title=None, axis=alt.Axis(labelOverlap=False))
    tooltip = [
        alt.Tooltip("Ticker:N"),
        alt.Tooltip("Annual income:Q", title=f"Income ({base}/yr)", format=",.2f"),
        alt.Tooltip("Yield %:Q", title="Yield %", format=".2f"),
    ]
    bars = alt.Chart(data).mark_bar(color=GAIN, cornerRadiusEnd=4, height=alt.RelativeBandSize(0.6)).encode(
        x=alt.X(
            "Annual income:Q", title=f"Expected income ({base} per year)", axis=alt.Axis(grid=True, tickCount=5),
            scale=alt.Scale(domain=[0, data["Annual income"].max() * 1.15], nice=False),
        ),
        y=y,
        tooltip=tooltip,
    )
    labels = alt.Chart(data).mark_text(align="left", dx=6, color=INK_MUTED, fontSize=12).encode(
        x="Annual income:Q", y=y, text="Label:N", tooltip=tooltip
    )
    return _axis_config(bars + labels), 34 * len(data) + 70


def _signed_pct(value):
    return "—" if value is None or pd.isna(value) else f"{value:+.1f}%"


def performance_tab(figures, history):
    """Period and benchmark pickers, risk tiles, growth chart, correlations. Returns the Performance."""
    controls = st.columns([3, 2])
    period = controls[0].segmented_control(
        "Period", list(portfolio_analytics.PERIODS), default="1Y", key="performance_period"
    ) or "1Y"
    benchmark = controls[1].selectbox(
        "Benchmark",
        list(portfolio_analytics.BENCHMARKS),
        format_func=lambda symbol: portfolio_analytics.BENCHMARKS[symbol][0],
        key="performance_benchmark",
    )
    performance = portfolio_analytics.compute_performance(figures, history, benchmark, period)
    if performance is None:
        st.info("Not enough price history for these holdings yet.")
        return None

    name = portfolio_analytics.BENCHMARKS[benchmark][0]
    vs = None
    if performance.benchmark_return is not None:
        vs = f"{performance.portfolio_return - performance.benchmark_return:+.1f} pts vs {benchmark.split('.')[0]}"
    return_help = f"Benchmark {name}: {_signed_pct(performance.benchmark_return)}."
    if performance.annualized_return is not None:
        return_help += f" Annualized: {_signed_pct(performance.annualized_return)}."
    tiles = st.columns(4)
    tiles[0].metric(f"Return ({period})", _signed_pct(performance.portfolio_return), vs, border=True, help=return_help)
    tiles[1].metric(
        "Volatility", "—" if performance.volatility is None else f"{performance.volatility:.1f}%", border=True,
        help="Annualized standard deviation of daily returns.",
    )
    tiles[2].metric(
        "Beta", "—" if performance.beta is None else f"{performance.beta:.2f}", border=True,
        help=f"Sensitivity to {name}: 1.0 moves with it, above 1 swings more.",
    )
    tiles[3].metric(
        "Max drawdown", f"{performance.max_drawdown:.1f}%", border=True,
        help=f"Largest fall from a peak: {performance.drawdown_peak:%Y-%m-%d} to {performance.drawdown_trough:%Y-%m-%d}.",
    )

    note = (
        f"Backtest of today's holdings from {performance.start:%b %d, %Y}: current share counts valued each day "
        f"in {figures.base} with dividends reinvested. It shows how this mix would have done, not your actual returns."
    )
    if performance.late_starts:
        note += " Starts later than the period because " + ", ".join(
            f"{t} has prices only from {d:%b %Y}" for t, d in performance.late_starts.items()
        ) + "."
    if performance.excluded:
        note += f" No price history for {', '.join(performance.excluded)}."
    st.caption(note)
    chart, height = performance_chart(performance)
    st.altair_chart(chart, width="stretch", height=height)

    if not performance.correlation.empty:
        st.markdown("**How your holdings move together**")
        caption = (
            "Correlation of daily returns over the period. Near 1, two holdings rise and fall together; "
            "near 0 or below, they diversify each other."
        )
        if len(figures.positions) > portfolio_analytics.MAX_CORRELATION_HOLDINGS:
            caption += f" Largest {portfolio_analytics.MAX_CORRELATION_HOLDINGS} holdings shown."
        st.caption(caption)
        chart, height = correlation_chart(performance.correlation)
        st.altair_chart(chart, width="stretch", height=height)
    return performance


def accounts_tab(figures, dividends, hints):
    """Value per account, account table, and placement hints."""
    base = figures.base
    if set(figures.positions["Account"]) == {portfolio_metrics.UNSPECIFIED_ACCOUNT}:
        st.info(
            "Set the Account column (TFSA, RRSP, FHSA, Non-registered...) in the holdings table to see "
            "per-account totals and placement hints. CSV imports and brokerage connections fill it in."
        )
        return
    chart, height = allocation_chart(figures.allocation("Account"), base)
    st.altair_chart(chart, width="stretch", height=height)
    st.dataframe(
        account_hints.account_summary(figures, dividends),
        hide_index=True,
        width="stretch",
        column_config={
            "Value": st.column_config.NumberColumn(f"Value ({base})", format="accounting"),
            "Cost": st.column_config.NumberColumn(f"Cost ({base})", format="accounting"),
            "P/L": st.column_config.NumberColumn(f"P/L ({base})", format="accounting"),
            "P/L %": st.column_config.NumberColumn(format="%+.2f%%"),
            "Weight %": st.column_config.NumberColumn(format="%.1f%%"),
            "Annual income": st.column_config.NumberColumn(f"Dividends ({base}/yr)", format="accounting"),
        },
    )
    st.markdown("**Account placement hints**")
    if hints:
        for hint in hints:
            with st.container(border=True):
                st.markdown(f":material/lightbulb: **{hint.title}**")
                st.caption(hint.detail)
    else:
        st.caption("Nothing stands out: no US dividends in a TFSA, FHSA or RESP, and no high-yield Canadian dividend stocks in an RRSP.")
    st.caption(account_hints.DISCLAIMER)


def dividends_tab(figures, dividends):
    """Income tiles, income chart and table."""
    base = figures.base
    tiles = st.columns(2)
    tiles[0].metric(f"Expected annual income ({base})", f"{dividends.total_income:,.0f}", border=True)
    tiles[1].metric(
        "Portfolio yield",
        "—" if dividends.portfolio_yield is None else f"{dividends.portfolio_yield:.2f}%",
        border=True,
        help="Expected annual income as a share of market value.",
    )
    st.caption(
        "Based on dividends paid over the past 12 months, at today's share counts and exchange rates. "
        "Future payments can differ."
    )
    if (dividends.rows["Annual income"] > 0).any():
        chart, height = income_chart(dividends.by_ticker(), base)
        st.altair_chart(chart, width="stretch", height=height)
        st.dataframe(
            dividends.rows,
            hide_index=True,
            width="stretch",
            column_config={
                "Dividend/share": st.column_config.NumberColumn(format="%.4f", help="Past 12 months, listing currency"),
                "Yield %": st.column_config.NumberColumn(format="%.2f%%"),
                "Annual income": st.column_config.NumberColumn(f"Annual income ({base})", format="accounting"),
            },
        )
    else:
        st.info("None of these holdings paid a dividend in the past 12 months.")


def _new_holding_rows(rows, wanted, base):
    """Add holdings typed into the targets table that aren't owned yet. Returns (rows, unknown)."""
    unknown = []
    for ticker in wanted:
        quote = _quotes((ticker,)).get(ticker)
        if quote is None:
            unknown.append(ticker)
            continue
        price, currency = portfolio_metrics.normalize(quote.price, quote.currency)
        fx = _fx(tuple(sorted({currency, base})), base).get(currency)
        if fx is None:
            unknown.append(ticker)
            continue
        rows = rebalance.add_holding(rows, ticker, price, currency, fx)
    return rows, unknown


def rebalance_tab(figures):
    """Targets editor and the trades that reach them. Returns the Plan when it has trades."""
    base = figures.base
    accounts = [a for a in dict.fromkeys(figures.positions["Account"]) if a != portfolio_metrics.UNSPECIFIED_ACCOUNT]
    controls = st.columns([3, 2, 2])
    group_by = controls[0].segmented_control(
        "Set targets by", list(rebalance.GROUPINGS), default="Holding", key="rebalance_group"
    ) or "Holding"
    scope = controls[1].selectbox(
        "Account",
        [rebalance.ALL_ACCOUNTS, *accounts],
        key="rebalance_scope",
        help="Pick one account to get trades you can place with that account's cash.",
    )
    cash = controls[2].number_input(f"New cash ({base})", min_value=0.0, value=0.0, step=100.0, key="rebalance_cash")
    toggles = st.container(horizontal=True)
    buy_only = toggles.toggle("Buy only (no selling)", key="rebalance_buy_only",
                              help="Spend the new cash on the most underweight positions first. Nothing is sold.")
    fractional = toggles.toggle("Fractional shares", value=True, key="rebalance_fractional",
                                help="Wealthsimple and some other brokers trade fractions of a share.")

    if scope == rebalance.ALL_ACCOUNTS:
        positions = figures.by_ticker()
    else:
        positions = figures.positions[figures.positions["Account"] == scope]
    rows = rebalance.universe(positions, rebalance.GROUPINGS[group_by])
    current = rows.groupby("Group", sort=False)["Value"].sum()
    exact = current / current.sum() * 100
    weights = exact.round(1)
    table = pd.DataFrame({"Group": weights.index, "Current %": weights.values, "Target %": weights.values})

    st.caption(
        "Targets start at your current weights. Change them"
        + (", or add a row for a holding you don't own yet" if group_by == "Holding" else "")
        + "; they're scaled to 100% if they don't add up."
    )
    edited = st.data_editor(
        table,
        key=f"rebalance_targets_{group_by}_{scope}",
        hide_index=True,
        width="stretch",
        num_rows="dynamic" if group_by == "Holding" else "fixed",
        disabled=["Current %"],
        column_config={
            "Group": st.column_config.TextColumn("Ticker" if group_by == "Holding" else group_by, required=True),
            "Current %": st.column_config.NumberColumn(format="%.1f"),
            "Target %": st.column_config.NumberColumn(min_value=0.0, max_value=100.0, step=0.5, format="%.1f"),
        },
    )
    edited = edited.dropna(subset=["Group"])
    edited["Group"] = edited["Group"].astype(str).str.strip()
    if group_by == "Holding":
        edited["Group"] = edited["Group"].str.upper()
    edited = edited[edited["Group"] != ""]
    targets = dict(zip(edited["Group"], edited["Target %"].fillna(0.0)))
    # A target left at its (rounded) current weight means "keep it": use the exact
    # weight, so rounding alone doesn't produce trades.
    for group, target in targets.items():
        if group in weights.index and abs(target - weights[group]) < 1e-9:
            targets[group] = exact[group]

    unknown = []
    if group_by == "Holding":
        new = [t for t in targets if t not in set(rows["Group"]) and targets[t] > 0]
        rows, unknown = _new_holding_rows(rows, new, base)
    if unknown:
        st.warning(f"No live price for {', '.join(unknown)}; left out of the plan.")

    plan = rebalance.plan(rows, targets, cash, buy_only, fractional, base, group_by, scope)
    if plan.targets_scaled_from is not None:
        st.info(f"Targets added up to {plan.targets_scaled_from:.1f}%, so they were scaled to 100%.")
    if not plan.has_trades:
        st.info("Already on target. Change a target or add new cash to see trades.")
        return None

    tiles = st.columns(4 if plan.realized_gain else 3)
    tiles[0].metric(f"Buys ({base})", f"{plan.total_buys:,.0f}", border=True)
    tiles[1].metric(f"Sells ({base})", f"{plan.total_sells:,.0f}", border=True)
    tiles[2].metric(f"Cash left ({base})", f"{plan.cash_left:,.0f}", border=True,
                    help="New cash plus sale proceeds not spent, e.g. from rounding to whole shares.")
    if plan.realized_gain:
        tiles[3].metric(f"Est. capital gain ({base})", f"{plan.realized_gain:,.0f}", border=True,
                        help="Gain realized by sales in non-registered accounts, from your average cost. Half is taxable.")

    st.markdown("**Trades**")
    st.dataframe(
        plan.trades.assign(Amount=plan.trades["Amount"].abs()),
        hide_index=True,
        width="stretch",
        column_config={
            "Shares": st.column_config.NumberColumn(format="%g"),
            "Price": st.column_config.NumberColumn(format="%.2f", help="Latest price, in the listing currency"),
            "Amount": st.column_config.NumberColumn(f"Amount ({base})", format="accounting"),
            "Current %": st.column_config.NumberColumn(format="%.1f%%"),
            "After %": st.column_config.NumberColumn(format="%.1f%%"),
        },
    )
    if group_by != "Holding":
        st.markdown(f"**By {group_by.lower()}**")
        st.dataframe(
            plan.groups,
            hide_index=True,
            width="stretch",
            column_config={
                "Group": st.column_config.TextColumn(group_by),
                "Current %": st.column_config.NumberColumn(format="%.1f%%"),
                "Target %": st.column_config.NumberColumn(format="%.1f%%"),
                "After %": st.column_config.NumberColumn(format="%.1f%%"),
                "Change": st.column_config.NumberColumn(f"Change ({base})", format="accounting"),
            },
        )
    notes = ["Informational only: no orders are placed, and prices can move before you trade."]
    if scope == rebalance.ALL_ACCOUNTS and len(accounts) > 1 and plan.total_sells > 0:
        notes.append(
            "Across all accounts, a sale in one account can't pay for a buy in another without a withdrawal. "
            "Pick one account above to get trades you can place."
        )
    if plan.realized_gain:
        notes.append("Selling at a gain in a non-registered account is a taxable disposition.")
    st.caption(" ".join(notes))
    return plan


def render(figures):
    """Draw the dashboard. Returns (Performance, Dividends, hints, rebalance Plan), any may be None/empty."""
    base = figures.base
    st.subheader("Dashboard")
    note = "Live Yahoo Finance quotes, which can be delayed up to 15 minutes; refreshed every 5 minutes."
    if figures.fx:
        rates = ", ".join(f"1 {c} = {r:.4f} {base}" for c, r in sorted(figures.fx.items()))
        note += f" Totals in {base} at {rates}."
    st.caption(note)
    if figures.unpriced:
        st.warning(f"No live price for {', '.join(figures.unpriced)}; left out of the totals. Check the ticker symbols.")
    if figures.positions.empty:
        return None, None, [], None

    tiles = st.columns(4)
    tiles[0].metric(f"Market value ({base})", _money(figures.total_value), border=True)
    tiles[1].metric(
        f"Cost basis ({base})", _money(figures.total_cost), border=True,
        help="Positions with a known average buy price.",
    )
    tiles[2].metric(
        f"Unrealized P/L ({base})", _money(figures.total_pl, signed=True), _pct(figures.total_pl_pct), border=True,
    )
    tiles[3].metric(
        f"Today ({base})", _money(figures.day_change, signed=True), _pct(figures.day_change_pct), border=True,
        help="Change since the previous close.",
    )

    history = _history(tuple(portfolio_analytics.history_symbols(figures.positions, base)))
    dividends = portfolio_analytics.compute_dividends(figures, history)
    hints = account_hints.placement_hints(figures, dividends)
    allocation_tab, pl_tab, accounts_tab_, performance_tab_, dividends_tab_, rebalance_tab_, positions_tab = st.tabs(
        ["Allocation", "Gain / loss", "Accounts", "Performance & risk", "Dividends", "Rebalance", "Positions"]
    )
    with allocation_tab:
        view = st.segmented_control(
            "Group by", list(ALLOCATION_VIEWS), default="Holding", key="allocation_view", label_visibility="collapsed"
        ) or "Holding"
        chart, height = allocation_chart(figures.allocation(ALLOCATION_VIEWS[view]), base)
        st.altair_chart(chart, width="stretch", height=height)
    with pl_tab:
        by_ticker = figures.by_ticker()
        if by_ticker["P/L"].notna().any():
            chart, height = pl_chart(by_ticker, base)
            st.altair_chart(chart, width="stretch", height=height)
            missing = by_ticker.loc[by_ticker["P/L"].isna(), "Ticker"].tolist()
            if missing:
                st.caption(f"No average buy price for {', '.join(missing)}, so no P/L is shown.")
        else:
            st.info("Add average buy prices to see gains and losses.")
    with accounts_tab_:
        accounts_tab(figures, dividends, hints)
    with performance_tab_:
        performance = performance_tab(figures, history)
    with dividends_tab_:
        dividends_tab(figures, dividends)
    with rebalance_tab_:
        plan = rebalance_tab(figures)
    with positions_tab:
        st.dataframe(
            figures.positions,
            hide_index=True,
            width="stretch",
            column_config={
                "Shares": st.column_config.NumberColumn(format="%g"),
                "Price": st.column_config.NumberColumn("Price", format="%.2f", help="In the listing currency"),
                "Value": st.column_config.NumberColumn(f"Value ({base})", format="accounting"),
                "Cost": st.column_config.NumberColumn(f"Cost ({base})", format="accounting"),
                "P/L": st.column_config.NumberColumn(f"P/L ({base})", format="accounting"),
                "Day change": st.column_config.NumberColumn(f"Today ({base})", format="accounting"),
                "P/L %": st.column_config.NumberColumn(format="%+.2f%%"),
                "Weight %": st.column_config.NumberColumn(format="%.1f%%"),
            },
        )
    return performance, dividends, hints, plan
