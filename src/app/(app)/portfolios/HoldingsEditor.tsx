"use client";
// The holdings table you type into, paste a spreadsheet into, or fill from a broker's export.
// Replaces the Streamlit app's st.data_editor; rows are checked here and again by the server.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveNewAction, updateAction } from "@/app/portfolio-actions";
import { ACCOUNT_TYPES } from "@/lib/accounts";
import {
  checkBalances, checkRows, emptyBalance, emptyRow, pastedRows, toBalanceRow, toRow, type BalanceField, type BalanceRow, type Field, type Row,
} from "@/lib/holdings";
import { MAX_NAME } from "@/lib/limits";
import { BrokeragePanel, useBrokerage, type Loaded } from "./BrokeragePanel";

type Saved = { ticker: string; shares: number | null; avgBuyPrice: number | null; currency: string | null; account: string | null; balance?: number | null };
type Props = { portfolio?: { id: number; name: string; holdings: Saved[] } };

const COLUMNS: { field: Field; label: string; hint?: string; className: string; numeric?: boolean }[] = [
  { field: "ticker", label: "Ticker", hint: "Canadian listings end in .TO, .V, .NE or .CN", className: "min-w-28" },
  { field: "shares", label: "Shares", className: "min-w-24", numeric: true },
  { field: "avgBuyPrice", label: "Avg buy price", hint: "Optional; leave blank if you don't know it", className: "min-w-28", numeric: true },
  { field: "currency", label: "Currency", hint: "Of the average price; blank means the listing's currency", className: "min-w-20" },
  { field: "account", label: "Account", hint: "Optional: used for per-account totals and placement hints", className: "min-w-40" },
];

const BALANCE_COLUMNS: { field: BalanceField; label: string; hint?: string; className: string; numeric?: boolean }[] = [
  { field: "name", label: "Name", hint: "e.g. Wealthsimple Managed, workplace pension, GIC", className: "min-w-48" },
  { field: "balance", label: "Current balance", className: "min-w-28", numeric: true },
  { field: "invested", label: "Amount invested", hint: "Optional: what you've put in, for gain / loss", className: "min-w-28", numeric: true },
  { field: "currency", label: "Currency", className: "min-w-20" },
  { field: "account", label: "Account", className: "min-w-40" },
];

function AccountSelect({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  return (
    <select className="input w-full" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {ACCOUNT_TYPES.map((a) => <option key={a}>{a}</option>)}
      {value && !(ACCOUNT_TYPES as readonly string[]).includes(value) && <option>{value}</option>}
    </select>
  );
}

export function HoldingsEditor({ portfolio }: Props) {
  const [name, setName] = useState(portfolio?.name ?? "");
  const [rows, setRows] = useState<Row[]>(() => {
    const securities = portfolio?.holdings.filter((h) => h.balance == null) ?? [];
    return securities.length ? securities.map(toRow) : portfolio?.holdings.length ? [emptyRow()] : [emptyRow(), emptyRow(), emptyRow()];
  });
  // Managed accounts and other holdings known only by their balance.
  const [balances, setBalances] = useState<BalanceRow[]>(() => (portfolio?.holdings ?? []).filter((h) => h.balance != null).map(toBalanceRow));
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, startSaving] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const brokerage = useBrokerage();
  // ?add=import or ?add=balance: the sidebar's "Import a file" / "Add a balance" point at that part of the editor.
  const add = useSearchParams().get("add");
  const importButton = useRef<HTMLButtonElement>(null);
  const balancesSection = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState<"import" | "balance" | null>(null);
  useEffect(() => {
    if (add === "balance") {
      setBalances((bs) => (bs.some((b) => !b.name.trim() && !b.balance.trim()) ? bs : [...bs, emptyBalance()]));
      setHighlight("balance");
      requestAnimationFrame(() => balancesSection.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    } else if (add === "import") {
      setHighlight("import");
      importButton.current?.focus();
      setMessage({ tone: "info", text: "Choose your broker's holdings export with Import CSV or Excel. Wealthsimple, Questrade, IBKR and most other brokers' files work as they are." });
    } else {
      setHighlight(null);
    }
  }, [add]);

  const checked = checkRows(rows);
  const checkedBalances = checkBalances(balances);
  const errorCount = Object.keys(checked.errors).length + Object.keys(checkedBalances.errors).length;

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

  function loadFromBrokerage(holdings: Loaded[], warnings: string[]) {
    if (checked.count > 0 && !window.confirm(`Replace the ${checked.count} holding${checked.count === 1 ? "" : "s"} in the table with your brokerage's?`)) return;
    const loaded = holdings.map(toRow);
    setRows(loaded.length ? loaded : [emptyRow()]);
    setMessage({ tone: "info", text: [`Loaded ${loaded.length} holding${loaded.length === 1 ? "" : "s"} from your brokerage. Save to keep them.`, ...warnings].join(" ") });
    if (!name.trim()) setName("Brokerage holdings");
    brokerage.setOpen(false);
  }

  function save() {
    setShowErrors(true);
    if (errorCount) return setMessage({ tone: "error", text: `Fix the ${errorCount} highlighted row${errorCount === 1 ? "" : "s"} first.` });
    const all = [...checked.holdings, ...checkedBalances.holdings];
    if (!all.length) return setMessage({ tone: "error", text: "Add at least one holding with a ticker and shares, or a balance." });
    if (!name.trim()) return setMessage({ tone: "error", text: "Give the portfolio a name." });
    setMessage(null);
    startSaving(async () => {
      const result = portfolio
        ? await updateAction(portfolio.id, name, all)
        : await saveNewAction(name, all);
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
          <button ref={importButton} type="button" className={`btn btn-secondary ${highlight === "import" ? "ring-2 ring-brand-500 ring-offset-1" : ""}`} disabled={importing} onClick={() => file.current?.click()}>
            {importing ? "Importing…" : "Import CSV or Excel"}
          </button>
          <a href="/api/py/template.csv" className="text-xs font-medium text-brand-600 hover:underline">Download template</a>
          {brokerage.status?.configured && !brokerage.open && (
            <button type="button" className="btn btn-secondary" onClick={() => brokerage.setOpen(true)}>
              {brokerage.status.connected ? "Load from brokerage" : "Connect brokerage"}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        One row per position. Import a holdings export from Wealthsimple, Questrade, IBKR and most other brokers, connect your brokerage,
        or paste rows copied from a spreadsheet into the Ticker column.
      </p>

      {brokerage.open && <BrokeragePanel brokerage={brokerage} onLoad={loadFromBrokerage} />}

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
                          <AccountSelect value={r.account} label={label} onChange={(v) => edit(r.key, "account", v)} />
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

      <section ref={balancesSection} className={`rounded-lg border bg-white shadow-sm ${highlight === "balance" ? "border-brand-500 ring-2 ring-brand-500/30" : "border-slate-200"}`}>
        <header className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Managed accounts and other balances</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            For money you can&rsquo;t list holding by holding, like a managed (robo-advisor) portfolio, a pension or a GIC: enter its current balance.
            It counts in your totals, allocation by account and currency, and rebalancing. With no holdings to price, it&rsquo;s left out of the performance backtest and dividends.
          </p>
        </header>
        {balances.length > 0 && (
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  {BALANCE_COLUMNS.map((c) => <th key={c.field} className={`${c.className} ${c.numeric ? "num" : ""}`} title={c.hint}>{c.label}</th>)}
                  <th className="w-0"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b, i) => {
                  const errs = showErrors ? checkedBalances.errors[b.key] : undefined;
                  const set = (field: BalanceField, value: string) => setBalances((bs) => bs.map((x) => (x.key === b.key ? { ...x, [field]: value } : x)));
                  return (
                    <tr key={b.key}>
                      {BALANCE_COLUMNS.map((c) => {
                        const err = errs?.[c.field];
                        const label = `${c.label}, balance ${i + 1}`;
                        return (
                          <td key={c.field} className="align-top">
                            {c.field === "account" ? (
                              <AccountSelect value={b.account} label={label} onChange={(v) => set("account", v)} />
                            ) : (
                              <input
                                className={`input w-full ${c.numeric ? "text-right" : ""} ${c.field === "currency" ? "uppercase" : ""} ${err ? "!border-red-400 bg-red-50" : ""}`}
                                aria-label={label}
                                aria-invalid={Boolean(err)}
                                inputMode={c.numeric ? "decimal" : undefined}
                                placeholder={c.field === "name" ? "e.g. Wealthsimple Managed" : c.field === "invested" ? "optional" : undefined}
                                autoFocus={highlight === "balance" && c.field === "name" && i === balances.length - 1 && !b.name}
                                value={b[c.field]}
                                maxLength={c.field === "currency" ? 3 : c.field === "name" ? 60 : 20}
                                onChange={(e) => set(c.field, e.target.value)}
                              />
                            )}
                            {err && <div className="mt-0.5 text-[0.7rem] text-red-700">{err}</div>}
                          </td>
                        );
                      })}
                      <td className="align-top">
                        <button type="button" className="btn btn-secondary btn-sm" aria-label={`Remove balance ${i + 1}`} onClick={() => setBalances((bs) => bs.filter((x) => x.key !== b.key))}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className={`flex items-center justify-between px-3 py-2 ${balances.length ? "border-t border-slate-100" : ""}`}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBalances((bs) => [...bs, emptyBalance()])}>+ Add a balance</button>
          {checkedBalances.count > 0 && <span className="text-xs text-slate-500">{checkedBalances.holdings.length} balance{checkedBalances.holdings.length === 1 ? "" : "s"}</span>}
        </div>
      </section>

      <div className="flex items-center gap-2">
        <button type="button" className="btn" disabled={saving || importing} onClick={save}>{saving ? "Saving…" : portfolio ? "Save changes" : "Save portfolio"}</button>
        <Link href={portfolio ? `/portfolios/${portfolio.id}` : "/portfolios"} className="btn btn-secondary">Cancel</Link>
      </div>
    </div>
  );
}
