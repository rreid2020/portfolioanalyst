"use client";
// The Rebalance tab: set target weights by holding, sector or currency, for all accounts or one, and see
// the trades that reach them. The plan comes from rebalance.py through /api/py/rebalance on every change.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card, Empty, Notice, Stat } from "@/components/ui";
import { money, share, shares } from "@/lib/format";
import type { Holding } from "@/lib/portfolios";

const GROUPINGS = ["Holding", "Sector", "Currency"] as const;
type GroupBy = (typeof GROUPINGS)[number];
const ALL_ACCOUNTS = "All accounts";
const DEBOUNCE_MS = 400;

type Trade = { ticker: string; account: string; action: "Buy" | "Sell"; shares: number; price: number; currency: string; amount: number; currentPct: number; afterPct: number };
type GroupRow = { group: string; currentPct: number; targetPct: number | null; afterPct: number; change: number };
type Plan = {
  hasTrades: boolean; trades: Trade[]; groups: GroupRow[]; cashAdded: number; cashLeft: number; totalBuys: number; totalSells: number;
  targetsScaledFrom: number | null; realizedGain: number | null;
};
type Response = { current: { group: string; currentPct: number }[]; accounts: string[]; unknown: string[]; plan: Plan };
type Target = { key: string; group: string; currentPct: number | null; target: string };

/** The settings the analyst needs to review the same plan (see PromptIn.rebalance in api/index.py). */
export type RebalanceOptions = { groupBy: GroupBy; scope: string; cash: number; buyOnly: boolean; fractional: boolean; targets: Record<string, number> };

let counter = 0;
const key = () => `t${++counter}`;

/** `analystPath` is the Analyst tab's URL; the plan's settings ride along in its `rebalance` parameter. */
export function Rebalancer({ holdings, base, analystPath }: { holdings: Holding[]; base: string; analystPath: string }) {
  const balanceNames = new Set(holdings.filter((h) => h.balance != null).map((h) => h.ticker));
  const [groupBy, setGroupBy] = useState<GroupBy>("Holding");
  const [scope, setScope] = useState(ALL_ACCOUNTS);
  const [cash, setCash] = useState("");
  const [buyOnly, setBuyOnly] = useState(false);
  const [fractional, setFractional] = useState(true);
  const [targets, setTargets] = useState<Target[] | null>(null); // null: start from the current weights
  const [result, setResult] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  const cashValue = Math.max(Number(cash.replace(/[,$\s]/g, "")) || 0, 0);
  const targetMap = targets
    ? Object.fromEntries(targets.filter((t) => t.group.trim()).map((t) => [groupBy === "Holding" ? t.group.trim().toUpperCase() : t.group, Number(t.target) || 0]))
    : null;
  const options: RebalanceOptions = { groupBy, scope, cash: cashValue, buyOnly, fractional, targets: targetMap ?? {} };
  const signature = JSON.stringify({ groupBy, scope, cashValue, buyOnly, fractional, targetMap });

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/py/rebalance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holdings, base, groupBy, scope, cash: cashValue, buyOnly, fractional, targets: targetMap }),
        });
        const json = await res.json().catch(() => null);
        if (id !== request.current) return; // a newer change is on its way
        if (!res.ok) throw new Error(typeof json?.detail === "string" ? json.detail : `The plan failed (${res.status}).`);
        setResult(json);
        setError(null);
        if (!targetMap) setTargets(json.current.map((c: { group: string; currentPct: number }) => ({ key: key(), group: c.group, currentPct: c.currentPct, target: String(c.currentPct) })));
      } catch (e) {
        if (id === request.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, targetMap ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
    // signature covers every input; holdings and base change only with a new page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, holdings, base]);

  function regroup(next: { groupBy?: GroupBy; scope?: string }) {
    if (next.groupBy) setGroupBy(next.groupBy);
    if (next.scope) setScope(next.scope);
    setTargets(null);
  }

  const edit = (k: string, field: "group" | "target", value: string) => setTargets((ts) => ts && ts.map((t) => (t.key === k ? { ...t, [field]: value } : t)));
  const plan = result?.plan;
  const accounts = result?.accounts ?? [];
  const label = groupBy === "Holding" ? "Ticker" : groupBy;
  const notes = ["Informational only: no orders are placed, and prices can move before you trade."];
  if (scope === ALL_ACCOUNTS && accounts.length > 1 && (plan?.totalSells ?? 0) > 0)
    notes.push("Across all accounts, a sale in one account can't pay for a buy in another without a withdrawal. Pick one account above to get trades you can place.");
  if (plan?.realizedGain) notes.push("Selling at a gain in a non-registered account is a taxable disposition.");

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4 px-4 py-3">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Set targets by</div>
            <div className="flex gap-1" role="group" aria-label="Set targets by">
              {GROUPINGS.map((g) => (
                <button key={g} type="button" aria-pressed={g === groupBy} onClick={() => regroup({ groupBy: g })}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${g === groupBy ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Account</span>
            <select className="input mt-1 block" aria-label="Account" value={scope} onChange={(e) => regroup({ scope: e.target.value })} title="Pick one account to get trades you can place with that account's cash.">
              {[ALL_ACCOUNTS, ...accounts].map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">New cash ({base})</span>
            <input className="input mt-1 block w-32 text-right" inputMode="decimal" placeholder="0" aria-label={`New cash (${base})`} value={cash} onChange={(e) => setCash(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700" title="Spend the new cash on the most underweight positions first. Nothing is sold.">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label="Buy only (no selling)" checked={buyOnly} onChange={(e) => setBuyOnly(e.target.checked)} />
            Buy only (no selling)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700" title="Wealthsimple and some other brokers trade fractions of a share.">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label="Fractional shares" checked={fractional} onChange={(e) => setFractional(e.target.checked)} />
            Fractional shares
          </label>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="Targets" action={loading ? <span className="text-xs text-slate-500">Updating…</span> : undefined}>
          <p className="px-4 pt-3 text-xs text-slate-500">
            Targets start at your current weights. Change them{groupBy === "Holding" ? ", or add a row for a holding you don't own yet" : ""}; they&rsquo;re scaled to 100% if they don&rsquo;t add up.
          </p>
          {targets ? (
            <table className="grid-table mt-2">
              <thead><tr><th>{label}</th><th className="num">Current</th><th className="num">Target %</th>{groupBy === "Holding" && <th className="w-0" />}</tr></thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.key}>
                    <td>
                      {t.currentPct == null ? (
                        <input className="input w-28 uppercase" aria-label="Ticker to add" placeholder="e.g. VFV.TO" value={t.group} maxLength={20} onChange={(e) => edit(t.key, "group", e.target.value)} />
                      ) : (
                        <span className="font-medium text-slate-800">{t.group}</span>
                      )}
                    </td>
                    <td className="num">{share(t.currentPct)}</td>
                    <td className="num">
                      <input className="input w-20 text-right" inputMode="decimal" aria-label={`Target % for ${t.group || "new holding"}`} value={t.target} onChange={(e) => edit(t.key, "target", e.target.value)} />
                    </td>
                    {groupBy === "Holding" && (
                      <td>{t.currentPct == null && <button type="button" className="btn btn-secondary btn-sm" aria-label="Remove row" onClick={() => setTargets((ts) => ts && ts.filter((x) => x.key !== t.key))}>✕</button>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Loading current weights…</Empty>
          )}
          {targets && (
            <div className="flex justify-between border-t border-slate-100 px-3 py-2">
              {groupBy === "Holding" ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTargets((ts) => [...(ts ?? []), { key: key(), group: "", currentPct: null, target: "" }])}>+ Add holding</button>
              ) : <span />}
              <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setTargets(null)}>Reset to current</button>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          {result && result.unknown.length > 0 && <Notice tone="warn">No live price for {result.unknown.join(", ")}; left out of the plan.</Notice>}
          {plan?.targetsScaledFrom != null && <Notice>Targets added up to {share(plan.targetsScaledFrom)}, so they were scaled to 100%.</Notice>}
          {plan && !plan.hasTrades && <Card><Empty>Already on target. Change a target or add new cash to see trades.</Empty></Card>}
          {plan?.hasTrades && (
            <>
              <div className={`grid grid-cols-2 gap-3 ${plan.realizedGain ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
                <Stat label={`Buys (${base})`} value={money(plan.totalBuys, base, { whole: true })} />
                <Stat label={`Sells (${base})`} value={money(plan.totalSells, base, { whole: true })} />
                <Stat label={`Cash left (${base})`} value={money(plan.cashLeft, base, { whole: true })} sub="New cash plus sale proceeds not spent" />
                {plan.realizedGain ? <Stat label={`Est. capital gain (${base})`} value={money(plan.realizedGain, base, { whole: true })} sub="Non-registered sales; half is taxable" tone="warn" /> : null}
              </div>
              <Card title="Trades" action={<Link href={`${analystPath}&rebalance=${encodeURIComponent(JSON.stringify(options))}`} className="btn btn-secondary btn-sm">Ask the analyst about this plan</Link>}>
                <div className="overflow-x-auto">
                  <table className="grid-table">
                    <thead><tr><th>Action</th><th>Ticker</th><th>Account</th><th className="num">Shares</th><th className="num">Price</th><th>Ccy</th><th className="num">Amount ({base})</th><th className="num">Now</th><th className="num">After</th></tr></thead>
                    <tbody>
                      {plan.trades.map((t) => (
                        <tr key={`${t.ticker}|${t.account}`}>
                          <td><span className={`inline-flex rounded px-1.5 py-0.5 text-[0.7rem] font-medium ring-1 ring-inset ${t.action === "Buy" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>{t.action}</span></td>
                          <td className="font-medium text-slate-800">{t.ticker}</td>
                          <td>{t.account || "—"}</td>
                          {/* A balance (managed account) moves in money, not shares. */}
                          <td className="num">{balanceNames.has(t.ticker) ? "—" : shares(t.shares)}</td>
                          <td className="num">{balanceNames.has(t.ticker) ? "—" : money(t.price, t.currency)}</td>
                          <td>{t.currency}</td>
                          <td className="num">{money(Math.abs(t.amount), base)}</td>
                          <td className="num">{share(t.currentPct)}</td>
                          <td className="num">{share(t.afterPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {groupBy !== "Holding" && (
                <Card title={`By ${groupBy.toLowerCase()}`}>
                  <table className="grid-table">
                    <thead><tr><th>{groupBy}</th><th className="num">Now</th><th className="num">Target</th><th className="num">After</th><th className="num">Change ({base})</th></tr></thead>
                    <tbody>
                      {plan.groups.map((g) => (
                        <tr key={g.group}>
                          <td className="font-medium text-slate-800">{g.group}</td>
                          <td className="num">{share(g.currentPct)}</td>
                          <td className="num">{share(g.targetPct)}</td>
                          <td className="num">{share(g.afterPct)}</td>
                          <td className={`num ${g.change < 0 ? "text-red-700" : ""}`}>{money(g.change, base, { signed: true })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
          <p className="text-xs text-slate-500">{notes.join(" ")}</p>
        </div>
      </div>
    </div>
  );
}
