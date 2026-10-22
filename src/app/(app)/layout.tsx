import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { UserButton } from "@clerk/nextjs";
import { Mark } from "@/components/AuthShell";
import { GuideButton, GuidePanel, GuideProvider } from "@/components/Guide";
import { Nav } from "@/components/Nav";
import { guideFor } from "@/lib/guide-facts";
import { listPortfolios } from "@/lib/portfolios";
import { requireUserProfile } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, email, name } = await requireUserProfile();
  const [portfolios, guide, jar] = await Promise.all([listPortfolios(userId), guideFor(userId), cookies()]);
  // Guide opens on its own until setup is finished; after that it remembers the user's choice.
  const guideCookie = jar.get("pf_guide")?.value;
  const setupDone = guide.steps.filter((s) => !s.monthly).every((s) => s.status === "done" || s.status === "skipped");
  const nav = portfolios.map((p) => ({ id: p.id, name: p.name }));

  return (
    <GuideProvider initialOpen={guideCookie ? guideCookie === "open" : !setupDone}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-brand-900 py-5 md:flex">
          <div className="mb-4 px-5">
            <Link href="/portfolios" className="flex items-center gap-2.5">
              <Mark className="h-7 w-7 shrink-0" />
              <span className="leading-tight">
                <span className="block text-base font-bold tracking-tight text-white">PORTFOLIO</span>
                <span className="block text-xs font-semibold text-[#7FC7CF]">by Axiom</span>
              </span>
            </Link>
          </div>
          <Suspense><Nav portfolios={nav} /></Suspense>
          <div className="mt-auto flex items-center gap-3 px-5 pt-4 text-xs text-brand-100/80">
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
            <Link href="/portfolios" className="flex items-center gap-2 font-bold tracking-tight text-white"><Mark className="h-6 w-6" />PORTFOLIO</Link>
            <div className="flex items-center gap-3">
              <GuideButton done={guide.done} total={guide.total} />
              <UserButton />
            </div>
          </div>
          <div className="hidden items-center justify-end gap-2 border-b border-slate-200 bg-white px-8 py-2 md:flex">
            <GuideButton done={guide.done} total={guide.total} />
          </div>
          <div className="px-4 py-6 md:px-8">{children}</div>
        </main>
        <GuidePanel steps={guide.steps} done={guide.done} total={guide.total} periodLabel={guide.periodLabel} />
      </div>
    </GuideProvider>
  );
}
