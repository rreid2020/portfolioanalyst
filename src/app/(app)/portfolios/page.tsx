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
    <>
      <PageHeader title="Portfolios" subtitle="Your saved portfolios. Open one to see live values, performance and the analyst." />
      <Card>
        {saved.length === 0 ? (
          <Empty>
            <p>No saved portfolios yet.</p>
            <form action={createExampleAction} className="mt-4">
              <button className="btn">Start with an example portfolio</button>
            </form>
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
    </>
  );
}
