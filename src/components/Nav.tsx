"use client";
// Sidebar links, styled like ProjectCost's Nav: the current section is highlighted.
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [{ href: "/portfolios", label: "Portfolios" }];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {items.map((i) => {
        const active = path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${active ? "bg-white/10 font-medium text-white" : "text-brand-100 hover:bg-white/5 hover:text-white"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
