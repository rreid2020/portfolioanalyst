"use client";
// Sidebar links, styled like ProjectCost's Nav: the current section is highlighted. Below the portfolio
// list comes a picker (one portfolio, or with two or more, all of them combined) and the views of
// whatever is picked. The pick is remembered in a cookie, so the views stay on it from page to page.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ALL, SELECTED_COOKIE } from "@/lib/selection";

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

export function Nav({ portfolios, remembered }: { portfolios: { id: number; name: string }[]; remembered?: string }) {
  const path = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") ?? "allocation";
  const choices = [...(portfolios.length > 1 ? [{ id: ALL, name: "All portfolios" }] : []), ...portfolios.map((p) => ({ id: String(p.id), name: p.name }))];
  const opened = /^\/portfolios\/(\d+|all)(?:\/|$)/.exec(path)?.[1];
  const current = choices.find((c) => c.id === opened) ?? choices.find((c) => c.id === remembered) ?? choices[portfolios.length > 1 ? 1 : 0];
  const onPortfolio = current != null && opened === current.id;
  const editing = onPortfolio && path.endsWith("/edit");
  const base = current ? `/portfolios/${current.id}` : "";

  // Remember the portfolio being viewed, so the sidebar's links come back to it from other pages.
  useEffect(() => {
    if (opened && choices.some((c) => c.id === opened)) document.cookie = `${SELECTED_COOKIE}=${opened}; path=/; max-age=31536000; samesite=lax`;
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(id: string) {
    // Stay on the same view of the newly picked portfolio; the combined view has no holdings editor.
    const keep = onPortfolio && !editing ? `?${new URLSearchParams([...params.entries()].filter(([k]) => k !== "rebalance"))}` : "";
    router.push(editing && id !== ALL ? `/portfolios/${id}/edit` : `/portfolios/${id}${keep === "?" ? "" : keep}`);
  }

  return (
    <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
      <NavLink href="/portfolios" label="Saved portfolios" active={path === "/portfolios"} />
      <NavLink href="/portfolios/new" label="New portfolio" active={path === "/portfolios/new"} />

      {current && (
        <>
          <Heading>Viewing</Heading>
          {choices.length > 1 ? (
            <select
              aria-label="Portfolio to view"
              className="mx-1 mb-1 rounded-md bg-white/10 px-2 py-1.5 text-sm font-medium text-white [&>option]:text-slate-900"
              value={current.id}
              onChange={(e) => pick(e.target.value)}
            >
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            // A label, not a link: Dashboard below already opens it.
            <div className="truncate px-3 pb-1 text-xs text-brand-100/80" title={current.name}>{current.name}</div>
          )}
          <NavLink href={base} label="Dashboard" active={onPortfolio && !editing && DASHBOARD_TABS.includes(tab)} />
          {VIEWS.map((v) => (
            <NavLink key={v.tab} href={`${base}?tab=${v.tab}`} label={v.label} active={onPortfolio && !editing && tab === v.tab} />
          ))}
          {current.id !== ALL && <NavLink href={`${base}/edit`} label="Holdings" active={editing} />}
        </>
      )}
    </nav>
  );
}
