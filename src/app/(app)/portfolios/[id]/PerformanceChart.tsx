"use client";
// Growth of the portfolio against its benchmark, both indexed to 100 at the period start, plus
// optional lines per holding, account, sector or type (`lineNames`, read from l0, l1, ... in each point).
import { useState } from "react";
import { date, monthYear, num } from "@/lib/format";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Same values as the chart tokens in globals.css; SVG attributes don't resolve CSS variables everywhere.
const GAIN = "#008c99";
const BENCHMARK = "#94a3b8";
const GRID = "#e5e9ef";
// Group lines: distinct from the portfolio's teal and the benchmark's grey, in order of group size.
const GROUP_COLOURS = ["#3b6fd8", "#e07b28", "#8b5cf6", "#d1477a", "#7a8f1a", "#a0662b", "#1e3a8a", "#c03b3b", "#c9a227", "#6b5b95", "#e58fb5", "#3f9142"];

type Point = { date: string; portfolio: number; benchmark?: number | null } & Record<string, number | string | null | undefined>;
type Series = { key: string; name: string; colour: string; width: number; dashed?: boolean };

export function PerformanceChart({ series, benchmarkName, lineNames = [] }: { series: Point[]; benchmarkName: string; lineNames?: string[] }) {
  const hasBenchmark = series.some((p) => p.benchmark != null);
  const grouped = lineNames.length > 0;
  const last = series.at(-1);
  // With group lines the benchmark steps back to a dashed line so the groups read first.
  const all: Series[] = [
    { key: "portfolio", name: "Portfolio", colour: GAIN, width: grouped ? 3 : 2 },
    ...(hasBenchmark ? [{ key: "benchmark", name: benchmarkName, colour: BENCHMARK, width: 2, dashed: grouped }] : []),
    ...lineNames.map((name, i) => ({ key: `l${i}`, name, colour: GROUP_COLOURS[i % GROUP_COLOURS.length], width: 1.5 })),
  ];
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // A different grouping is a different set of lines; start with them all showing.
  const [shownFor, setShownFor] = useState(lineNames.join("|"));
  if (shownFor !== lineNames.join("|")) {
    setShownFor(lineNames.join("|"));
    setHidden(new Set());
  }
  const toggle = (key: string) => setHidden((h) => {
    const next = new Set(h);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const nameOf = Object.fromEntries(all.map((s) => [s.key, s.name]));

  return (
    <figure className="px-4 pb-3 pt-2">
      <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {all.map((s) => {
          const value = last?.[s.key];
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key} type="button" onClick={() => toggle(s.key)} aria-pressed={!off}
              title={off ? `Show ${s.name}` : `Hide ${s.name}`}
              className={`flex items-center gap-1.5 rounded px-1 hover:bg-slate-50 ${off ? "text-slate-400 line-through" : ""}`}
            >
              <span className="h-0.5 w-4 rounded" style={{ backgroundColor: off ? "#cbd5e1" : s.colour, height: s.width >= 2 ? 3 : 2 }} />
              {s.name}{typeof value === "number" && ` ${num(value, 1)}`}
            </button>
          );
        })}
        <span className="text-slate-400">Growth of 100{grouped && " · click a name to hide or show it"}</span>
      </figcaption>
      <div className={grouped ? "h-96" : "h-72"}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={monthYear} minTickGap={64} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis domain={[(min: number) => Math.floor(min / 5) * 5, (max: number) => Math.ceil(max / 5) * 5]} allowDecimals={false} tickCount={6} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              labelFormatter={(d) => date(String(d))}
              formatter={(v, key) => [num(Number(v), 1), nameOf[String(key)] ?? String(key)]}
              itemSorter={(item) => -Number(item.value ?? 0)}
              contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: "#e2e8f0" }}
            />
            {/* Drawn last-first so the portfolio line sits on top. */}
            {[...all].reverse().map((s) => (
              <Line
                key={s.key} type="monotone" dataKey={s.key} name={s.key} hide={hidden.has(s.key)}
                stroke={s.colour} strokeWidth={s.width} strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={false} activeDot={s.key === "portfolio" ? { r: 4, strokeWidth: 2, stroke: "#fff" } : { r: 3 }} isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
