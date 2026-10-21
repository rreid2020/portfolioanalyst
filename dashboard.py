"""Live portfolio dashboard: summary tiles, allocation and P/L charts, positions table."""
import altair as alt
import pandas as pd
import streamlit as st

import portfolio_metrics

# Validated with the dataviz palette checker: both clear the chroma floor and
# stay apart under every colour-vision deficiency (worst ΔE 17).
GAIN = "#008C99"  # brand teal, nudged for chart legibility
LOSS = "#C2571A"
INK_MUTED = "#475569"
GRID = "#E5E9EF"

MAX_BARS = 12  # longer lists fold their tail into "Other"

ALLOCATION_VIEWS = {"Holding": "Ticker", "Sector": "Sector", "Country": "Country", "Currency": "Currency"}


@st.cache_data(ttl=300, show_spinner=False)
def _quotes(tickers: tuple) -> dict:
    return portfolio_metrics.fetch_quotes(tickers)


@st.cache_data(ttl=300, show_spinner=False)
def _fx(currencies: tuple, base: str) -> dict:
    return portfolio_metrics.fetch_fx(currencies, base)


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


def render(figures) -> None:
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
        return

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

    allocation_tab, pl_tab, positions_tab = st.tabs(["Allocation", "Gain / loss", "Positions"])
    with allocation_tab:
        view = st.segmented_control(
            "Group by", list(ALLOCATION_VIEWS), default="Holding", key="allocation_view", label_visibility="collapsed"
        ) or "Holding"
        chart, height = allocation_chart(figures.allocation(ALLOCATION_VIEWS[view]), base)
        st.altair_chart(chart, width="stretch", height=height)
    with pl_tab:
        if figures.positions["P/L"].notna().any():
            chart, height = pl_chart(figures.positions, base)
            st.altair_chart(chart, width="stretch", height=height)
            missing = figures.positions.loc[figures.positions["P/L"].isna(), "Ticker"].tolist()
            if missing:
                st.caption(f"No average buy price for {', '.join(missing)}, so no P/L is shown.")
        else:
            st.info("Add average buy prices to see gains and losses.")
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
