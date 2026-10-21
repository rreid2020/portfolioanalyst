"""Axiom app-family look: the pieces .streamlit/config.toml's theme can't express.

Mirrors projectcost.axiomft.ca: a navy brand panel (here the sidebar) with
the logo, a tagline and small uppercase teal labels, and a light canvas
with white cards and a tight, bold heading.
"""
import base64

import streamlit as st

NAVY = "#00204A"
TEAL = "#0E7C86"
TEAL_LIGHT = "#7FC7CF"
INK = "#12202F"

# Teal tile with a rising trend line, in the style of the ProjectCost mark.
LOGO_SVG = f"""<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
<rect width="24" height="24" rx="2" fill="{TEAL}"/>
<polyline points="5,17 10,12 13,14.5 19,7.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""
# st.html sanitizes inline SVG away, so the logo goes in as an image.
LOGO_IMG = (
    '<img width="28" height="28" alt="" src="data:image/svg+xml;base64,'
    + base64.b64encode(LOGO_SVG.replace('width="28" height="28" ', 'xmlns="http://www.w3.org/2000/svg" ').encode()).decode()
    + '">'
)

STYLE = f"""<style>
.ax-brand {{ display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.75rem; }}
.ax-brand span {{ font-size: 1.125rem; font-weight: 700; letter-spacing: -0.025em; color: #fff; }}
.ax-brand em {{ font-style: normal; font-weight: 600; color: {TEAL_LIGHT}; }}
.ax-tagline h2 {{ font-size: 1.6rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.025em; color: #fff; padding: 0; margin: 0 0 0.75rem; }}
.ax-tagline p {{ font-size: 0.9rem; line-height: 1.6; color: #DBE6F2; margin: 0; }}
.ax-facts {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 1.25rem; margin: 1.5rem 0 0; padding-top: 1.25rem; border-top: 1px solid rgba(255, 255, 255, 0.15); }}
.ax-facts dt, .ax-eyebrow {{ font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: {TEAL_LIGHT}; }}
.ax-facts dd {{ margin: 0.2rem 0 0; font-size: 0.82rem; font-weight: 600; color: #fff; }}
.ax-header {{ margin-bottom: 0.5rem; }}
.ax-header h1 {{ font-size: 1.75rem; font-weight: 700; letter-spacing: -0.025em; color: {INK}; padding: 0; margin: 0; }}
.ax-header p {{ font-size: 0.875rem; color: #475569; margin: 0.4rem 0 0; }}

/* White cards on the gray canvas, like the sign-in card. */
.stMain [data-testid="stExpander"] details,
.stMain [data-testid="stDataFrame"],
.stMain [data-testid="stTextArea"] textarea {{
    background: #fff;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06);
}}
.stMain [data-testid="stExpander"] details {{ border-radius: 8px; }}
.stMain [data-testid="stExpander"] summary {{ font-weight: 600; color: {INK}; }}
.stButton button, .stDownloadButton button, .stLinkButton a {{ font-weight: 500; }}
.stButton button[kind="primary"] {{ box-shadow: 0 0 0 1px {TEAL}, 0 2px 3px rgba(34, 42, 53, 0.2); }}
</style>"""


def apply() -> None:
    st.html(STYLE)


def sidebar_brand() -> None:
    st.html(
        f"""<div class="ax-brand">{LOGO_IMG}<span>PORTFOLIO <em>by Axiom</em></span></div>
<div class="ax-tagline">
<h2>Know where every position stands.</h2>
<p>Live prices, fundamentals and analyst views for the holdings you
already have, reviewed by an AI analyst.</p>
</div>"""
    )


def sidebar_facts() -> None:
    st.html(
        """<dl class="ax-facts">
<div><dt>Sources</dt><dd>Wealthsimple, Questrade, IBKR, CSV, Excel</dd></div>
<div><dt>Market data</dt><dd>Yahoo Finance, web news</dd></div>
<div><dt>Output</dt><dd>Valuation, P/L, risk, rebalancing</dd></div>
<div><dt>Access</dt><dd>Read-only, never trades</dd></div>
</dl>"""
    )


def page_header(title: str, subtitle: str) -> None:
    st.html(f'<div class="ax-header"><h1>{title}</h1><p>{subtitle}</p></div>')


def eyebrow(text: str) -> None:
    st.html(f'<div class="ax-eyebrow">{text}</div>')
