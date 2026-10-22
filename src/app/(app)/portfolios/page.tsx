import Link from "next/link";
import { Card, Empty, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { listPortfolios } from "@/lib/portfolios";
import { requireUser } from "@/lib/user";
import { date } from "@/lib/format";
import { createExampleAction } from "@/app/portfolio-actions";
import { PortfolioActions } from "./PortfolioActions";

export default async function PortfoliosPage() {
  const saved = await listPortfolios(await requireUser());
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Portfolios"
        subtitle="Your saved portfolios. Open one to see live values, performance and the analyst."
        actions={
          <div className="flex flex-wrap gap-2">
            {saved.length > 1 && <Link href="/portfolios/all" className="btn btn-secondary">View all combined</Link>}
            <Link href="/portfolios/new" className="btn">New portfolio</Link>
          </div>
        }
      />
      <Card>
        {saved.length === 0 ? (
          <Empty>
            <p>No saved portfolios yet.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/portfolios/new" className="btn">Add your holdings</Link>
              <form action={createExampleAction}>
                <button className="btn btn-secondary">Try an example portfolio</button>
              </form>
            </div>
          </Empty>
        ) : (
          <DataTable
            label="Saved portfolios"
            columns={[
              { key: "name", label: "Name" },
              { key: "holdings", label: "Holdings", kind: "number", align: "right" },
              { key: "updated", label: "Updated", kind: "date" },
              { key: "actions", label: "Actions", header: <span className="sr-only">Actions</span>, sortable: false, filterable: false, className: "w-0" },
            ]}
            rows={saved.map((p) => ({
              key: String(p.id),
              cells: {
                name: { value: p.name, display: <Link href={`/portfolios/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link> },
                holdings: { value: p.holdings },
                updated: { value: p.updatedAt, label: date(p.updatedAt), className: "whitespace-nowrap text-slate-600" },
                actions: { value: null, display: <PortfolioActions id={p.id} name={p.name} /> },
              },
            }))}
          />
        )}
      </Card>
    </div>
  );
}
