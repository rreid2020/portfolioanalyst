import { notFound } from "next/navigation";
import { latestAnalysis } from "@/lib/analyses";
import { loadPortfolio } from "@/lib/portfolios";
import { requireUser } from "@/lib/user";
import { Dashboard, type Search } from "./Dashboard";

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const userId = await requireUser();
  const portfolio = await loadPortfolio(userId, Number(id));
  if (!portfolio) notFound();
  const analysis = search.tab === "analyst" ? await latestAnalysis(userId, portfolio.id) : null;
  return <Dashboard portfolio={portfolio} search={search} analysis={analysis} />;
}
