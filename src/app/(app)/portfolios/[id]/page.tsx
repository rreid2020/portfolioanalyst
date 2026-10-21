import { notFound } from "next/navigation";
import { loadPortfolio } from "@/lib/portfolios";
import { requireUser } from "@/lib/user";
import { Dashboard, type Search } from "./Dashboard";

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const portfolio = await loadPortfolio(await requireUser(), Number(id));
  if (!portfolio) notFound();
  return <Dashboard portfolio={portfolio} search={search} />;
}
