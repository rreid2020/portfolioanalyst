"""Tests for streaming the analyst report, follow-up chat and downloads, with the agent mocked.

Run: python -m unittest discover -s tests
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

from agno.models.response import ToolExecution
from agno.run.response import RunResponseContentEvent, RunResponseErrorEvent, ToolCallStartedEvent

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import portfolio_metrics  # noqa: E402
import report  # noqa: E402

ANALYSIS = report.new_analysis("PROMPT", "## Summary\n\n| A | B |\n|---|---|\n| 1 | 2 |", "anthropic/claude-sonnet-5.5", "CAD")


def tool_event(name, **args):
    return ToolCallStartedEvent(tool=ToolExecution(tool_name=name, tool_args=args))


def text_events(*chunks):
    return [RunResponseContentEvent(content=c) for c in chunks]


class StreamTextTest(unittest.TestCase):
    def test_yields_text_and_reports_tools(self):
        tools = []
        events = [tool_event("get_stock_fundamentals", symbol="AAPL"), *text_events("Hello ", "world"), tool_event("multiply", a=1, b=2)]
        self.assertEqual("".join(report.stream_text(events, on_tool=tools.append)), "Hello world")
        self.assertEqual(tools, ["Fundamentals: AAPL", "Calculating"])

    def test_error_event_raises(self):
        with self.assertRaisesRegex(RuntimeError, "rate limited"):
            list(report.stream_text([*text_events("partial"), RunResponseErrorEvent(content="rate limited")]))

    def test_tool_labels(self):
        self.assertEqual(report.tool_label("duckduckgo_search", {"query": "TSX outlook"}), "Web search: TSX outlook")
        self.assertEqual(report.tool_label("get_company_news", {}), "News")
        self.assertEqual(report.tool_label("some_new_tool", None), "Some new tool")


class ExportTest(unittest.TestCase):
    CHAT = [{"role": "user", "content": "What if I sold NVDA?"}, {"role": "assistant", "content": "Tech weight falls to 50%."}]

    def test_history_messages_put_report_first(self):
        messages = report.history_messages(ANALYSIS, self.CHAT)
        self.assertEqual([m["role"] for m in messages], ["user", "assistant", "user", "assistant"])
        self.assertEqual(messages[0]["content"], "PROMPT")
        self.assertEqual(messages[1]["content"], ANALYSIS["report"])

    def test_markdown_includes_follow_ups(self):
        text = report.to_markdown(ANALYSIS, self.CHAT)
        self.assertTrue(text.startswith("# Portfolio review"))
        self.assertIn("not financial advice", text)
        self.assertIn("**Q: What if I sold NVDA?**", text)
        self.assertIn("Tech weight falls to 50%.", text)

    def test_html_renders_tables_and_escapes_raw_html(self):
        analysis = {**ANALYSIS, "report": ANALYSIS["report"] + "\n\n<script>alert(1)</script> <b>x</b>"}
        page = report.to_html(analysis, [])
        self.assertIn("<table>", page)
        self.assertIn("<td>1</td>", page)
        self.assertNotIn("<script>", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("by Axiom", page)
        self.assertEqual(report.filename(ANALYSIS, "html"), f"portfolio-review-{ANALYSIS['created'][:10]}.html")


class AnalystUITest(unittest.TestCase):
    def setUp(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("SNAPTRADE_", "AI_GATEWAY_"))}
        patches = [
            mock.patch.dict(os.environ, {**env, "AI_GATEWAY_API_KEY": "test"}, clear=True),
            mock.patch.object(portfolio_metrics, "fetch_quotes", side_effect=lambda tickers: dict.fromkeys(tickers)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.runs = []
        responses = iter([
            [tool_event("get_company_news", symbol="AAPL"), *text_events("## Review\n\n", "All good.")],
            text_events("Selling NVDA ", "lowers tech weight."),
        ])

        def run(message, **kwargs):
            self.runs.append({"message": message, **kwargs})
            return iter(next(responses))

        self.agent = mock.MagicMock()
        self.agent.return_value.run.side_effect = run

    def test_report_streams_then_follow_up_uses_history(self):
        from streamlit.testing.v1 import AppTest

        with mock.patch("agno.agent.Agent", self.agent):
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
            next(b for b in app.button if b.label == "Analyze portfolio").click().run()
            self.assertFalse(app.exception)
            self.assertEqual(app.session_state.analysis["report"], "## Review\n\nAll good.")
            self.assertTrue(self.runs[0]["stream"])
            self.assertTrue(any("All good." in m.value for m in app.markdown))
            # Shown again on the next rerun, from session state.
            app.run()
            self.assertTrue(any("All good." in m.value for m in app.markdown))

            app.chat_input[0].set_value("What if I sold NVDA?").run()

        self.assertFalse(app.exception)
        follow_up = self.runs[1]
        self.assertEqual(follow_up["message"], "What if I sold NVDA?")
        self.assertEqual([m["content"] for m in follow_up["messages"]][1], "## Review\n\nAll good.")
        self.assertEqual(app.session_state.chat[-1], {"role": "assistant", "content": "Selling NVDA lowers tech weight."})
        self.assertEqual([m.name for m in app.chat_message], ["user", "assistant"])

    def test_failed_run_shows_error(self):
        from streamlit.testing.v1 import AppTest

        self.agent.return_value.run.side_effect = lambda message, **kwargs: iter(
            [RunResponseErrorEvent(content="model unavailable")]
        )
        with mock.patch("agno.agent.Agent", self.agent):
            app = AppTest.from_file(str(ROOT / "main.py"), default_timeout=60).run()
            next(b for b in app.button if b.label == "Analyze portfolio").click().run()
        self.assertFalse(app.exception)
        self.assertNotIn("analysis", app.session_state)
        self.assertTrue(any("model unavailable" in e.value for e in app.error))


if __name__ == "__main__":
    unittest.main()
