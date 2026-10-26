// The dashboard's tab views. Each takes data already fetched by page.tsx; the analytics-based ones
// (accounts, performance, dividends) render inside a Suspense boundary because the price history is slow.
import Link from "next/link";
import { Card, Empty, InfoTip, Notice, Stat } from "@/components/ui";
import { readPerformance, RISK_TIPS } from "@/lib/risk-reading";
import { DataTable, type Column, type Row } from "@/components/DataTable";
import type { Analytics, Base, Figures, LineGroup, Meta, Position, Trends } from "@/lib/py";
import { incomeByAccount } from "@/lib/dividends";
import { date, money, monthYear, num, pct, share, shares } from "@/lib/format";
import { BarList, CorrelationGrid, fold, Sparkline, type Bar } from "./charts";
import { PerformanceChart } from "./PerformanceChart";
import { PricesAsOf } from "./PriceFreshness";

export const ALLOCATION_VIEWS = ["Holding", "Account", "Sector", "Country", "Currency"] as const;
const MAX_CORRELATION_HOLDINGS = 12;

type Href = (params: Record<string, string>) => string;

function Pills({ options, current, href, label }: { options: { value: string; label: string }[]; current: string; href: Href; label: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <Link
          key={o.value}
          href={href({ [label.toLowerCase()]: o.value })}
          aria-current={o.value === current}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${o.value === current ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"}`}
          scroll={false}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function AllocationView({ figures, view, href }: { figures: Figures; view: (typeof ALLOCATION_VIEWS)[number]; href: Href }) {
  const rows = fold(
    figures.allocation[view],
    (tail) => ({ group: `Other (${tail.length})`, value: tail.reduce((s, r) => s + r.value, 0), weightPct: tail.reduce((s, r) => s + r.weightPct, 0) }),
  );
  const bars: Bar[] = rows.map((r) => ({
    key: r.group, label: r.group, value: r.value, text: share(r.weightPct),
    detail: `${r.group}: ${money(r.value, figures.base)} (${share(r.weightPct)})`,
  }));
  return (
    <Card title={`Allocation by ${view.toLowerCase()}`} action={<Pills label="View" current={view} href={href} options={ALLOCATION_VIEWS.map((v) => ({ value: v, label: v }))} />}>
      <BarList bars={bars} label={`Share of market value by ${view.toLowerCase()}`} />
    </Card>
  );
}

export function GainLossView({ figures, editHref }: { figures: Figures; editHref: string }) {
  const withPl = figures.byTicker.filter((p) => p.pl != null);
  const missing = figures.byTicker.filter((p) => p.pl == null).map((p) => p.ticker);
  if (!withPl.length) return <Card><Empty>Add average buy prices to see gains and losses. <Link href={editHref} className="underline">Edit holdings</Link>.</Empty></Card>;
  const sorted = [...withPl].sort((a, b) => b.pl! - a.pl!);
  const bars: Bar[] = sorted.map((p) => ({
    key: p.ticker, label: p.ticker, value: p.pl!, text: money(p.pl, figures.base, { signed: true, whole: true }),
    detail: `${p.ticker}: ${money(p.pl, figures.base, { signed: true })} (${pct(p.plPct)})`,
  }));
  return (
    <Card title={`Unrealized gain / loss (${figures.base})`}>
      <BarList bars={bars} diverging label="Unrealized gain or loss per holding" />
      {missing.length > 0 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">No average buy price for {missing.join(", ")}, so no P/L is shown.</p>}
    </Card>
  );
}

const red = (v: number | null | undefined) => (v != null && v < 0 ? "text-red-700" : undefined);

const PERIOD_NAMES: Record<string, string> = { "1mo": "1 month", "3mo": "3 months" };
const TREND_LABELS: Record<string, string> = { "1 month": "1-mo trend", "3 months": "3-mo trend" };
// Under 0.05% either way reads as 0.0%, so it is shown as flat rather than as a gain or a loss.
const FLAT_PCT = 0.05;

function positionColumns(base: string, trendPeriod: string): Column[] {
  return [
    { key: "ticker", label: "Ticker" },
    { key: "account", label: "Account" },
    { key: "name", label: "Name" },
    { key: "trend", label: "Trend", header: <span title={`Daily closes over ${trendPeriod}`}>{TREND_LABELS[trendPeriod] ?? "Trend"}</span>, kind: "number", align: "right" },
    { key: "shares", label: "Shares", kind: "number", align: "right" },
    // The price carries its currency (US$ for USD), so there's no separate currency column.
    { key: "price", label: "Price", kind: "number", align: "right" },
    // Amounts are all in the base currency, which the card header states, so the headers leave it out.
    { key: "value", label: `Value (${base})`, header: "Value", kind: "number", align: "right" },
    { key: "cost", label: `Cost (${base})`, header: "Cost", kind: "number", align: "right" },
    { key: "pl", label: `P/L (${base})`, header: "P/L", kind: "number", align: "right" },
    { key: "plPct", label: "P/L %", kind: "number", align: "right" },
    { key: "dayChange", label: `Today (${base})`, header: "Today", kind: "number", align: "right" },
    { key: "weight", label: "Weight", kind: "number", align: "right" },
    { key: "sector", label: "Sector / country" },
  ];
}

/** `trends` is undefined while they load, so the column shows a placeholder rather than "no data". */
function positionRow(p: Position, base: string, trends: Trends | undefined, trendPeriod: string): Row {
  const name = p.balanceOnly ? "Balance only (holdings unknown)" : p.name;
  const trend = p.balanceOnly ? undefined : trends?.trends[p.ticker];
  return {
    key: `${p.ticker}|${p.account}`,
    cells: {
      ticker: { value: p.ticker, className: "font-medium text-slate-800" },
      account: { value: p.account },
      name: { value: name, className: "max-w-40 truncate text-slate-600", title: name },
      trend: trend
        ? {
            value: trend.changePct,
            label: pct(trend.changePct, 1),
            title: `${pct(trend.changePct, 1)} over ${trendPeriod}, from daily closes in ${p.currency}`,
            display: (
              <span className="inline-flex items-center gap-1.5">
                <Sparkline closes={trend.closes} changePct={trend.changePct} period={trendPeriod} flat={Math.abs(trend.changePct ?? 0) < FLAT_PCT} />
                <span className={`w-12 tabular-nums ${Math.abs(trend.changePct ?? 0) < FLAT_PCT ? "text-slate-500" : red(trend.changePct) ?? "text-slate-600"}`}>{pct(trend.changePct, 1)}</span>
              </span>
            ),
          }
        : { value: null, display: !trends && !p.balanceOnly ? <span className="inline-block h-[22px] w-[104px] animate-pulse rounded bg-slate-100 align-middle" aria-label="Loading trend" /> : "—" },
      shares: { value: p.balanceOnly ? null : p.shares, display: p.balanceOnly ? "—" : shares(p.shares) },
      price: { value: p.balanceOnly ? null : p.price, display: p.balanceOnly ? "—" : money(p.price, p.currency) },
      value: { value: p.value, display: money(p.value, base) },
      cost: { value: p.cost, display: money(p.cost, base) },
      pl: { value: p.pl, display: money(p.pl, base, { signed: true }), className: red(p.pl) },
      plPct: { value: p.plPct, display: pct(p.plPct, 2) },
      dayChange: { value: p.dayChange, display: money(p.dayChange, base, { signed: true }), className: red(p.dayChange) },
      weight: { value: p.weightPct, display: share(p.weightPct) },
      sector: {
        // Funds report "Fund (mixed)" for both; say it once.
        value: [...new Set([p.sector, p.country].filter(Boolean))].join(" · "),
        className: "text-slate-600",
        display: (
          <span className="block leading-tight">
            {p.sector}
            {p.country && p.country !== p.sector && <span className="block text-[0.7rem] text-slate-400">{p.country}</span>}
          </span>
        ),
      },
    },
  };
}

export function PositionsView({ figures, trends }: { figures: Figures; trends?: Trends }) {
  const base = figures.base;
  const trendPeriod = PERIOD_NAMES[trends?.period ?? "1mo"] ?? trends?.period ?? "1 month";
  return (
    <Card title="Positions" action={<span className="text-xs text-slate-500"><PricesAsOf iso={figures.pricesAsOf} /> in the listing currency; amounts in <span className="font-medium text-slate-700">{base}</span></span>}>
      <DataTable className="compact" label="Positions" columns={positionColumns(base, trendPeriod)} rows={figures.positions.map((p) => positionRow(p, base, trends, trendPeriod))} footer={
        <tr>
          <td colSpan={6}>Total</td>
          <td className="num">{money(figures.totals.value, base)}</td>
          <td className="num">{money(figures.totals.cost, base)}</td>
          <td className="num">{money(figures.totals.pl, base, { signed: true })}</td>
          <td className="num">{pct(figures.totals.plPct, 2)}</td>
          <td className="num">{money(figures.totals.dayChange, base, { signed: true })}</td>
          <td className="num">{share(100)}</td>
          <td />
        </tr>
      } />
    </Card>
  );
}

export function AccountsView({ figures, analytics, disclaimer, editHref }: { figures: Figures; analytics: Analytics; disclaimer: string; editHref: string }) {
  if (!figures.accounts.length)
    return (
      <Card>
        <Empty>
          Set the Account (TFSA, RRSP, FHSA, Non-registered…) on your holdings to see per-account totals and placement hints.{" "}
          <Link href={editHref} className="underline">Edit holdings</Link>. File imports fill it in.
        </Empty>
      </Card>
    );
  const base = figures.base;
  const bars: Bar[] = figures.allocation.Account.map((r) => ({ key: r.group, label: r.group, value: r.value, text: share(r.weightPct), detail: `${r.group}: ${money(r.value, base)} (${share(r.weightPct)})` }));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Card title="Value by account"><BarList bars={bars} label="Share of market value by account" /></Card>
        <Card title="Accounts">
          <DataTable
            label="Accounts"
            columns={[
              { key: "account", label: "Account" },
              { key: "holdings", label: "Holdings", kind: "number", align: "right" },
              { key: "value", label: `Value (${base})`, kind: "number", align: "right" },
              { key: "pl", label: `P/L (${base})`, kind: "number", align: "right" },
              { key: "plPct", label: "P/L %", kind: "number", align: "right" },
              { key: "weight", label: "Weight", kind: "number", align: "right" },
              { key: "income", label: `Dividends (${base}/yr)`, kind: "number", align: "right" },
            ]}
            rows={analytics.accountSummary.map((a) => ({
              key: a.account,
              cells: {
                account: { value: a.account, className: "font-medium text-slate-800" },
                holdings: { value: a.holdings },
                value: { value: a.value, display: money(a.value, base) },
                pl: { value: a.pl, display: money(a.pl, base, { signed: true }), className: red(a.pl) },
                plPct: { value: a.plPct, display: pct(a.plPct, 2) },
                weight: { value: a.weightPct, display: share(a.weightPct) },
                income: { value: a.annualIncome, display: money(a.annualIncome, base) },
              },
            }))}
          />
        </Card>
      </div>
      <Card title="Account placement hints">
        <div className="space-y-3 px-4 py-3">
          {analytics.hints.length ? (
            analytics.hints.map((h) => (
              <div key={`${h.account}|${h.title}`} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="text-sm font-medium text-amber-900">{h.title}</div>
                <p className="mt-0.5 text-sm text-amber-900/80">{h.detail}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-600">Nothing stands out: no US dividends in a TFSA, FHSA or RESP, and no high-yield Canadian dividend stocks in an RRSP.</p>
          )}
          <p className="text-xs text-slate-500">{disclaimer}</p>
        </div>
      </Card>
    </div>
  );
}

export function DividendsView({ analytics, base, balances }: { analytics: Analytics; base: Base; balances: string[] }) {
  const d = analytics.dividends;
  if (!d) return <Card><Empty>No dividend data.</Empty></Card>;
  const payers = d.byTicker.filter((r) => (r.annualIncome ?? 0) > 0);
  const byAccount = incomeByAccount(d.rows, analytics.accountSummary);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Expected annual income (${base})`} value={money(d.totalIncome, base, { whole: true })} />
        <Stat label="Portfolio yield" value={share(d.portfolioYield, 2)} sub="Annual income as a share of market value" />
      </div>
      <p className="text-xs text-slate-500">
        Based on dividends paid over the past 12 months, at today&rsquo;s share counts and exchange rates. Future payments can differ.
        {balances.length > 0 && ` Balances entered without holdings (${balances.join(", ")}) aren't included: their dividends aren't known.`}
      </p>
      {payers.length ? (
        <>
          <Card title={`Income by holding (${base}/yr)`}>
            <BarList
              label="Expected annual dividend income per holding"
              bars={fold(
                payers.map((r) => ({ key: r.ticker, label: r.ticker, value: r.annualIncome ?? 0, text: money(r.annualIncome, base, { whole: true }), detail: `${r.ticker}: ${money(r.annualIncome, base)} a year, yield ${share(r.yieldPct, 2)}` })),
                (tail) => {
                  const value = tail.reduce((s, r) => s + r.value, 0);
                  return { key: "other", label: `Other (${tail.length})`, value, text: money(value, base, { whole: true }), detail: `${tail.map((r) => r.label).join(", ")}: ${money(value, base)} a year` };
                },
              )}
            />
          </Card>
          <Card title={`Income by account (${base}/yr)`}>
            <DataTable
              label="Income by account"
              columns={[
                { key: "account", label: "Account" },
                { key: "income", label: `Annual income (${base})`, kind: "number", align: "right" },
                { key: "share", label: "Share of income", kind: "number", align: "right" },
                { key: "yield", label: "Yield on account value", kind: "number", align: "right" },
              ]}
              rows={byAccount.map((a) => ({
                key: a.account,
                cells: {
                  account: { value: a.account, className: "font-medium text-slate-800" },
                  income: { value: a.income, display: money(a.income, base) },
                  share: { value: (a.income / d.totalIncome) * 100, display: share((a.income / d.totalIncome) * 100) },
                  yield: { value: a.yieldPct, display: share(a.yieldPct, 2) },
                },
              }))}
              footer={
                <tr>
                  <td>Total</td>
                  <td className="num">{money(d.totalIncome, base)}</td>
                  <td className="num">{share(100)}</td>
                  <td className="num">{share(d.portfolioYield, 2)}</td>
                </tr>
              }
            />
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              Where the income is earned matters for tax: US dividends lose 15% withholding in a TFSA, and Canadian dividends get the dividend tax credit only outside registered accounts. See Accounts for placement hints.
            </p>
          </Card>
          <Card title="Dividends by position">
            <DataTable
              label="Dividends by position"
              columns={[
                { key: "ticker", label: "Ticker" },
                { key: "account", label: "Account" },
                { key: "perShare", label: "Dividend / share (12 mo)", kind: "number", align: "right" },
                { key: "currency", label: "Ccy" },
                { key: "yield", label: "Yield", kind: "number", align: "right" },
                { key: "income", label: `Annual income (${base})`, kind: "number", align: "right" },
              ]}
              rows={d.rows.map((r) => ({
                key: `${r.ticker}|${r.account}`,
                cells: {
                  ticker: { value: r.ticker, className: "font-medium text-slate-800" },
                  account: { value: r.account ?? null },
                  perShare: { value: r.dividendPerShare, display: money(r.dividendPerShare, r.currency, { digits: 4 }) },
                  currency: { value: r.currency },
                  yield: { value: r.yieldPct, display: share(r.yieldPct, 2) },
                  income: { value: r.annualIncome, display: money(r.annualIncome, base) },
                },
              }))}
            />
          </Card>
        </>
      ) : (
        <Notice>None of these holdings paid a dividend in the past 12 months.</Notice>
      )}
    </div>
  );
}

const LINE_OPTIONS: { value: LineGroup | ""; label: string }[] = [
  { value: "", label: "Portfolio" }, { value: "Holding", label: "Holdings" }, { value: "Account", label: "Accounts" },
  { value: "Sector", label: "Sectors" }, { value: "Type", label: "Types" },
];

export function PerformanceView({ analytics, meta, figures, period, benchmark, lines, href }: {
  analytics: Analytics; meta: Meta; figures: Figures; period: string; benchmark: string; lines: LineGroup | ""; href: Href;
}) {
  const p = analytics.performance;
  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Pills label="Period" current={period} href={href} options={meta.periods.map((v) => ({ value: v, label: v }))} />
      <Pills label="Benchmark" current={benchmark} href={href} options={meta.benchmarks.map((b) => ({ value: b.symbol, label: b.name }))} />
    </div>
  );
  if (!p) return <div className="space-y-4">{controls}<Card><Empty>Not enough price history for these holdings yet.</Empty></Card></div>;
  const vs = p.benchmarkReturn == null ? undefined : `${num(p.portfolioReturn - p.benchmarkReturn, 1, { signed: true })} pts vs ${p.benchmark.split(".")[0]}`;
  let note = `Backtest of today's holdings from ${date(p.start)}: current share counts valued each day in ${figures.base} with dividends reinvested. It shows how this mix would have done, not your actual returns.`;
  const late = Object.entries(p.lateStarts);
  if (late.length) note += ` Starts later than the period because ${late.map(([t, d]) => `${t} has prices only from ${monthYear(d)}`).join(", ")}.`;
  if (p.excluded.length) note += ` No price history for ${p.excluded.join(", ")}.`;
  if (figures.balances.length) note += ` Balances entered without holdings (${figures.balances.join(", ")}) aren't in the backtest.`;
  if (p.lines.by) note += ` Each ${p.lines.by.toLowerCase()} line is that group's current holdings, valued the same way and indexed to 100.`;
  if (p.lines.leftOut) note += ` The ${p.lines.names.length} largest are drawn; ${p.lines.leftOut} smaller ${p.lines.leftOut === 1 ? "isn't" : "aren't"}.`;
  return (
    <div className="space-y-4">
      {controls}
      {/* Tips on the right-hand cards open leftward so they stay on screen in both the 2- and 4-column layouts. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Return (${p.period})`} value={pct(p.portfolioReturn)} sub={vs ?? `Benchmark ${pct(p.benchmarkReturn)}`} tone={p.portfolioReturn >= 0 ? "good" : "bad"} info={RISK_TIPS.return} />
        <Stat label="Volatility" value={share(p.volatility)} sub="Annualized, from daily returns" info={RISK_TIPS.volatility} infoAlign="end" />
        <Stat label="Beta" value={num(p.beta, 2)} sub={`Against ${p.benchmarkName}`} info={RISK_TIPS.beta} />
        <Stat label="Max drawdown" value={pct(p.maxDrawdown)} sub={`${date(p.drawdownPeak)} to ${date(p.drawdownTrough)}`} tone={p.maxDrawdown < -10 ? "bad" : undefined} info={RISK_TIPS.drawdown} infoAlign="end" />
      </div>
      <Card title="What these numbers mean for this portfolio">
        <dl className="divide-y divide-slate-100 px-4 py-1 text-sm">
          {readPerformance(p, figures.base).map((r) => (
            <div key={r.term} className="grid gap-1 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-medium text-slate-800">{r.term}</dt>
              <dd className="m-0 leading-relaxed text-slate-600">{r.text}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Past figures from a backtest. They describe how this mix has behaved, not what it will do next, and they are not advice.
        </p>
      </Card>
      <Card
        title={`Growth vs ${p.benchmarkName}`}
        action={p.annualizedReturn != null ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            Annualized {pct(p.annualizedReturn)}
            <InfoTip id="tip-annualized" label="annualized return" align="end">{RISK_TIPS.annualized}</InfoTip>
          </span>
        ) : undefined}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <span className="text-xs font-medium text-slate-600">Lines</span>
          <Pills label="Lines" current={lines} href={href} options={LINE_OPTIONS} />
        </div>
        <PerformanceChart series={p.series} benchmarkName={p.benchmarkName} lineNames={p.lines.names} />
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{note}</p>
      </Card>
      {p.correlation.tickers.length > 1 && (
        <Card title="How your holdings move together" action={<InfoTip id="tip-correlation" label="correlation" align="end">{RISK_TIPS.correlation}</InfoTip>}>
          <p className="px-4 pt-3 text-xs text-slate-500">
            Correlation of daily returns over the period. Near 1, two holdings rise and fall together; near 0 or below, they diversify each other.
            {figures.byTicker.length > MAX_CORRELATION_HOLDINGS && ` Largest ${MAX_CORRELATION_HOLDINGS} holdings shown.`}
          </p>
          <CorrelationGrid tickers={p.correlation.tickers} matrix={p.correlation.matrix} />
        </Card>
      )}
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-10 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden="true" />
        Loading five years of price history…
      </div>
    </Card>
  );
}
