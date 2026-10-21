import Link from "next/link";
import { Card, Empty, PageHeader } from "@/components/ui";
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
        actions={<Link href="/portfolios/new" className="btn">New portfolio</Link>}
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
          <table className="grid-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Holdings</th>
                <th>Updated</th>
                <th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {saved.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/portfolios/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                  </td>
                  <td className="num">{p.holdings}</td>
                  <td className="whitespace-nowrap text-slate-600">{date(p.updatedAt)}</td>
                  <td><PortfolioActions id={p.id} name={p.name} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
