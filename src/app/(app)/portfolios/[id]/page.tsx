import { notFound } from "next/navigation";
import { latestAnalysis } from "@/lib/analyses";
import { loadAllPortfolios, loadPortfolio } from "@/lib/portfolios";
import { requireUser } from "@/lib/user";
import { ALL } from "@/lib/selection";
import { Dashboard, type Portfolio, type Search } from "./Dashboard";

/** One saved portfolio, or with id "all" every portfolio's holdings combined. */
export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const userId = await requireUser();
  let portfolio: Portfolio | null;
  if (id === ALL) {
    const all = await loadAllPortfolios(userId);
    portfolio = { id: null, name: "All portfolios", updatedAt: all.updatedAt ?? new Date().toISOString(), holdings: all.holdings, combined: all.portfolios };
  } else {
    portfolio = await loadPortfolio(userId, Number(id));
  }
  if (!portfolio) notFound();
  const analysis = search.tab === "analyst" ? await latestAnalysis(userId, portfolio.id) : null;
  return <Dashboard portfolio={portfolio} search={search} analysis={analysis} />;
}
