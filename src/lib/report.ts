// Analyst report downloads: Markdown, and a standalone HTML page in the app's style that prints cleanly
// to PDF. A port of report.py's to_markdown / to_html / filename.
import { marked } from "marked";

export type ReportMeta = { created: string; model: string; base: string };
export type ChatTurn = { role: "user" | "assistant"; content: string };

/** "2026-10-21 14:05" in local time, the format the Streamlit app used. */
export function stamp(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toMarkdown(meta: ReportMeta, report: string, chat: ChatTurn[]): string {
  const lines = [
    "# Portfolio review",
    "",
    `_${meta.created} · ${meta.model} · figures in ${meta.base}. Informational only, not financial advice._`,
    "",
    report.trim(),
  ];
  if (chat.length) {
    lines.push("", "## Follow-up questions");
    for (const m of chat) lines.push("", m.role === "user" ? `**Q: ${m.content.trim()}**` : m.content.trim());
  }
  return lines.join("\n") + "\n";
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect width="24" height="24" rx="2" fill="#0E7C86"/><polyline points="5,17 10,12 13,14.5 19,7.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const STYLE = `
body { font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif; color: #0F172A; background: #F2F4F7; margin: 0; line-height: 1.6; }
header { background: #00204A; color: #DBE6F2; padding: 20px 48px; display: flex; align-items: center; gap: 12px; }
header span { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: #fff; }
header em { font-style: normal; font-weight: 600; color: #7FC7CF; }
main { max-width: 900px; margin: 32px auto; background: #fff; border-radius: 8px; padding: 40px 48px; box-shadow: 0 0 2px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06); }
h1, h2, h3 { color: #12202F; letter-spacing: -0.02em; line-height: 1.25; }
h1 { font-size: 28px; margin-top: 0; }
a { color: #0E7C86; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px; }
th, td { border-bottom: 1px solid #E5E9EF; padding: 6px 10px; text-align: left; }
th { background: #F6F7F9; color: #475569; font-weight: 600; }
@media print {
  body { background: #fff; }
  header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { box-shadow: none; margin: 0; padding: 24px 0; max-width: none; }
}`;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toHtml(meta: ReportMeta, report: string, chat: ChatTurn[]): string {
  // The report can quote web pages; escape raw HTML so only Markdown renders.
  const source = toMarkdown(meta, report, chat).replace(/</g, "&lt;");
  const body = marked.parse(source, { async: false, gfm: true });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portfolio review ${escape(meta.created)}</title>
<style>${STYLE}</style></head>
<body><header>${LOGO}<span>PORTFOLIO <em>by Axiom</em></span></header>
<main>${body}</main></body></html>
`;
}

export function filename(meta: ReportMeta, extension: string) {
  return `portfolio-review-${meta.created.slice(0, 10)}.${extension}`;
}
