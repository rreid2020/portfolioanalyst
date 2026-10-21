"""Analyst report helpers: stream agent output, and export the report and follow-ups.

The report and the chat live in st.session_state as plain data:
analysis = {"prompt", "report", "model", "base", "created"} and
chat = [{"role": "user" | "assistant", "content": str}, ...].
"""
import html
from datetime import datetime

import markdown
from agno.run.response import RunEvent

import branding

TOOL_LABELS = {
    "get_current_stock_price": "price",
    "get_company_info": "company profile",
    "get_stock_fundamentals": "fundamentals",
    "get_analyst_recommendations": "analyst ratings",
    "get_company_news": "news",
    "get_historical_stock_prices": "price history",
    "duckduckgo_search": "web search",
    "duckduckgo_news": "news search",
}


def tool_label(name: str, args) -> str:
    """'Fundamentals: AAPL', 'Web search: tsx outlook', 'Calculating'..."""
    args = args or {}
    label = TOOL_LABELS.get(name)
    if label is None:
        return "Calculating" if name in {"add", "subtract", "multiply", "divide", "exponentiate", "square_root", "factorial", "is_prime"} else name.replace("_", " ").capitalize()
    target = args.get("symbol") or args.get("query") or ""
    return f"{label.capitalize()}: {target}" if target else label.capitalize()


def stream_text(events, on_tool=None):
    """Yield the text deltas of an agno streaming run; report tool calls to on_tool(label)."""
    for event in events:
        kind = getattr(event, "event", None)
        if kind == RunEvent.run_response_content.value:
            if isinstance(event.content, str) and event.content:
                yield event.content
        elif kind == RunEvent.tool_call_started.value and on_tool is not None and event.tool is not None:
            on_tool(tool_label(event.tool.tool_name or "", event.tool.tool_args))
        elif kind == RunEvent.run_error.value:
            raise RuntimeError(event.content or "The analyst run failed.")


def history_messages(analysis, chat):
    """The conversation so far, as messages for a follow-up run."""
    messages = [
        {"role": "user", "content": analysis["prompt"]},
        {"role": "assistant", "content": analysis["report"]},
    ]
    messages += [{"role": m["role"], "content": m["content"]} for m in chat]
    return messages


def new_analysis(prompt: str, report_text: str, model: str, base: str) -> dict:
    return {
        "prompt": prompt,
        "report": report_text,
        "model": model,
        "base": base,
        "created": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }


def to_markdown(analysis, chat) -> str:
    lines = [
        "# Portfolio review",
        "",
        f"_{analysis['created']} · {analysis['model']} · figures in {analysis['base']}. "
        "Informational only, not financial advice._",
        "",
        analysis["report"].strip(),
    ]
    if chat:
        lines += ["", "## Follow-up questions"]
        for message in chat:
            if message["role"] == "user":
                lines += ["", f"**Q: {message['content'].strip()}**"]
            else:
                lines += ["", message["content"].strip()]
    return "\n".join(lines) + "\n"


HTML_STYLE = f"""
body {{ font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif; color: #0F172A;
       background: #F2F4F7; margin: 0; line-height: 1.6; }}
header {{ background: {branding.NAVY}; color: #DBE6F2; padding: 20px 48px; display: flex; align-items: center; gap: 12px; }}
header span {{ font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: #fff; }}
header em {{ font-style: normal; font-weight: 600; color: {branding.TEAL_LIGHT}; }}
main {{ max-width: 900px; margin: 32px auto; background: #fff; border-radius: 8px; padding: 40px 48px;
       box-shadow: 0 0 2px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06); }}
h1, h2, h3 {{ color: {branding.INK}; letter-spacing: -0.02em; line-height: 1.25; }}
h1 {{ font-size: 28px; margin-top: 0; }}
a {{ color: {branding.TEAL}; }}
table {{ border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }}
th, td {{ border-bottom: 1px solid #E5E9EF; padding: 6px 10px; text-align: left; }}
th {{ background: #F6F7F9; color: #475569; font-weight: 600; }}
@media print {{
  body {{ background: #fff; }}
  header {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  main {{ box-shadow: none; margin: 0; padding: 24px 0; max-width: none; }}
}}
"""


def to_html(analysis, chat) -> str:
    """A standalone page in the app's style that prints cleanly to PDF."""
    # The report can quote web pages; escape raw HTML so only Markdown renders.
    source = to_markdown(analysis, chat).replace("<", "&lt;")
    body = markdown.markdown(source, extensions=["tables", "sane_lists"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portfolio review {html.escape(analysis['created'])}</title>
<style>{HTML_STYLE}</style></head>
<body><header>{branding.LOGO_IMG}<span>PORTFOLIO <em>by Axiom</em></span></header>
<main>{body}</main></body></html>
"""


def filename(analysis, extension: str) -> str:
    return f"portfolio-review-{analysis['created'][:10]}.{extension}"
