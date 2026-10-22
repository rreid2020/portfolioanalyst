// The portfolio dashboard, separate from page.tsx (which does the sign-in and loading) so it can be rendered on its own.
import Link from "next/link";
import { Suspense } from "react";
import { AiBadge, Card, Empty, Notice, PageHeader, Stat } from "@/components/ui";
import type { Holding } from "@/lib/portfolios";
import { py, pyMeta, PyError, type Analytics, type Base, type Figures, type Meta } from "@/lib/py";
import { date, money, pct } from "@/lib/format";
import { ALL } from "@/lib/selection";
import {
  AccountsView, AllocationView, ALLOCATION_VIEWS, AnalyticsSkeleton, DividendsView, GainLossView, PerformanceView, PositionsView,
} from "./views";
import { Analyst, type SavedAnalysis } from "./Analyst";
import { Rebalancer, type RebalanceOptions } from "./Rebalancer";

const TABS = [
  { key: "allocation", label: "Allocation" },
  { key: "gain-loss", label: "Gain / loss" },
  { key: "accounts", label: "Accounts" },
  { key: "performance", label: "Performance & risk" },
  { key: "dividends", label: "Dividends" },
  { key: "rebalance", label: "Rebalance" },
  { key: "positions", label: "Positions" },
  { key: "analyst", label: "Analyst" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const ANALYTICS_TABS: Tab[] = ["accounts", "performance", "dividends"];

/** A saved portfolio, or (id null) all of them combined, with how many went into it. */
export type Portfolio = { id: number | null; name: string; updatedAt: string; holdings: Holding[]; combined?: number };
export type Search = { tab?: string; base?: string; view?: string; period?: string; benchmark?: string; rebalance?: string };

/** The Rebalance tab's settings, passed to the Analyst tab in the URL; anything malformed is ignored. */
function rebalanceFrom(raw: string | undefined): RebalanceOptions | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const ok = ["Holding", "Sector", "Currency"].includes(o?.groupBy) && typeof o.scope === "string" && typeof o.cash === "number"
      && typeof o.buyOnly === "boolean" && typeof o.fractional === "boolean" && o.targets && typeof o.targets === "object";
    return ok ? o : null;
  } catch {
    return null;
  }
}

async function attempt<T>(load: () => Promise<T>): Promise<{ data?: T; error?: string }> {
  try {
    return { data: await load() };
  } catch (e) {
    if (e instanceof PyError) return { error: e.message };
    throw e;
  }
}

/** The tabs that need five years of price history load it here, behind a Suspense fallback. */
async function AnalyticsTab({ tab, holdings, figures, meta, period, benchmark, href, editHref }: {
  tab: Tab; holdings: Holding[]; figures: Figures; meta: Meta; period: string; benchmark: string;
  href: (p: Record<string, string>) => string; editHref: string;
}) {
  const { data: analytics, error } = await attempt(() => py<Analytics>("/analytics", { holdings, base: figures.base, benchmark, period }));
  if (!analytics) return <Notice tone="error">Couldn&rsquo;t load price history: {error}</Notice>;
  if (tab === "accounts") return <AccountsView figures={figures} analytics={analytics} disclaimer={meta.disclaimer} editHref={editHref} />;
  if (tab === "dividends") return <DividendsView analytics={analytics} base={figures.base} />;
  return <PerformanceView analytics={analytics} meta={meta} figures={figures} period={period} benchmark={benchmark} href={href} />;
}

/** A saved portfolio's live dashboard: header, totals, and the tab chosen in `search`. */
export function Dashboard({ portfolio, search, analysis = null, path = `/portfolios/${portfolio.id ?? ALL}` }: {
  portfolio: Portfolio; search: Search; analysis?: SavedAnalysis | null; path?: string;
}) {
  const base: Base = search.base === "USD" ? "USD" : "CAD";
  const tab: Tab = TABS.some((t) => t.key === search.tab) ? (search.tab as Tab) : "allocation";
  const view = ALLOCATION_VIEWS.find((v) => v === search.view) ?? "Holding";
  // The combined view has no holdings of its own to edit; its links go to the portfolio list instead.
  const editHref = portfolio.id == null ? "/portfolios" : `/portfolios/${portfolio.id}/edit`;
  const holdingsCount = `${portfolio.holdings.length} holding${portfolio.holdings.length === 1 ? "" : "s"}`;
  const current = { tab, base, view, period: search.period ?? "", benchmark: search.benchmark ?? "" };
  const href = (changes: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries({ ...current, ...changes }).filter(([, v]) => v) as [string, string][]);
    return `${path}?${q}`;
  };

  // The header draws at once; everything that needs live prices streams in below it.
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={portfolio.name}
        subtitle={portfolio.id == null
          ? `Combined from ${portfolio.combined ?? 0} portfolio${portfolio.combined === 1 ? "" : "s"} · ${holdingsCount}`
          : `Saved ${date(portfolio.updatedAt)} · ${holdingsCount}`}
        back={{ href: "/portfolios", label: "Portfolios" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {portfolio.id != null && <Link href={editHref} className="btn btn-secondary">Edit holdings</Link>}
            <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-xs font-medium" role="group" aria-label="Report currency">
              {(["CAD", "USD"] as Base[]).map((b) => (
                <Link key={b} href={href({ base: b })} scroll={false} aria-current={b === base}
                  className={`rounded px-2.5 py-1 ${b === base ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                  {b}
                </Link>
              ))}
            </div>
          </div>
        }
      />

      {!portfolio.holdings.length ? (
        <Card><Empty>{portfolio.id == null ? "None of your portfolios has holdings yet." : "This portfolio has no holdings yet."} <Link href={portfolio.id == null ? "/portfolios/new" : editHref} className="underline">Add some</Link>.</Empty></Card>
      ) : (
        <Suspense key={base} fallback={<BodySkeleton />}>
          <DashboardBody portfolio={portfolio} search={search} analysis={analysis} base={base} tab={tab} view={view} editHref={editHref} href={href} />
        </Suspense>
      )}
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading live prices">
      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border border-slate-200 bg-white" />)}
      </div>
      <div className="mb-4 h-3 w-80 rounded bg-slate-200" />
      <div className="mb-4 h-9 border-b border-slate-200" />
      <div className="h-64 rounded-lg border border-slate-200 bg-white" />
    </div>
  );
}

async function DashboardBody({ portfolio, search, analysis, base, tab, view, editHref, href }: {
  portfolio: Portfolio; search: Search; analysis: SavedAnalysis | null; base: Base; tab: Tab;
  view: (typeof ALLOCATION_VIEWS)[number]; editHref: string; href: (changes: Record<string, string>) => string;
}) {
  const [{ data: figures, error }, { data: meta }] = await Promise.all([
    attempt(() => py<Figures>("/figures", { holdings: portfolio.holdings, base })),
    attempt(() => pyMeta()),
  ]);
  if (error) return <Notice tone="error">Couldn&rsquo;t get live prices: {error}</Notice>;
  if (!figures || !meta) return null;
  const period = meta.periods.includes(search.period ?? "") ? search.period! : meta.defaultPeriod;
  const benchmark = meta.benchmarks.some((b) => b.symbol === search.benchmark) ? search.benchmark! : meta.defaultBenchmark;
  const t = figures.totals;
  const fxNote = Object.keys(figures.fx).length
    ? ` Totals in ${base} at ${Object.entries(figures.fx).sort().map(([c, r]) => `1 ${c} = ${r.toFixed(4)} ${base}`).join(", ")}.`
    : "";

  return (
    <>
      {figures.unpriced.length > 0 && (
        <div className="mb-4"><Notice tone="warn">No live price for {figures.unpriced.join(", ")}; left out of the totals. Check the ticker symbols.</Notice></div>
      )}
      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Market value (${base})`} value={money(t.value, { whole: true })} />
        <Stat label={`Cost basis (${base})`} value={money(t.cost, { whole: true })} sub="Positions with a known average buy price" />
        <Stat label={`Unrealized P/L (${base})`} value={money(t.pl, { signed: true, whole: true })} sub={pct(t.plPct)} tone={t.pl == null ? undefined : t.pl >= 0 ? "good" : "bad"} />
        <Stat label={`Today (${base})`} value={money(t.dayChange, { signed: true, whole: true })} sub={`${pct(t.dayChangePct, 2)} since the previous close`} tone={t.dayChange == null ? undefined : t.dayChange >= 0 ? "good" : "bad"} />
      </div>
      <p className="mb-4 text-xs text-slate-500">Live Yahoo Finance quotes, which can be delayed up to 15 minutes.{fxNote}</p>

      {figures.positions.length > 0 && (
        <>
          <nav className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200" aria-label="Dashboard">
            {TABS.map((x) => (
              <Link key={x.key} href={href({ tab: x.key })} scroll={false} aria-current={x.key === tab ? "page" : undefined}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${x.key === tab ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                {x.label}
                {x.key === "analyst" && <AiBadge />}
              </Link>
            ))}
          </nav>
          {tab === "allocation" && <AllocationView figures={figures} view={view} href={href} />}
          {tab === "gain-loss" && <GainLossView figures={figures} editHref={editHref} />}
          {tab === "positions" && <PositionsView figures={figures} />}
          {tab === "rebalance" && <Rebalancer holdings={portfolio.holdings} base={base} analystPath={href({ tab: "analyst" })} />}
          {tab === "analyst" && (
            <Analyst portfolioId={portfolio.id} base={base} period={period} benchmark={benchmark} saved={analysis}
              rebalance={rebalanceFrom(search.rebalance)} withoutRebalance={href({ tab: "analyst" })} />
          )}
          {ANALYTICS_TABS.includes(tab) && (
            <Suspense key={`${tab}|${base}|${period}|${benchmark}`} fallback={<AnalyticsSkeleton />}>
              <AnalyticsTab tab={tab} holdings={portfolio.holdings} figures={figures} meta={meta} period={period} benchmark={benchmark} href={href} editHref={editHref} />
            </Suspense>
          )}
        </>
      )}
    </>
  );
}
