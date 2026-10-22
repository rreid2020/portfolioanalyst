"use client";
// Sidebar links, styled like ProjectCost's Nav: the current section is highlighted. Below the portfolio
// list come the views of one portfolio: the one open, or else the most recently updated.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Item = { href: string; label: string; active: boolean };

// Dashboard tabs that the sidebar's "Dashboard" link stands for; the others get their own links.
const DASHBOARD_TABS = ["allocation", "gain-loss", "positions"];
const VIEWS = [
  { tab: "performance", label: "Performance & risk" },
  { tab: "accounts", label: "Accounts" },
  { tab: "dividends", label: "Dividends" },
  { tab: "rebalance", label: "Rebalance" },
  { tab: "analyst", label: "Analyst" },
];

function NavLink({ href, label, active }: Item) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${active ? "bg-white/10 font-medium text-white" : "text-brand-100 hover:bg-white/5 hover:text-white"}`}>
      {label}
    </Link>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-4 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#7FC7CF]">{children}</div>;
}

export function Nav({ portfolios }: { portfolios: { id: number; name: string }[] }) {
  const path = usePathname();
  const router = useRouter();
  const tab = useSearchParams().get("tab") ?? "allocation";
  const open = /^\/portfolios\/(\d+)/.exec(path)?.[1];
  const current = portfolios.find((p) => String(p.id) === open) ?? portfolios[0];
  const onPortfolio = current != null && open === String(current.id);
  const editing = onPortfolio && path.endsWith("/edit");
  const base = current ? `/portfolios/${current.id}` : "";

  return (
    <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
      <NavLink href="/portfolios" label="All portfolios" active={path === "/portfolios"} />
      <NavLink href="/portfolios/new" label="New portfolio" active={path === "/portfolios/new"} />

      {current && (
        <>
          <Heading>Portfolio</Heading>
          {portfolios.length > 1 ? (
            <select
              aria-label="Portfolio"
              className="mx-1 mb-1 rounded-md bg-white/10 px-2 py-1.5 text-sm font-medium text-white [&>option]:text-slate-900"
              value={current.id}
              onChange={(e) => router.push(`/portfolios/${e.target.value}`)}
            >
              {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <Link href={base} className="truncate rounded-md px-3 py-1.5 text-sm font-medium text-white hover:bg-white/5" title={current.name}>{current.name}</Link>
          )}
          <NavLink href={base} label="Dashboard" active={onPortfolio && !editing && DASHBOARD_TABS.includes(tab)} />
          {VIEWS.map((v) => (
            <NavLink key={v.tab} href={`${base}?tab=${v.tab}`} label={v.label} active={onPortfolio && !editing && tab === v.tab} />
          ))}
          <NavLink href={`${base}/edit`} label="Holdings" active={editing} />
        </>
      )}
    </nav>
  );
}
