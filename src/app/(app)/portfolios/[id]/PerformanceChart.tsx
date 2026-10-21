"use client";
// Growth of the portfolio against its benchmark, both indexed to 100 at the period start.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Same values as the chart tokens in globals.css; SVG attributes don't resolve CSS variables everywhere.
const GAIN = "#008c99";
const BENCHMARK = "#94a3b8";
const GRID = "#e5e9ef";

type Point = { date: string; portfolio: number; benchmark?: number | null };

const month = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-CA", { month: "short", year: "2-digit" });
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

export function PerformanceChart({ series, benchmarkName }: { series: Point[]; benchmarkName: string }) {
  const hasBenchmark = series.some((p) => p.benchmark != null);
  const last = series.at(-1);
  return (
    <figure className="px-4 pb-3 pt-2">
      <figcaption className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-gain" />Portfolio{last && ` ${last.portfolio.toFixed(1)}`}</span>
        {hasBenchmark && (
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-benchmark" />{benchmarkName}{last?.benchmark != null && ` ${last.benchmark.toFixed(1)}`}</span>
        )}
        <span className="text-slate-400">Growth of 100</span>
      </figcaption>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={month} minTickGap={48} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis domain={[(min: number) => Math.floor(min / 5) * 5, (max: number) => Math.ceil(max / 5) * 5]} allowDecimals={false} tickCount={6} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              labelFormatter={(d) => day(String(d))}
              formatter={(v, name) => [Number(v).toFixed(1), name === "portfolio" ? "Portfolio" : benchmarkName]}
              contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: "#e2e8f0" }}
            />
            {hasBenchmark && <Line type="monotone" dataKey="benchmark" stroke={BENCHMARK} strokeWidth={2} dot={false} isAnimationActive={false} />}
            <Line type="monotone" dataKey="portfolio" stroke={GAIN} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
