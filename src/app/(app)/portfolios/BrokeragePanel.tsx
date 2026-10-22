"use client";
// Connect a brokerage through SnapTrade and load its holdings into the editor. The connection is saved for
// the signed-in user (brokerage_store.py), so later visits can refresh without signing in to the broker again.
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { date } from "@/lib/format";

type Status = { configured: boolean; personal?: boolean; connected: boolean; connectedAt?: string | null };
export type Loaded = { ticker: string; shares: number | null; avgBuyPrice: number | null; currency: string | null; account: string | null };

/** The query parameter SnapTrade's portal returns with, so the returning tab opens this panel. */
export const RETURN_PARAM = "brokerage";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/py/brokerage${path}`, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof json?.detail === "string" ? json.detail : `SnapTrade request failed (${res.status}).`);
  return json as T;
}

/** Whether connecting is available and connected; opens the panel when SnapTrade's portal sent the browser back. */
export function useBrokerage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  // ?brokerage=… : back from SnapTrade's portal, or the sidebar's "Load from brokerage".
  const asked = useSearchParams().has(RETURN_PARAM);
  useEffect(() => {
    call<Status>("").then(setStatus).catch(() => setStatus({ configured: false, connected: false }));
  }, []);
  useEffect(() => {
    if (asked && status?.configured) setOpen(true);
  }, [asked, status?.configured]);
  return { status, setStatus, open, setOpen };
}

export function BrokeragePanel({ brokerage, onLoad }: { brokerage: ReturnType<typeof useBrokerage>; onLoad: (holdings: Loaded[], warnings: string[]) => void }) {
  const { status, setStatus, setOpen } = brokerage;
  const [busy, setBusy] = useState<"connect" | "load" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portal, setPortal] = useState<string | null>(null);

  if (!status?.configured) return null;

  async function connect() {
    // Open the tab now, while the click still counts as the user's: pop-up blockers stop windows opened later.
    const tab = window.open("about:blank", "_blank");
    setBusy("connect");
    setError(null);
    try {
      const back = new URL(window.location.href);
      back.search = `?${RETURN_PARAM}=connected`;
      const { url } = await call<{ url: string }>("/connect", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirectUrl: back.toString() }),
      });
      if (tab) tab.location.href = url;
      else setPortal(url);
      setStatus((s) => s && { ...s, connected: true });
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function load() {
    setBusy("load");
    setError(null);
    try {
      const { holdings, warnings } = await call<{ holdings: Loaded[]; warnings: string[] }>("/holdings", { method: "POST" });
      onLoad(holdings, warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect your brokerage? You'll sign in to it again next time.")) return;
    setBusy("disconnect");
    setError(null);
    try {
      await call("", { method: "DELETE" });
      setStatus((s) => s && { ...s, connected: false, connectedAt: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl text-sm text-slate-600">
          <div className="font-medium text-slate-800">Brokerage connection</div>
          <p className="mt-1">
            Wealthsimple, Questrade, Interactive Brokers and{" "}
            <a href="https://snaptrade.com/brokerage-integrations" target="_blank" rel="noreferrer" className="text-brand-600 underline">other brokers SnapTrade supports</a>,
            read-only. You sign in on SnapTrade&rsquo;s page; this app never sees your brokerage password and can&rsquo;t place trades.
          </p>
          {status.connected && !status.personal && (
            <p className="mt-1 text-xs text-slate-500">
              Connected{status.connectedAt ? ` since ${date(status.connectedAt)}` : ""}.
              If you just signed in to your broker, load your holdings below. If loading says nothing is connected yet, finish in the tab SnapTrade opened, or connect again.
            </p>
          )}
        </div>
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setOpen(false)} aria-label="Close brokerage panel">✕</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status.connected && <button type="button" className="btn" disabled={busy !== null} onClick={load}>{busy === "load" ? "Loading…" : "Load holdings"}</button>}
        {!status.personal && (
          <button type="button" className={status.connected ? "btn btn-secondary" : "btn"} disabled={busy !== null} onClick={connect}>
            {busy === "connect" ? "Opening SnapTrade…" : status.connected ? "Connect another brokerage" : "Connect brokerage ↗"}
          </button>
        )}
        {status.connected && !status.personal && (
          <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={disconnect}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button>
        )}
        {portal && <a href={portal} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-600 underline">Open SnapTrade&rsquo;s sign-in page ↗</a>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
