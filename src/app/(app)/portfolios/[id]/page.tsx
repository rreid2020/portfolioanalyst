import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Notice, PageHeader, Stat } from "@/components/ui";
import { loadPortfolio } from "@/lib/portfolios";
import { requireUser } from "@/lib/user";
import { py, PyError, type Base, type Figures } from "@/lib/py";
import { date, money, pct, shares } from "@/lib/format";

const BASES: Base[] = ["CAD", "USD"];

async function liveFigures(holdings: unknown[], base: Base): Promise<{ figures?: Figures; error?: string }> {
  if (!holdings.length) return {};
  try {
    return { figures: await py<Figures>("/figures", { holdings, base }) };
  } catch (e) {
    if (e instanceof PyError) return { error: e.message };
    throw e;
  }
}

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ base?: string }> }) {
  const [{ id }, { base: baseParam }] = await Promise.all([params, searchParams]);
  const portfolio = await loadPortfolio(await requireUser(), Number(id));
  if (!portfolio) notFound();
  const base: Base = baseParam === "USD" ? "USD" : "CAD";
  const { figures, error } = await liveFigures(portfolio.holdings, base);
  const t = figures?.totals;

  return (
    <>
      <PageHeader
        title={portfolio.name}
        subtitle={`Saved ${date(portfolio.updatedAt)} · ${portfolio.holdings.length} holding${portfolio.holdings.length === 1 ? "" : "s"}`}
        back={{ href: "/portfolios", label: "Portfolios" }}
        actions={
          <>
          <Link href={`/portfolios/${portfolio.id}/edit`} className="btn btn-secondary">Edit holdings</Link>
          <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-xs font-medium" role="group" aria-label="Report currency">
            {BASES.map((b) => (
              <Link key={b} href={`?base=${b}`} className={`rounded px-2.5 py-1 ${b === base ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`} aria-current={b === base}>
                {b}
              </Link>
            ))}
          </div>
          </>
        }
      />

      {error && <div className="mb-4"><Notice tone="error">Couldn&rsquo;t get live prices: {error}</Notice></div>}
      {figures && figures.unpriced.length > 0 && (
        <div className="mb-4"><Notice tone="warn">No live price for {figures.unpriced.join(", ")}; left out of the totals. Check the ticker symbols.</Notice></div>
      )}

      {t && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`Market value (${base})`} value={money(t.value, { whole: true })} />
          <Stat label={`Cost basis (${base})`} value={money(t.cost, { whole: true })} sub="Positions with a known average buy price" />
          <Stat label={`Unrealized P/L (${base})`} value={money(t.pl, { signed: true, whole: true })} sub={pct(t.plPct)} tone={t.pl == null ? undefined : t.pl >= 0 ? "good" : "bad"} />
          <Stat label={`Today (${base})`} value={money(t.dayChange, { signed: true, whole: true })} sub={pct(t.dayChangePct, 2)} tone={t.dayChange == null ? undefined : t.dayChange >= 0 ? "good" : "bad"} />
        </div>
      )}

      {figures && figures.positions.length > 0 ? (
        <Card title="Positions" action={<span className="text-xs text-slate-500">Yahoo Finance quotes, delayed up to 15 minutes</span>}>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Ticker</th><th>Account</th><th>Name</th><th className="num">Shares</th><th className="num">Price</th><th>Ccy</th>
                  <th className="num">Value ({base})</th><th className="num">P/L ({base})</th><th className="num">P/L %</th><th className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {figures.positions.map((p) => (
                  <tr key={`${p.ticker}|${p.account}`}>
                    <td className="font-medium">{p.ticker}</td>
                    <td>{p.account}</td>
                    <td className="max-w-56 truncate text-slate-600">{p.name}</td>
                    <td className="num">{shares(p.shares)}</td>
                    <td className="num">{money(p.price)}</td>
                    <td>{p.currency}</td>
                    <td className="num">{money(p.value)}</td>
                    <td className={`num ${p.pl != null && p.pl < 0 ? "text-red-700" : ""}`}>{money(p.pl, { signed: true })}</td>
                    <td className="num">{pct(p.plPct)}</td>
                    <td className="num">{p.weightPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Holdings">
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead>
                <tr><th>Ticker</th><th className="num">Shares</th><th className="num">Avg buy price</th><th>Currency</th><th>Account</th></tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h, i) => (
                  <tr key={i}>
                    <td className="font-medium">{h.ticker}</td>
                    <td className="num">{shares(h.shares)}</td>
                    <td className="num">{money(h.avgBuyPrice)}</td>
                    <td>{h.currency ?? "—"}</td>
                    <td>{h.account ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
