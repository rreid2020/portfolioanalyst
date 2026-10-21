import { describe, expect, it } from "vitest";
import { filename, toHtml, toMarkdown } from "@/lib/report";

const meta = { created: "2026-10-21 14:05", model: "anthropic/claude-sonnet-5.5", base: "CAD" };

describe("report downloads", () => {
  it("writes the report and follow-ups as Markdown", () => {
    const md = toMarkdown(meta, "## Summary\n\nAll good.  ", [
      { role: "user", content: "What about NVDA? " },
      { role: "assistant", content: "Trim it." },
    ]);
    expect(md).toBe(
      "# Portfolio review\n\n_2026-10-21 14:05 · anthropic/claude-sonnet-5.5 · figures in CAD. Informational only, not financial advice._\n\n" +
        "## Summary\n\nAll good.\n\n## Follow-up questions\n\n**Q: What about NVDA?**\n\nTrim it.\n",
    );
    expect(toMarkdown(meta, "Report", [])).not.toContain("Follow-up");
  });

  it("renders a standalone page with tables and no raw HTML from the report", () => {
    const html = toHtml(meta, "| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>", []);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("PORTFOLIO <em>by Axiom</em>");
  });

  it("names files by date", () => {
    expect(filename(meta, "md")).toBe("portfolio-review-2026-10-21.md");
  });
});
