// Split-screen frame for the Clerk sign-in and sign-up pages, matching ProjectCost and the other Axiom apps:
// a dark brand panel on the left, the Clerk form on a light panel on the right.
import type { ReactNode } from "react";

export const authAppearance = {
  variables: {
    colorPrimary: "#0E7C86",
    colorText: "#12202F",
    fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-[0_10px_30px_rgba(0,32,74,0.12)] border border-[#D9E1EA]",
    formButtonPrimary: "font-semibold",
    footerActionLink: "font-semibold text-[#0E7C86]",
  },
};

/** Teal tile with a rising trend line, in the style of the ProjectCost mark. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="2" fill="#0E7C86" />
      <polyline points="5,17 10,12 13,14.5 19,7.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`font-bold tracking-tight ${dark ? "text-[#00204A]" : "text-white"}`}>
      PORTFOLIO <span className={`font-semibold ${dark ? "text-[#0E7C86]" : "text-[#7FC7CF]"}`}>by Axiom</span>
    </span>
  );
}

const FACTS: [string, string][] = [
  ["Sources", "Wealthsimple, Questrade, IBKR, CSV, Excel"],
  ["Output", "Valuation, risk, dividends, rebalancing"],
  ["Accounts", "TFSA, RRSP, FHSA, non-registered"],
  ["Access", "Your Axiom account"],
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#F2F4F7]">
      <aside className="hidden w-[58%] flex-col justify-between bg-[#00204A] p-12 text-[#DBE6F2] lg:flex">
        <div className="flex items-center gap-3 text-lg">
          <Mark className="h-7 w-7" />
          <Wordmark />
        </div>
        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">Know where every position stands.</h1>
          <p className="mt-5 text-[0.95rem] leading-relaxed">
            Live prices, performance, dividends and account-by-account views of the holdings you already have, with an AI analyst
            to review them. Read-only: nothing here places trades.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-white/15 pt-5">
            {FACTS.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[#7FC7CF]">{k}</dt>
                <dd className="mt-1 text-sm font-semibold text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Mark className="h-6 w-6" />
            <Wordmark dark />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[#12202F]">{title}</h2>
          <p className="mb-6 mt-2 text-sm text-slate-600">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
