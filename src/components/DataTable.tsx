"use client";
// A table with Excel-style sorting and filtering: each column header has a ▾ menu to sort, filter by a
// checklist of its values, or filter by a number or text condition. Only what's shown changes; the rows
// passed in (and anything saved) keep their order. Cells carry a raw value to sort and filter on and
// what to display, which may be any React node (a link, an input, a badge). Server pages can pass
// rows and footers as props, since cells are plain data plus rendered nodes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  applyTable, BLANK, distinctLabels, isActive, toNumber,
  type CellValue, type ColumnFilter, type Condition, type FilterRow, type Kind, type Sort,
} from "@/lib/table-filter";

export type Column = {
  key: string;
  label: string; // plain text, for menus
  header?: ReactNode; // what the header shows, if not the label
  kind?: Kind;
  align?: "left" | "right";
  className?: string;
  sortable?: boolean; // default true
  filterable?: boolean; // default true
};
export type Cell = { value: CellValue; label?: string; display?: ReactNode; className?: string; title?: string };
export type Row = { key: string; cells: Record<string, Cell | undefined>; pinned?: boolean; className?: string };

const NUMBER_OPS: { op: Exclude<Condition["op"], "contains" | "notContains" | "begins" | "ends" | "is">; label: string }[] = [
  { op: "eq", label: "Equals" }, { op: "ne", label: "Does not equal" }, { op: "gt", label: "Greater than" },
  { op: "ge", label: "Greater than or equal to" }, { op: "lt", label: "Less than" }, { op: "le", label: "Less than or equal to" },
  { op: "between", label: "Between" },
];
const TEXT_OPS: { op: "contains" | "notContains" | "begins" | "ends" | "is"; label: string }[] = [
  { op: "contains", label: "Contains" }, { op: "notContains", label: "Does not contain" }, { op: "begins", label: "Begins with" },
  { op: "ends", label: "Ends with" }, { op: "is", label: "Equals" },
];

function SortIcon({ dir }: { dir: "asc" | "desc" }) {
  return <span aria-hidden="true" className="text-brand-600">{dir === "asc" ? "▲" : "▼"}</span>;
}

function FunnelIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-3 w-3 ${active ? "text-brand-600" : "text-slate-400"}`} aria-hidden="true">
      <path fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" />
    </svg>
  );
}

export function DataTable({ columns, rows, footer, label, emptyText = "Nothing to show.", className = "" }: {
  columns: Column[]; rows: Row[]; footer?: ReactNode; label: string; emptyText?: string; className?: string;
}) {
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [sort, setSort] = useState<Sort>(null);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);

  const kinds = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c.kind ?? "text"])) as Record<string, Kind>, [columns]);
  const plain: FilterRow[] = useMemo(() => rows.map((r) => ({
    key: r.key, pinned: r.pinned,
    values: Object.fromEntries(columns.map((c) => [c.key, r.cells[c.key]?.value ?? null])),
    labels: Object.fromEntries(columns.flatMap((c) => (r.cells[c.key]?.label != null ? [[c.key, r.cells[c.key]!.label!]] : []))),
  })), [rows, columns]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const shown = useMemo(() => applyTable(plain, filters, sort, kinds).map((r) => byKey.get(r.key)!), [plain, filters, sort, kinds, byKey]);
  const active = Object.entries(filters).filter(([, f]) => isActive(f));
  const total = rows.filter((r) => !r.pinned).length;
  const visible = shown.filter((r) => !r.pinned).length;

  const setFilter = (key: string, f: ColumnFilter | null) =>
    setFilters((all) => {
      const next = { ...all };
      if (f && isActive(f)) next[key] = f;
      else delete next[key];
      return next;
    });

  const column = menu ? columns.find((c) => c.key === menu.key) : undefined;

  return (
    <div className={className}>
      {(active.length > 0 || sort) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-600" role="status">
          {active.length > 0 && <span>Showing {visible} of {total} row{total === 1 ? "" : "s"}</span>}
          {active.length > 0 && <span className="text-slate-400">Filtered by {active.map(([k]) => columns.find((c) => c.key === k)?.label).join(", ")}</span>}
          {active.length > 0 && footer && <span className="text-slate-400">Totals are for all rows</span>}
          {sort && <span className="text-slate-400">Sorted by {columns.find((c) => c.key === sort.key)?.label}, {sort.dir === "asc" ? "ascending" : "descending"}</span>}
          <span className="ml-auto flex gap-3">
            {active.length > 0 && <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setFilters({})}>Clear all filters</button>}
            {sort && <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setSort(null)}>Clear sort</button>}
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="grid-table" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => {
                const usable = c.sortable !== false || c.filterable !== false;
                const filtered = isActive(filters[c.key]);
                const sorted = sort?.key === c.key ? sort.dir : null;
                return (
                  <th key={c.key} className={`${c.align === "right" ? "num" : ""} ${c.className ?? ""}`}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                    {usable ? (
                      <button type="button"
                        className={`group inline-flex items-center gap-1 rounded uppercase tracking-[0.03em] hover:text-slate-900 ${c.align === "right" ? "flex-row-reverse" : ""}`}
                        aria-haspopup="dialog" aria-expanded={menu?.key === c.key}
                        title={`Sort and filter ${c.label}`}
                        onClick={(e) => setMenu(menu?.key === c.key ? null : { key: c.key, anchor: e.currentTarget })}>
                        <span>{c.header ?? c.label}</span>
                        {sorted && <SortIcon dir={sorted} />}
                        {filtered ? <FunnelIcon active /> : <span aria-hidden="true" className="text-[0.6rem] text-slate-400 group-hover:text-slate-600">▾</span>}
                      </button>
                    ) : (c.header ?? c.label)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className={r.className}>
                {columns.map((c) => {
                  const cell = r.cells[c.key];
                  return (
                    <td key={c.key} className={`${c.align === "right" ? "num" : ""} ${cell?.className ?? ""}`} title={cell?.title}>
                      {cell?.display ?? cell?.label ?? (cell?.value == null ? "" : String(cell.value))}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visible === 0 && total > 0 && (
              <tr><td colSpan={columns.length} className="py-6 text-center text-sm text-slate-500">No rows match the filters. <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setFilters({})}>Clear all filters</button></td></tr>
            )}
            {total === 0 && !shown.length && <tr><td colSpan={columns.length} className="py-6 text-center text-sm text-slate-500">{emptyText}</td></tr>}
          </tbody>
          {/* Footer rows (totals) are for all the rows, not just those shown. */}
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {menu && column && (
        <ColumnMenu
          column={column}
          anchor={menu.anchor}
          values={distinctLabels(plain, column.key, column.kind ?? "text")}
          filter={filters[column.key]}
          sort={sort?.key === column.key ? sort.dir : null}
          onSort={(dir) => { setSort(dir ? { key: column.key, dir } : null); setMenu(null); }}
          onFilter={(f) => { setFilter(column.key, f); setMenu(null); }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function ColumnMenu({ column, anchor, values, filter, sort, onSort, onFilter, onClose }: {
  column: Column; anchor: HTMLElement; values: string[]; filter: ColumnFilter | undefined; sort: "asc" | "desc" | null;
  onSort: (dir: "asc" | "desc" | null) => void; onFilter: (f: ColumnFilter | null) => void; onClose: () => void;
}) {
  const kind = column.kind ?? "text";
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(filter?.selected ?? values));
  const ops = kind === "number" ? NUMBER_OPS : TEXT_OPS;
  const initial = filter?.condition;
  const [op, setOp] = useState<string>(initial?.op ?? "");
  const [a, setA] = useState(initial && "a" in initial ? String(initial.a) : initial && "text" in initial ? initial.text : "");
  const [b, setB] = useState(initial && "b" in initial ? String(initial.b) : "");

  // Below the header button, kept on screen; closes on outside click, Escape, scroll or resize.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const width = 288;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  }, [anchor]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const moved = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  const listed = values.filter((v) => v.toLowerCase().includes(search.trim().toLowerCase()));
  const allTicked = listed.every((v) => ticked.has(v));
  const someTicked = listed.some((v) => ticked.has(v));
  const toggleAll = () => setTicked((t) => {
    const next = new Set(t);
    for (const v of listed) {
      if (allTicked) next.delete(v);
      else next.add(v);
    }
    return next;
  });

  function apply() {
    let condition: Condition | null = null;
    if (op && kind === "number") {
      const na = toNumber(a), nb = toNumber(b);
      if (op === "between" && na != null && nb != null) condition = { op: "between", a: na, b: nb };
      else if (op !== "between" && na != null) condition = { op: op as Exclude<typeof NUMBER_OPS[number]["op"], "between">, a: na };
    } else if (op && a.trim()) {
      condition = { op: op as typeof TEXT_OPS[number]["op"], text: a.trim() };
    }
    // With a search, only the matching ticked values count, as in Excel.
    const chosen = search.trim() ? new Set(listed.filter((v) => ticked.has(v))) : ticked;
    const selected = chosen.size === values.length && values.every((v) => chosen.has(v)) ? null : chosen;
    onFilter({ selected, condition });
  }

  const sortLabels = kind === "number" ? ["Smallest to largest", "Largest to smallest"] : kind === "date" ? ["Oldest to newest", "Newest to oldest"] : ["A to Z", "Z to A"];
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent";

  return createPortal(
    <div ref={box} role="dialog" aria-label={`Sort and filter ${column.label}`}
      className="fixed z-50 w-72 rounded-lg border border-slate-200 bg-white p-2 text-slate-800 shadow-lg"
      style={{ top: pos.top, left: pos.left }}>
      {column.sortable !== false && (
        <>
          <button type="button" className={item} onClick={() => onSort(sort === "asc" ? null : "asc")}>
            <span className="w-4 text-brand-600">{sort === "asc" ? "✓" : ""}</span>Sort {sortLabels[0]}
          </button>
          <button type="button" className={item} onClick={() => onSort(sort === "desc" ? null : "desc")}>
            <span className="w-4 text-brand-600">{sort === "desc" ? "✓" : ""}</span>Sort {sortLabels[1]}
          </button>
        </>
      )}
      {column.filterable !== false && (
        <>
          <div className="my-1 border-t border-slate-100" />
          <button type="button" className={item} disabled={!isActive(filter)} onClick={() => onFilter(null)}>
            <span className="w-4" />Clear filter from &ldquo;{column.label}&rdquo;
          </button>
          {kind !== "date" && (
            <div className="mt-1 space-y-1.5 rounded bg-slate-50 p-2">
              <label className="block text-xs font-medium text-slate-600">
                {kind === "number" ? "Number filter" : "Text filter"}
                <select className="input mt-1 w-full" value={op} onChange={(e) => setOp(e.target.value)}>
                  <option value="">(none)</option>
                  {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
              </label>
              {op && (
                <div className="flex items-center gap-1.5">
                  <input className="input w-full" aria-label={op === "between" ? "From" : "Value"} inputMode={kind === "number" ? "decimal" : undefined}
                    value={a} onChange={(e) => setA(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} autoFocus />
                  {op === "between" && (
                    <>
                      <span className="text-xs text-slate-500">and</span>
                      <input className="input w-full" aria-label="To" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <input className="input mt-2 w-full" placeholder="Search" aria-label={`Search ${column.label} values`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-1 max-h-56 overflow-y-auto rounded border border-slate-200 py-1">
            <label className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={allTicked && listed.length > 0}
                ref={(el) => { if (el) el.indeterminate = someTicked && !allTicked; }} onChange={toggleAll} />
              <span className="font-medium">(Select All{search.trim() ? " Search Results" : ""})</span>
            </label>
            {listed.map((v) => (
              <label key={v} className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={ticked.has(v)}
                  onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(v)) n.delete(v); else n.add(v); return n; })} />
                <span className={`truncate ${v === BLANK ? "italic text-slate-500" : ""}`}>{v}</span>
              </label>
            ))}
            {!listed.length && <div className="px-2 py-1 text-sm text-slate-500">No matches</div>}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-sm" onClick={apply} disabled={!someTicked && !search.trim()}>OK</button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

