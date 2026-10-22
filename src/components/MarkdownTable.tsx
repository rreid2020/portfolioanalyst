"use client";
// Tables in Markdown (the analyst's reports) rendered as DataTables, so they sort and filter like the
// rest of the app. Cell text is kept as written; a column is sorted as numbers or dates when every
// filled cell in it reads as one.
import type { Element, ElementContent } from "hast";
import { DataTable, type Column, type Row } from "@/components/DataTable";
import { toNumber, type Kind } from "@/lib/table-filter";

function text(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(text).join("");
  return "";
}

const elements = (node: Element, tag: string): Element[] =>
  node.children.flatMap((c) => (c.type === "element" ? (c.tagName === tag ? [c] : elements(c, tag)) : []));

const DATE = /^\d{4}-\d{2}-\d{2}/;

export function kindOf(values: string[]): Kind {
  const filled = values.filter((v) => v.trim() && v.trim() !== "—" && v.trim().toLowerCase() !== "n/a");
  if (!filled.length) return "text";
  if (filled.every((v) => DATE.test(v.trim()))) return "date";
  // "$1,234", "+12.3%", "(4.00)", "1.2x" read as numbers; tickers like "3M" or words don't.
  if (filled.every((v) => /^[\s$+\-−(]*(US\$|C\$|\$)?[\d,.]+\s*[%x)]?\s*[A-Z]{0,3}\s*$/i.test(v.replace("−", "-")) && toNumber(v) != null)) return "number";
  return "text";
}

export function MarkdownTable({ node }: { node?: Element }) {
  if (!node) return null;
  const headRow = elements(node, "thead").flatMap((h) => elements(h, "tr"))[0];
  const headers = headRow ? elements(headRow, "th").map((th) => text(th).trim()) : [];
  const body = elements(node, "tbody").flatMap((b) => elements(b, "tr")).map((tr) => elements(tr, "td").map((td) => text(td).trim()));
  const columns: Column[] = headers.map((h, i) => {
    const kind = kindOf(body.map((r) => r[i] ?? ""));
    return { key: String(i), label: h || `Column ${i + 1}`, kind, align: kind === "number" ? "right" : undefined };
  });
  const rows: Row[] = body.map((cells, r) => ({
    key: String(r),
    cells: Object.fromEntries(columns.map((c, i) => {
      const raw = cells[i] ?? "";
      const blank = !raw || raw === "—" || raw.toLowerCase() === "n/a";
      return [c.key, { value: blank ? null : c.kind === "number" ? toNumber(raw) : raw, label: raw, display: raw }];
    })),
  }));
  return (
    <div className="not-prose my-4 overflow-hidden rounded-md border border-slate-200">
      <DataTable label={headers.join(", ")} columns={columns} rows={rows} />
    </div>
  );
}
