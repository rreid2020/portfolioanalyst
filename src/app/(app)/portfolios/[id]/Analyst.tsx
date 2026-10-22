"use client";
// The Analyst tab: start a review, watch it stream with the lookups it makes, ask follow-ups,
// and download the conversation. Runs are saved, so the latest one is here when the tab reopens.
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AiBadge, Card } from "@/components/ui";
import { DEFAULT_QUESTION, MODELS, toolLabel } from "@/lib/analyst-shared";
import { filename, stamp, toHtml, toMarkdown, type ChatTurn } from "@/lib/report";
import Link from "next/link";
import type { RebalanceOptions } from "./Rebalancer";

type Meta = { analysisId?: number };
type Message = UIMessage<Meta>;
export type SavedAnalysis = { id: number; model: string; base: string; createdAt: string; messages: unknown[] };

const textOf = (m: Message) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("").trim();

function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm prose-slate max-w-none prose-headings:tracking-tight prose-a:text-brand-600 prose-table:text-[0.8125rem] prose-th:bg-slate-50 prose-th:px-2 prose-td:px-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{children}</ReactMarkdown>
    </div>
  );
}

/** "Fundamentals: AAPL ✓" chips for the lookups an answer made, spinning while they run. */
function Lookups({ message, live }: { message: Message; live: boolean }) {
  const tools = message.parts.filter(isToolUIPart);
  if (!tools.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Data the analyst looked up">
      {tools.map((p) => {
        const done = p.state === "output-available";
        const failed = p.state === "output-error";
        return (
          <span key={p.toolCallId} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.7rem] font-medium ring-1 ring-inset ${failed ? "bg-red-50 text-red-700 ring-red-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>
            {!done && !failed && live && <span className="h-2.5 w-2.5 animate-spin rounded-full border border-brand-600 border-t-transparent" aria-hidden="true" />}
            {toolLabel(getToolName(p), p.input)}
            {done && <span className="text-emerald-600" aria-hidden="true">✓</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Says plainly that what follows is written by an AI model, and what that means. */
function AiNotice({ model }: { model?: string }) {
  return (
    <p className="mb-3 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900 ring-1 ring-inset ring-violet-200">
      <strong className="font-semibold">AI-generated.</strong> {model ? `Written by ${model}` : "Reports are written by an AI model you choose"} from your portfolio&rsquo;s
      figures and its own lookups of fundamentals, ratings and news. It can be wrong or out of date: check anything important before acting.
      Informational only, not financial advice.
    </p>
  );
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function Analyst({ portfolioId, base, period, benchmark, saved, rebalance, withoutRebalance }: {
  /** null: all portfolios combined */
  portfolioId: number | null; base: string; period: string; benchmark: string; saved: SavedAnalysis | null;
  /** A plan from the Rebalance tab for a new run to comment on; `withoutRebalance` is this tab without it. */
  rebalance: RebalanceOptions | null; withoutRebalance: string;
}) {
  const [model, setModel] = useState<string>(saved?.model ?? MODELS[0].id);
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [followUp, setFollowUp] = useState("");
  // A plan sent from the Rebalance tab starts a new run rather than showing the saved one.
  const [run, setRun] = useState(() => (rebalance ? { key: 0, analysisId: undefined, createdAt: undefined, base }
    : { key: saved?.id ?? 0, analysisId: saved?.id, createdAt: saved?.createdAt, base: saved?.base ?? base }));
  // The transport reads these when it sends, so they're refs rather than state captured at creation.
  const live = useRef({ analysisId: run.analysisId, model, base: run.base });
  live.current.model = model;

  const transport = useMemo(
    () => new DefaultChatTransport<Message>({
      api: "/api/analyst",
      body: () => ({
        portfolioId, period, benchmark, model: live.current.model, base: live.current.base, analysisId: live.current.analysisId,
        ...(rebalance && !live.current.analysisId && { rebalance }),
      }),
    }),
    [portfolioId, period, benchmark, rebalance],
  );
  const { messages, sendMessage, status, error, stop, regenerate, setMessages } = useChat<Message>({
    id: `analysis-${portfolioId ?? "all"}-${run.key}`,
    messages: (saved && run.analysisId === saved.id ? saved.messages : []) as Message[],
    transport,
    onFinish: ({ message }) => {
      const id = message.metadata?.analysisId;
      if (id && !live.current.analysisId) {
        live.current.analysisId = id;
        setRun((r) => ({ ...r, analysisId: id, createdAt: r.createdAt ?? new Date().toISOString() }));
      }
    },
  });
  const busy = status === "submitted" || status === "streaming";
  const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

  // Only offered while there are no messages, so the current chat is empty and can take the run.
  function start() {
    live.current = { analysisId: undefined, model, base };
    setRun((r) => ({ ...r, analysisId: undefined, createdAt: new Date().toISOString(), base }));
    void sendMessage({ text: question.trim() || DEFAULT_QUESTION });
  }

  function newAnalysis() {
    stop();
    live.current = { analysisId: undefined, model, base };
    setRun({ key: Date.now(), analysisId: undefined, createdAt: undefined, base });
    setMessages([]);
  }

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!followUp.trim() || busy) return;
    void sendMessage({ text: followUp.trim() });
    setFollowUp("");
  }

  const [focus, first, ...rest] = messages;
  const reportMeta = { created: stamp(run.createdAt ?? new Date().toISOString()), model, base: run.base };
  const chat: ChatTurn[] = rest.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: textOf(m) }));
  const report = first ? textOf(first) : "";

  if (!messages.length)
    return (
      <Card title={<span className="flex items-center gap-2">Ask the analyst <AiBadge /></span>}>
        <div className="space-y-4 px-4 py-4">
          <p className="text-sm text-slate-600">
            The analyst reviews this portfolio&rsquo;s live figures, backtest, dividends and account placement in {base}, looks up
            fundamentals, analyst ratings and news, and writes a report with recommendations.
          </p>
          <AiNotice />
          <label className="block">
            <span className="text-xs font-medium text-slate-600">What should the analyst focus on?</span>
            <textarea className="input mt-1 block min-h-24 w-full" maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} />
          </label>
          {rebalance && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700 ring-1 ring-inset ring-brand-100">
              <span>Includes your rebalance plan ({rebalance.groupBy.toLowerCase()} targets, {rebalance.scope.toLowerCase()}{rebalance.cash ? `, ${rebalance.cash.toLocaleString("en-CA")} ${base} new cash` : ""}).</span>
              <Link href={withoutRebalance} className="text-xs font-medium underline">Leave it out</Link>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Model (via Vercel AI Gateway)</span>
              <select className="input mt-1 block" value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn" onClick={start}>Analyze portfolio</button>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
        </div>
      </Card>
    );

  return (
    <div className="space-y-4">
      <Card
        title={<span className="flex items-center gap-2">Analyst report <AiBadge /></span>}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!busy && report && (
              <>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(filename(reportMeta, "md"), "text/markdown", toMarkdown(reportMeta, report, chat))}>Markdown</button>
                <button type="button" className="btn btn-secondary btn-sm" title="Open the file in a browser and print it to save a PDF" onClick={() => download(filename(reportMeta, "html"), "text/html", toHtml(reportMeta, report, chat))}>HTML (print to PDF)</button>
              </>
            )}
            {busy ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => stop()}>Stop</button> : <button type="button" className="btn btn-secondary btn-sm" onClick={newAnalysis}>New analysis</button>}
          </div>
        }
      >
        <div className="px-4 py-4">
          <p className="mb-3 text-xs text-slate-500">
            {reportMeta.created} · {modelLabel(model)} · figures in {run.base}
            {focus && textOf(focus) !== DEFAULT_QUESTION && <> · Focus: {textOf(focus)}</>}
          </p>
          <AiNotice model={modelLabel(model)} />
          {first ? (
            <>
              <Lookups message={first} live={busy && !rest.length} />
              {report ? <Markdown>{report}</Markdown> : <p className="text-sm text-slate-500">Reviewing your portfolio…</p>}
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden="true" />Gathering the figures and starting the review…</p>
          )}
        </div>
      </Card>

      {(rest.length > 0 || (first && !busy)) && (
        <Card title={<span className="flex items-center gap-2">Follow-up questions <AiBadge /></span>}>
          <div className="space-y-4 px-4 py-4">
            {rest.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="ml-auto max-w-[85%] rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">{textOf(m)}</div>
              ) : (
                <div key={m.id}>
                  <Lookups message={m} live={busy && i === rest.length - 1} />
                  {textOf(m) ? <Markdown>{textOf(m)}</Markdown> : <p className="text-sm text-slate-500">Looking into it…</p>}
                </div>
              ),
            )}
            {busy && rest.at(-1)?.role === "user" && <p className="text-sm text-slate-500">Looking into it…</p>}
            <form onSubmit={ask} className="flex gap-2">
              <input className="input flex-1" value={followUp} maxLength={2000} disabled={busy} placeholder="Ask about this portfolio, e.g. what if I sold half my NVDA?" onChange={(e) => setFollowUp(e.target.value)} aria-label="Follow-up question" />
              <button className="btn" disabled={busy || !followUp.trim()}>Ask</button>
            </form>
          </div>
        </Card>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <span>The analyst couldn&rsquo;t finish: {error.message}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => regenerate()}>Try again</button>
        </div>
      )}
    </div>
  );
}
