import math
import os
from urllib.parse import urlencode, urlsplit, urlunsplit

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from agno.agent import Agent
from agno.models.openai.like import OpenAILike
from agno.tools.yfinance import YFinanceTools
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.calculator import CalculatorTools

import branding
import brokerage_sync
import dashboard
import portfolio_metrics
from portfolio_import import COLUMNS, read_holdings, template_csv

load_dotenv()

# Vercel AI Gateway exposes an OpenAI-compatible API.
AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1"

# Query parameter holding the encrypted SnapTrade user (brokerage_sync.seal_user).
BROKERAGE_PARAM = "brokerage"


INSTRUCTIONS = """You are an expert Stock Portfolio Analyst.

Your job is to analyze a user's stock portfolio and produce a clear,
actionable report. For every portfolio you receive, you should:

1. The message includes figures already computed in code from live
   quotes: each position's price, market value, cost, unrealized P/L,
   weight, sector and country, portfolio totals in one base currency,
   the FX rates used, and allocation by sector, country and currency.
   Treat these figures as authoritative. Quote them; do not re-fetch
   prices or recompute them. Tickers ending in .TO, .V, .NE or .CN are
   Canadian listings.
2. Use YFinanceTools for what the figures don't cover:
   stock_fundamentals, analyst_recommendations, company_news and
   historical_prices. Use stock_price only for tickers listed as having
   no live price. Use CalculatorTools for any additional math.
3. Where the figures have no P/L for a position (unknown average buy
   price), say so rather than estimating one.
4. Summarize portfolio-level metrics from the figures: total cost basis,
   total market value, total unrealized P/L, and sector, country and
   currency concentration.
5. Call out risk flags: over-concentration in a single ticker or
   sector, high P/E relative to peers, recent negative news, or
   weak analyst sentiment. Use DuckDuckGoTools when you need broader
   market context that YFinance does not cover.
6. Finish with a short "Recommendations" section: 3-5 bullet points
   on rebalancing ideas, positions worth trimming, and positions
   worth adding to. Be specific but always remind the user this is
   informational, not financial advice.

Formatting rules:
- Use Markdown tables for all numerical data (holdings, fundamentals,
  analyst recommendations).
- Use bullet points for qualitative commentary.
- Keep the tone professional and concise.
"""


def build_agent(model_id: str) -> Agent:
    return Agent(
        name="Stock Portfolio Analyst",
        model=OpenAILike(
            id=model_id,
            api_key=os.getenv("AI_GATEWAY_API_KEY"),
            base_url=AI_GATEWAY_BASE_URL,
        ),
        tools=[
            YFinanceTools(
                stock_price=True,
                stock_fundamentals=True,
                analyst_recommendations=True,
                company_news=True,
                historical_prices=True,
            ),
            DuckDuckGoTools(),
            CalculatorTools(),
        ],
        instructions=[INSTRUCTIONS],
        show_tool_calls=True,
        markdown=True,
    )


def _cell(value):
    """Data editor cells can be None, NaN or strings; normalize to str/None."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return value


def parse_portfolio(rows):
    holdings = []
    for row in rows:
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
            }
        )
    return holdings


def format_prompt(holdings, question: str, figures=None) -> str:
    lines = ["Here is my current stock portfolio:", ""]
    lines.append("| Ticker | Shares | Avg Buy Price | Currency |")
    lines.append("|--------|--------|---------------|----------|")
    for h in holdings:
        avg = h["avg_price"] if h["avg_price"] is not None else "unknown"
        currency = h["currency"] or "same as listing"
        lines.append(
            f"| {h['ticker']} | {h['shares']} | {avg} | {currency} |"
        )
    if figures is not None:
        lines += ["", portfolio_metrics.to_markdown(figures)]
    lines.append("")
    lines.append(question.strip() or "Analyze my portfolio end-to-end.")
    return "\n".join(lines)


def disconnect_brokerage(client) -> None:
    """Delete this session's SnapTrade user, which removes its brokerage connections."""
    brokerage_sync.delete_user(client, st.session_state.snaptrade_user)
    del st.session_state.snaptrade_user
    st.session_state.pop("snaptrade_portal_url", None)
    st.query_params.pop(BROKERAGE_PARAM, None)


def restore_brokerage_user() -> None:
    """Pick the SnapTrade user up from the URL after a session reset or the portal's redirect."""
    token = st.query_params.get(BROKERAGE_PARAM)
    if not token or "snaptrade_user" in st.session_state:
        return
    user = brokerage_sync.unseal_user(token)
    if user is None:
        del st.query_params[BROKERAGE_PARAM]
        st.session_state.brokerage_message = ("warning", "Your brokerage connection expired. Connect again.")
        return
    st.session_state.snaptrade_user = user
    st.session_state.brokerage_message = (
        "info", "Brokerage connection found. Click Load holdings to pull your positions."
    )


def app_url(token=None):
    """This page's URL carrying the brokerage token, for SnapTrade to redirect back to."""
    if not st.context.url:
        return None
    query = urlencode({BROKERAGE_PARAM: token}) if token else ""
    return urlunsplit(urlsplit(st.context.url)._replace(query=query, fragment=""))


def brokerage_panel() -> None:
    personal = brokerage_sync.is_personal()
    st.markdown(
        "Pull your current holdings from Wealthsimple, Questrade, Interactive "
        "Brokers and [other brokers SnapTrade supports]"
        "(https://snaptrade.com/brokerage-integrations), read-only. You sign in "
        "on SnapTrade's page; this app never sees your brokerage password and "
        "can't place trades."
    )
    if not personal:
        st.caption(
            "The connection lasts up to an hour and isn't saved between "
            "visits, so you reconnect each time."
        )

    if st.button("Open connection portal"):
        try:
            client = brokerage_sync.make_client()
            if not personal and "snaptrade_user" not in st.session_state:
                st.session_state.snaptrade_user = brokerage_sync.register_user(client)
                # Survives a session reset, and comes back with the portal's redirect.
                st.query_params[BROKERAGE_PARAM] = brokerage_sync.seal_user(st.session_state.snaptrade_user)
            st.session_state.snaptrade_portal_url = brokerage_sync.connection_portal_url(
                client,
                st.session_state.get("snaptrade_user"),
                redirect_url=app_url(st.query_params.get(BROKERAGE_PARAM)),
            )
            st.session_state.pop("brokerage_message", None)
        except Exception as exc:
            st.session_state.brokerage_message = ("error", f"Couldn't reach SnapTrade: {brokerage_sync.error_message(exc)}")
    if "snaptrade_portal_url" in st.session_state:
        st.link_button("Sign in to your brokerage ↗", st.session_state.snaptrade_portal_url)
        st.caption(
            "Opens in a new tab and the link expires after 5 minutes. Once "
            "your brokerage is connected, SnapTrade brings that tab back to "
            "this app; click Load holdings there (you can close this tab)."
        )

    connected = personal or "snaptrade_user" in st.session_state
    disconnect_after = not personal and st.checkbox(
        "Disconnect after loading",
        value=True,
        help="Deletes the SnapTrade connection once holdings are loaded. "
        "Uncheck it to load again later in this session.",
    )
    if st.button("Load holdings", disabled=not connected):
        client = brokerage_sync.make_client()
        try:
            holdings, warnings = brokerage_sync.fetch_holdings(
                client, st.session_state.get("snaptrade_user")
            )
        except Exception as exc:  # SnapTrade or brokerage errors shouldn't crash the app
            st.session_state.brokerage_message = ("error", f"Couldn't load holdings: {brokerage_sync.error_message(exc)}")
        else:
            st.session_state.holdings = holdings
            # A new key makes the editor drop edits made to the old table.
            st.session_state.editor_version += 1
            notes = [f"Loaded {len(holdings)} holding(s) from your brokerage."]
            if disconnect_after:
                try:
                    disconnect_brokerage(client)
                    notes.append("Disconnected from SnapTrade.")
                except Exception as exc:
                    warnings.append(f"Couldn't disconnect from SnapTrade: {brokerage_sync.error_message(exc)}")
            st.session_state.brokerage_message = ("success", " ".join([*notes, *warnings]))

    if not personal and "snaptrade_user" in st.session_state and st.button("Disconnect"):
        try:
            disconnect_brokerage(brokerage_sync.make_client())
            st.session_state.brokerage_message = ("info", "Disconnected from SnapTrade.")
        except Exception as exc:
            st.session_state.brokerage_message = ("error", f"Couldn't disconnect: {brokerage_sync.error_message(exc)}")
        st.rerun()

    if "brokerage_message" in st.session_state:
        kind, message = st.session_state.brokerage_message
        getattr(st, kind)(message)


def main() -> None:
    st.set_page_config(
        page_title="Portfolio Analyst by Axiom",
        page_icon=":material/monitoring:",
        layout="wide",
    )
    branding.apply()
    branding.page_header(
        "Portfolio review",
        "Add or import your holdings, then let the analyst review valuation, "
        "risk and rebalancing.",
    )

    with st.sidebar:
        branding.sidebar_brand()
        branding.eyebrow("Settings")
        model_id = st.selectbox(
            "Model (via Vercel AI Gateway)",
            [
                "anthropic/claude-sonnet-5.5",
                "openai/gpt-5-mini",
                "google/gemini-3-flash",
                "deepseek/deepseek-v4-flash",
                "meta/llama-3.3-70b",
            ],
            index=0,
        )
        base = st.selectbox(
            "Report currency",
            portfolio_metrics.BASE_CURRENCIES,
            help="Totals, charts and the analyst's report use this currency.",
        )
        if not os.getenv("AI_GATEWAY_API_KEY"):
            st.warning("Set AI_GATEWAY_API_KEY in your .env file.")
        st.markdown(
            "Get a key at [Vercel AI Gateway](https://vercel.com/ai-gateway)."
        )
        branding.sidebar_facts()

    st.subheader("Your holdings")
    if "holdings" not in st.session_state:
        st.session_state.holdings = pd.DataFrame(
            [
                {"Ticker": "AAPL", "Shares": 10, "Avg Buy Price": 150.0, "Currency": "USD"},
                {"Ticker": "MSFT", "Shares": 5, "Avg Buy Price": 310.0, "Currency": "USD"},
                {"Ticker": "NVDA", "Shares": 4, "Avg Buy Price": 420.0, "Currency": "USD"},
            ],
            columns=COLUMNS,
        )
        st.session_state.editor_version = 0

    with st.expander("Import from CSV or Excel", icon=":material/upload_file:", expanded=False):
        st.markdown(
            "Upload a holdings export from your broker (e.g. Wealthsimple "
            "**Documents → Holdings report (CSV)**) or your own sheet. Columns "
            "are detected automatically: a ticker/symbol column, a "
            "quantity/shares column, and optionally an average cost or book "
            "value column. Positions held in several accounts are combined."
        )
        uploaded = st.file_uploader(
            "Holdings file", type=["csv", "xlsx", "xlsm"], label_visibility="collapsed"
        )
        st.download_button(
            "Download template CSV",
            template_csv(),
            file_name="holdings_template.csv",
            mime="text/csv",
        )
        if uploaded is not None and uploaded.file_id != st.session_state.get("imported_file_id"):
            st.session_state.imported_file_id = uploaded.file_id
            try:
                imported, warnings = read_holdings(uploaded.name, uploaded.getvalue())
            except Exception as exc:  # malformed files shouldn't crash the app
                st.session_state.import_message = ("error", f"Couldn't import {uploaded.name}: {exc}")
            else:
                st.session_state.holdings = imported
                # A new key makes the editor drop edits made to the old table.
                st.session_state.editor_version += 1
                note = f"Imported {len(imported)} holding(s) from {uploaded.name}."
                st.session_state.import_message = ("success", " ".join([note, *warnings]))
        if "import_message" in st.session_state:
            kind, message = st.session_state.import_message
            getattr(st, kind)(message)

    if brokerage_sync.is_configured():
        restore_brokerage_user()
        with st.expander(
            "Connect brokerage", icon=":material/link:", expanded=BROKERAGE_PARAM in st.query_params
        ):
            brokerage_panel()

    edited = st.data_editor(
        st.session_state.holdings,
        num_rows="dynamic",
        width="stretch",
        hide_index=True,
        key=f"portfolio_editor_{st.session_state.editor_version}",
    )
    holdings = parse_portfolio(edited.to_dict("records"))
    figures = None
    if holdings:
        with st.spinner("Fetching live prices..."):
            figures = dashboard.load_figures(holdings, base)
        dashboard.render(figures)

    question = st.text_area(
        "What would you like the analyst to focus on?",
        value=(
            "Give me a full portfolio review: valuation, risk, "
            "concentration, and rebalancing recommendations."
        ),
        height=100,
    )

    if st.button("Analyze portfolio", type="primary"):
        if not holdings:
            st.error("Add at least one holding with a ticker and shares > 0.")
            return
        if not os.getenv("AI_GATEWAY_API_KEY"):
            st.error("AI_GATEWAY_API_KEY is missing.")
            return

        agent = build_agent(model_id)
        prompt = format_prompt(holdings, question, figures)

        with st.spinner("Reviewing your portfolio..."):
            response = agent.run(prompt)

        st.subheader("Analyst report")
        st.markdown(getattr(response, "content", str(response)))


if __name__ == "__main__":
    main()
