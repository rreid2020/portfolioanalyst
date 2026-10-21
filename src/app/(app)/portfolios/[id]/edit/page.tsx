import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { loadPortfolio } from "@/lib/portfolios";
import { requireUser } from "@/lib/user";
import { HoldingsEditor } from "../../HoldingsEditor";

export default async function EditPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const portfolio = await loadPortfolio(await requireUser(), Number(id));
  if (!portfolio) notFound();
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={`Edit ${portfolio.name}`} back={{ href: `/portfolios/${portfolio.id}`, label: portfolio.name }} />
      <HoldingsEditor portfolio={portfolio} />
    </div>
  );
}
