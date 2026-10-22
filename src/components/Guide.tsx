"use client";
import Link from "next/link";
import { createContext, useContext, useState } from "react";
import type { GuideStep } from "@/lib/guide";
import { markGuideStep, clearGuideStep } from "@/app/guide-actions";

type Ctx = { open: boolean; setOpen: (v: boolean) => void };
const GuideContext = createContext<Ctx>({ open: false, setOpen: () => {} });

export function GuideProvider({ initialOpen, children }: { initialOpen: boolean; children: React.ReactNode }) {
  const [open, setOpenState] = useState(initialOpen);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    document.cookie = `pf_guide=${v ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`;
  };
  return <GuideContext.Provider value={{ open, setOpen }}>{children}</GuideContext.Provider>;
}

export function GuideButton({ done, total }: { done: number; total: number }) {
  const { open, setOpen } = useContext(GuideContext);
  return (
    <button onClick={() => setOpen(!open)} aria-pressed={open}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${open ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
      Guide <span className="rounded bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600">{done}/{total}</span>
    </button>
  );
}

/** "Open **Accounts**" -> Open <strong>Accounts</strong> */
function Rich({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-slate-900">{part}</strong> : part))}</>;
}

function StatusIcon({ status }: { status: GuideStep["status"] }) {
  if (status === "done") return <span aria-label="Done" className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-[0.7rem] text-white">✓</span>;
  if (status === "skipped") return <span aria-label="Skipped" className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-slate-300 text-[0.7rem] text-slate-400">–</span>;
  if (status === "partial") return <span aria-label="In progress" className="h-5 w-5 shrink-0 rounded-full border-2 border-[#8A5A00] bg-[linear-gradient(90deg,#8A5A00_50%,transparent_50%)]" />;
  return <span aria-label="Not started" className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-300" />;
}

function StepForm({ action, step, status, label, className }: { action: (f: FormData) => Promise<void>; step: string; status?: string; label: string; className: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="step" value={step} />
      {status && <input type="hidden" name="status" value={status} />}
      <button className={className}>{label}</button>
    </form>
  );
}

const GROUPS = ["Set up", "Monthly review"] as const;
const btnSecondary = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50";

export function GuidePanel({ steps, done, total, periodLabel }: { steps: GuideStep[]; done: number; total: number; periodLabel: string }) {
  const { open, setOpen } = useContext(GuideContext);
  const firstOpen = steps.find((s) => s.status !== "done" && s.status !== "skipped")?.key ?? null;
  const [expanded, setExpanded] = useState<string | null>(firstOpen);
  if (!open) return null;
  const setupDone = steps.filter((s) => !s.monthly).every((s) => s.status === "done" || s.status === "skipped");
  const next = (key: string) => {
    const i = steps.findIndex((s) => s.key === key);
    setExpanded(steps.slice(i + 1).find((s) => s.status !== "done" && s.status !== "skipped")?.key ?? steps[i + 1]?.key ?? null);
  };

  return (
    <aside className="fixed inset-0 z-40 overflow-y-auto bg-white md:sticky md:inset-auto md:top-0 md:z-auto md:h-screen md:w-[23rem] md:shrink-0 md:border-l md:border-slate-200" aria-label="Guided mode">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-500">Guided mode</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{setupDone ? `Review ${periodLabel}` : "Set up Portfolio"}</h2>
          </div>
          <button onClick={() => setOpen(false)} className={btnSecondary}>Hide</button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-slate-600">{done} of {total} steps done · monthly steps reset each month</p>
      </div>

      {GROUPS.map((group) => (
        <section key={group}>
          <h3 className="px-4 pb-1 pt-4 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-500">{group}</h3>
          <ol>
            {steps.filter((s) => s.group === group).map((s) => {
              const isOpen = expanded === s.key;
              return (
                <li key={s.key} className={isOpen ? "border-l-4 border-brand-600 bg-slate-50" : "border-l-4 border-transparent"}>
                  <button onClick={() => setExpanded(isOpen ? null : s.key)} aria-expanded={isOpen}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                    <StatusIcon status={s.status} />
                    <span className="w-5 text-right text-xs tabular-nums text-slate-400">{s.number}</span>
                    <span className={`flex-1 ${isOpen ? "font-semibold text-slate-900" : "text-slate-800"}`}>
                      {s.title}{s.optional && <span className="ml-1.5 text-xs font-normal text-slate-400">optional</span>}
                    </span>
                    <span className="text-xs tabular-nums text-slate-400">{s.status === "skipped" ? "skipped" : `${s.doneCount}/${s.totalCount}`}</span>
                  </button>

                  {isOpen && (
                    <div className="grid gap-3 px-4 pb-4 pl-[3.25rem] text-sm text-slate-700">
                      <p className="leading-relaxed">{s.why}</p>
                      <div>
                        <p className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-500">How</p>
                        <ol className="mt-1 list-decimal space-y-1 pl-4 leading-relaxed">{s.how.map((h) => <li key={h}><Rich text={h} /></li>)}</ol>
                      </div>
                      {(s.checks.length > 0 || s.confirmable) && (
                        <div>
                          <p className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-slate-500">Checklist</p>
                          <ul className="mt-1 space-y-1.5">
                            {s.checks.map((c) => (
                              <li key={c.label} className="flex items-start gap-2">
                                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[0.6rem] ${c.done ? "bg-emerald-600 text-white" : "border-2 border-slate-300"}`}>{c.done ? "✓" : ""}</span>
                                <span>
                                  {c.label}
                                  {c.detail && <span className="block text-xs text-slate-500">{c.detail}</span>}
                                  {c.action && !c.done && <Link href={c.action.href} className="mt-1 inline-block rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50">{c.action.label}</Link>}
                                </span>
                              </li>
                            ))}
                            {s.confirmable && (
                              <li className="flex items-start gap-2">
                                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[0.6rem] ${s.marked === "DONE" ? "bg-emerald-600 text-white" : "border-2 border-slate-300"}`}>{s.marked === "DONE" ? "✓" : ""}</span>
                                <span>{s.confirmable}{s.monthly && <span className="block text-xs text-slate-500">This month</span>}</span>
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Link href={s.href} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">{s.openLabel}</Link>
                        <button onClick={() => next(s.key)} className={btnSecondary}>Next step</button>
                        {s.confirmable && s.marked !== "DONE" && <StepForm action={markGuideStep} step={s.key} status="DONE" label={`Mark done`} className={btnSecondary} />}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {s.marked && <StepForm action={clearGuideStep} step={s.key} label={s.marked === "SKIPPED" ? "Undo skip" : "Undo"} className="text-xs text-slate-500 underline" />}
                        {!s.marked && (s.optional || s.monthly) && s.status !== "done" &&
                          <StepForm action={markGuideStep} step={s.key} status="SKIPPED" label={s.monthly ? "Skip this month" : "Skip — not needed"} className={btnSecondary} />}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <p className="px-4 py-5 text-xs text-slate-500">Checklists tick themselves as you work. Monthly steps start fresh on the 1st.</p>
    </aside>
  );
}
