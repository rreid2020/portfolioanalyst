// Sorting and filtering for DataTable, kept free of React so it can be tested on its own.
// Works like Excel's AutoFilter: per column, a checklist of values and an optional condition;
// one column sorted at a time. Rows marked `pinned` (e.g. a blank row being typed into) always
// show, after the others.

export type Kind = "text" | "number" | "date";
export type CellValue = string | number | null;

export type Condition =
  | { op: "eq" | "ne" | "gt" | "ge" | "lt" | "le"; a: number }
  | { op: "between"; a: number; b: number }
  | { op: "contains" | "notContains" | "begins" | "ends" | "is"; text: string };

/** `selected`: the checklist's ticked labels (null: all). `condition`: a number or text rule. */
export type ColumnFilter = { selected: Set<string> | null; condition: Condition | null };
export type Sort = { key: string; dir: "asc" | "desc" } | null;

export type FilterRow = { key: string; pinned?: boolean; values: Record<string, CellValue>; labels: Record<string, string> };

export const BLANK = "(Blanks)";

/** What a value is called in the checklist: its label, or "(Blanks)". */
export function labelOf(row: FilterRow, key: string) {
  const v = row.values[key];
  if (v == null || v === "") return BLANK;
  return row.labels[key] ?? String(v);
}

/** A number from a value, so "$1,234.50", "+12.3%" and "(4.00)" compare as numbers. */
export function toNumber(v: CellValue): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const negative = /^\s*\(.*\)\s*$/.test(v);
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n) || !/\d/.test(v)) return null;
  return negative ? -Math.abs(n) : n;
}

function matches(c: Condition, v: CellValue): boolean {
  if ("text" in c) {
    const s = (v == null ? "" : String(v)).toLowerCase();
    const t = c.text.toLowerCase();
    switch (c.op) {
      case "contains": return s.includes(t);
      case "notContains": return !s.includes(t);
      case "begins": return s.startsWith(t);
      case "ends": return s.endsWith(t);
      case "is": return s === t;
    }
  }
  const n = toNumber(v);
  if (n == null) return false;
  switch (c.op) {
    case "eq": return n === c.a;
    case "ne": return n !== c.a;
    case "gt": return n > c.a;
    case "ge": return n >= c.a;
    case "lt": return n < c.a;
    case "le": return n <= c.a;
    case "between": return n >= Math.min(c.a, c.b) && n <= Math.max(c.a, c.b);
  }
}

export function isActive(f: ColumnFilter | undefined) {
  return Boolean(f && (f.selected || f.condition));
}

/** Compare two values of a column; blanks always last, whichever the direction. */
export function compare(a: CellValue, b: CellValue, kind: Kind): number {
  const blankA = a == null || a === "", blankB = b == null || b === "";
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  if (kind === "number") return (toNumber(a) ?? 0) - (toNumber(b) ?? 0);
  if (kind === "date") return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return String(a).localeCompare(String(b), "en-CA", { numeric: true, sensitivity: "base" });
}

/** The rows to show, in order. */
export function applyTable<R extends FilterRow>(rows: R[], filters: Record<string, ColumnFilter>, sort: Sort, kinds: Record<string, Kind>): R[] {
  const keep = (r: R) =>
    Object.entries(filters).every(([key, f]) =>
      (!f.selected || f.selected.has(labelOf(r, key))) && (!f.condition || matches(f.condition, r.values[key])));
  const shown = rows.filter((r) => !r.pinned && keep(r));
  if (sort) {
    const kind = kinds[sort.key] ?? "text";
    // Blanks stay last in both directions; ties keep their original order.
    shown.sort((a, b) => {
      const va = a.values[sort.key], vb = b.values[sort.key];
      const blank = (v: CellValue) => v == null || v === "";
      if (blank(va) || blank(vb)) return compare(va, vb, kind);
      return sort.dir === "asc" ? compare(va, vb, kind) : compare(vb, va, kind);
    });
  }
  return [...shown, ...rows.filter((r) => r.pinned)];
}

/** The checklist for a column: each distinct label, sorted the way the column sorts. */
export function distinctLabels(rows: FilterRow[], key: string, kind: Kind): string[] {
  const first = new Map<string, CellValue>();
  for (const r of rows) {
    if (r.pinned) continue;
    const label = labelOf(r, key);
    if (!first.has(label)) first.set(label, r.values[key]);
  }
  return [...first.entries()].sort(([, a], [, b]) => compare(a, b, kind)).map(([label]) => label);
}
