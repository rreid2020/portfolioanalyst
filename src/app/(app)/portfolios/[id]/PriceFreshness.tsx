"use client";
// The "prices as of" line under the dashboard totals. While markets are open it re-fetches the
// dashboard every few minutes (router.refresh keeps the page's own state, such as open filters).
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { marketOpen, priceTime } from "@/lib/market-hours";

export const REFRESH_MINUTES = 5; // the API caches quotes for 5 minutes, so sooner gains nothing

/** "Prices as of 10:42 a.m. EDT", for card headers; just "Prices" until the browser has formatted the time. */
export function PricesAsOf({ iso }: { iso: string | null }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => setLabel(iso ? priceTime(iso) : null), [iso]);
  return label ? <>Prices as of <span className="font-medium text-slate-700">{label}</span>,</> : <>Prices</>;
}

export function PriceFreshness({ pricesAsOf, fxNote, autoRefresh }: { pricesAsOf: string | null; fxNote: string; autoRefresh: boolean }) {
  const router = useRouter();
  // Times are formatted in the viewer's time zone, which only the browser knows.
  const [label, setLabel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setLabel(pricesAsOf ? priceTime(pricesAsOf) : null);
    setOpen(marketOpen());
  }, [pricesAsOf]);

  useEffect(() => {
    if (!autoRefresh) return;
    let last = Date.now();
    const refresh = () => {
      setOpen(marketOpen());
      if (document.visibilityState !== "visible" || !marketOpen()) return;
      last = Date.now();
      router.refresh();
    };
    const timer = setInterval(refresh, REFRESH_MINUTES * 60_000);
    // Coming back to a tab that sat in the background: catch up at once if it's due.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= REFRESH_MINUTES * 60_000) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoRefresh, router]);

  return (
    <p className="mb-4 text-xs text-slate-500">
      {autoRefresh && open && (
        <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
          Live
        </span>
      )}
      {label ? <>Prices as of <span className="font-medium text-slate-700">{label}</span> from Yahoo Finance, which can be delayed up to 15 minutes.</> : "Yahoo Finance quotes, which can be delayed up to 15 minutes."}
      {autoRefresh && (open ? ` Updates every ${REFRESH_MINUTES} minutes while markets are open.` : " Markets are closed; prices update when they reopen.")}
      {fxNote}
    </p>
  );
}
