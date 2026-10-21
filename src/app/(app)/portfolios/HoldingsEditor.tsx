"use client";
// The holdings table you type into, paste a spreadsheet into, or fill from a broker's export.
// Replaces the Streamlit app's st.data_editor; rows are checked here and again by the server.
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { saveNewAction, updateAction } from "@/app/portfolio-actions";
import { ACCOUNT_TYPES } from "@/lib/accounts";
import { checkRows, emptyRow, pastedRows, toRow, type Field, type Row } from "@/lib/holdings";
import { MAX_NAME } from "@/lib/limits";

type Saved = { ticker: string; shares: number | null; avgBuyPrice: number | null; currency: string | null; account: string | null };
type Props = { portfolio?: { id: number; name: string; holdings: Saved[] } };

const COLUMNS: { field: Field; label: string; hint?: string; className: string; numeric?: boolean }[] = [
  { field: "ticker", label: "Ticker", hint: "Canadian listings end in .TO, .V, .NE or .CN", className: "min-w-28" },
  { field: "shares", label: "Shares", className: "min-w-24", numeric: true },
  { field: "avgBuyPrice", label: "Avg buy price", hint: "Optional; leave blank if you don't know it", className: "min-w-28", numeric: true },
  { field: "currency", label: "Currency", hint: "Of the average price; blank means the listing's currency", className: "min-w-20" },
  { field: "account", label: "Account", hint: "Optional: used for per-account totals and placement hints", className: "min-w-40" },
];

export function HoldingsEditor({ portfolio }: Props) {
  const [name, setName] = useState(portfolio?.name ?? "");
  const [rows, setRows] = useState<Row[]>(() => (portfolio?.holdings.length ? portfolio.holdings.map(toRow) : [emptyRow(), emptyRow(), emptyRow()]));
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, startSaving] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const checked = checkRows(rows);
  const errorCount = Object.keys(checked.errors).length;

  function edit(key: string, field: Field, value: string) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function remove(key: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));
  }

  function paste(e: React.ClipboardEvent<HTMLInputElement>, key: string, field: Field) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return; // a single value: let the input take it
    e.preventDefault();
    const pasted = pastedRows(text, field);
    setRows((rs) => {
      const at = rs.findIndex((r) => r.key === key);
      const next = [...rs];
      pasted.forEach((cells, i) => {
        const target = next[at + i];
        if (target) next[at + i] = { ...target, ...cells };
        else next.push({ ...emptyRow(), ...cells });
      });
      return next;
    });
  }

  async function importFile(f: File) {
    if (checked.count > 0 && !window.confirm(`Replace the ${checked.count} holding${checked.count === 1 ? "" : "s"} in the table with the file's?`)) return;
    setImporting(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch("/api/py/import", { method: "POST", body });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof json?.detail === "string" ? json.detail : `The import failed (${res.status}).`);
      const imported = (json.holdings as Saved[]).map(toRow);
      setRows(imported.length ? imported : [emptyRow()]);
      const note = `Imported ${imported.length} holding${imported.length === 1 ? "" : "s"} from ${f.name}.`;
      setMessage({ tone: "info", text: [note, ...(json.warnings as string[])].join(" ") });
      if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, "").slice(0, MAX_NAME));
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setImporting(false);
      if (file.current) file.current.value = "";
    }
  }

  function save() {
    setShowErrors(true);
    if (errorCount) return setMessage({ tone: "error", text: `Fix the ${errorCount} highlighted row${errorCount === 1 ? "" : "s"} first.` });
    if (!checked.holdings.length) return setMessage({ tone: "error", text: "Add at least one holding with a ticker and shares." });
    if (!name.trim()) return setMessage({ tone: "error", text: "Give the portfolio a name." });
    setMessage(null);
    startSaving(async () => {
      const result = portfolio
        ? await updateAction(portfolio.id, name, checked.holdings)
        : await saveNewAction(name, checked.holdings);
      if (result?.error) setMessage({ tone: "error", text: result.error });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Portfolio name</span>
          <input
            className="input mt-1 block w-72 max-w-full"
            value={name}
            maxLength={MAX_NAME}
            placeholder="e.g. Family TFSA"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={file}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
          />
          <button type="button" className="btn btn-secondary" disabled={importing} onClick={() => file.current?.click()}>
            {importing ? "Importing…" : "Import CSV or Excel"}
          </button>
          <a href="/api/py/template.csv" className="text-xs font-medium text-brand-600 hover:underline">Download template</a>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        One row per position. Import a holdings export from Wealthsimple, Questrade, IBKR and most other brokers, or paste rows copied
        from a spreadsheet into the Ticker column.
      </p>

      {message && (
        <div role={message.tone === "error" ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ring-1 ring-inset ${message.tone === "error" ? "bg-red-50 text-red-800 ring-red-200" : "bg-brand-50 text-brand-700 ring-brand-100"}`}>
          {message.text}
        </div>
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="grid-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.field} className={`${c.className} ${c.numeric ? "num" : ""}`} title={c.hint}>{c.label}</th>
              ))}
              <th className="w-0"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const errs = showErrors ? checked.errors[r.key] : undefined;
              return (
                <tr key={r.key}>
                  {COLUMNS.map((c) => {
                    const err = errs?.[c.field];
                    const label = `${c.label}, row ${i + 1}`;
                    return (
                      <td key={c.field} className="align-top">
                        {c.field === "account" ? (
                          <select className="input w-full" aria-label={label} value={r.account} onChange={(e) => edit(r.key, "account", e.target.value)}>
                            <option value="">—</option>
                            {ACCOUNT_TYPES.map((a) => <option key={a}>{a}</option>)}
                            {r.account && !(ACCOUNT_TYPES as readonly string[]).includes(r.account) && <option>{r.account}</option>}
                          </select>
                        ) : (
                          <input
                            className={`input w-full ${c.numeric ? "text-right" : ""} ${c.field === "ticker" || c.field === "currency" ? "uppercase" : ""} ${err ? "!border-red-400 bg-red-50" : ""}`}
                            aria-label={label}
                            aria-invalid={Boolean(err)}
                            inputMode={c.numeric ? "decimal" : undefined}
                            value={r[c.field]}
                            maxLength={c.field === "currency" ? 3 : 30}
                            onChange={(e) => edit(r.key, c.field, e.target.value)}
                            onPaste={(e) => paste(e, r.key, c.field)}
                          />
                        )}
                        {err && <div className="mt-0.5 text-[0.7rem] text-red-700">{err}</div>}
                      </td>
                    );
                  })}
                  <td className="align-top">
                    <button type="button" className="btn btn-secondary btn-sm" aria-label={`Remove row ${i + 1}`} onClick={() => remove(r.key)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>+ Add row</button>
          <span className="text-xs text-slate-500">{checked.holdings.length} holding{checked.holdings.length === 1 ? "" : "s"}{errorCount ? `, ${errorCount} to fix` : ""}</span>
        </div>
      </section>

      <div className="flex items-center gap-2">
        <button type="button" className="btn" disabled={saving || importing} onClick={save}>{saving ? "Saving…" : portfolio ? "Save changes" : "Save portfolio"}</button>
        <Link href={portfolio ? `/portfolios/${portfolio.id}` : "/portfolios"} className="btn btn-secondary">Cancel</Link>
      </div>
    </div>
  );
}
