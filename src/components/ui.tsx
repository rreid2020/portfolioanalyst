// Small building blocks shared by the app pages: the same components as ProjectCost's src/components/ui.tsx,
// so the two apps look and behave alike.
import Link from "next/link";

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[0.7rem] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, back, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; back?: { href: string; label: string }; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && <Link href={back.href} className="text-xs text-brand-600 hover:underline">← {back.label}</Link>}
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: React.ReactNode }) {
  const cls = tone === "error" ? "bg-red-50 text-red-800 ring-red-200" : tone === "warn" ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-brand-50 text-brand-700 ring-brand-100";
  return <div className={`rounded-md px-3 py-2 text-sm ring-1 ring-inset ${cls}`}>{children}</div>;
}

/** Marks features whose content is written by an AI model. */
export function AiBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-inset ring-violet-200 ${className}`} title="Written by an AI model">
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" aria-hidden="true"><path fill="currentColor" d="M8 0l1.8 5.2L15 7l-5.2 1.8L8 14l-1.8-5.2L1 7l5.2-1.8z" /></svg>
      AI
    </span>
  );
}
