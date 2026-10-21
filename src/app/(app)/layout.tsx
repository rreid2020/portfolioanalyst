import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Mark, Wordmark } from "@/components/AuthShell";
import { requireUserProfile } from "@/lib/user";

export const dynamic = "force-dynamic";

const NAV = [{ href: "/portfolios", label: "Portfolios" }];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email, name } = await requireUserProfile();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-brand-900 py-5 md:flex">
        <Link href="/portfolios" className="mb-6 flex items-center gap-2.5 px-5">
          <Mark className="h-7 w-7 shrink-0" />
          <span className="leading-tight">
            <span className="block text-base font-bold tracking-tight text-white">PORTFOLIO</span>
            <span className="block text-xs font-semibold text-[#7FC7CF]">by Axiom</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-medium text-brand-100 hover:bg-white/10 hover:text-white">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 px-5 text-xs text-brand-100/80">
          <UserButton />
          <div className="min-w-0">
            <div className="truncate font-medium text-white">{name ?? email ?? "Signed in"}</div>
            {name && email && <div className="truncate">{email}</div>}
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {/* compact header for small screens, where the sidebar is hidden */}
        <div className="flex items-center justify-between gap-3 bg-brand-900 px-4 py-2 md:hidden">
          <Link href="/portfolios" className="flex items-center gap-2"><Mark className="h-6 w-6" /><Wordmark /></Link>
          <UserButton />
        </div>
        <div className="px-4 py-6 md:px-8">{children}</div>
      </main>
    </div>
  );
}
