// Bar lists and the correlation grid, drawn in plain HTML so they share the tables' type and spacing.
// Colours come from the chart tokens in globals.css (gain / loss / neutral).

export type Bar = { key: string; label: string; value: number; text: string; detail?: string };

export const MAX_BARS = 12; // longer lists fold their tail into "Other"

/** Keep the largest MAX_BARS - 1 and fold the rest into one "Other (n)" bar. */
export function fold<T extends { value: number }>(rows: T[], other: (tail: T[]) => T): T[] {
  if (rows.length <= MAX_BARS) return rows;
  return [...rows.slice(0, MAX_BARS - 1), other(rows.slice(MAX_BARS - 1))];
}

/**
 * One horizontal bar per row, value at the right. Bars grow from a shared baseline; with `diverging`
 * the baseline is zero, gains run right in teal and losses left in orange.
 */
export function BarList({ bars, diverging = false, label }: { bars: Bar[]; diverging?: boolean; label: string }) {
  const maxPos = Math.max(0, ...bars.map((b) => b.value));
  const maxNeg = diverging ? Math.max(0, ...bars.map((b) => -b.value)) : 0;
  const span = maxPos + maxNeg || 1;
  const zero = (maxNeg / span) * 100;
  return (
    <ul className="divide-y divide-slate-50 px-4 py-2" aria-label={label}>
      {bars.map((b) => {
        const width = (Math.abs(b.value) / span) * 100;
        const negative = b.value < 0;
        return (
          <li key={b.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 py-1.5 hover:bg-slate-50" title={b.detail ?? `${b.label}: ${b.text}`}>
            <span className="truncate text-sm text-slate-700">{b.label}</span>
            <span className="relative h-3.5" aria-hidden="true">
              {diverging && <span className="absolute inset-y-[-4px] w-px bg-slate-300" style={{ left: `${zero}%` }} />}
              <span
                className={`absolute inset-y-0 ${negative ? "rounded-l bg-loss" : "rounded-r bg-gain"}`}
                style={negative ? { right: `${100 - zero}%`, width: `${width}%` } : { left: `${zero}%`, width: `${Math.max(width, 0.5)}%` }}
              />
            </span>
            <span className="min-w-20 text-right text-sm tabular-nums text-slate-700">{b.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}
const NEUTRAL: [number, number, number] = [0xee, 0xf1, 0xf4];
const GAIN: [number, number, number] = [0x00, 0x8c, 0x99];
const LOSS: [number, number, number] = [0xc2, 0x57, 0x1a];

/** Pairwise correlations as a heat grid: teal toward +1, grey at 0, orange toward -1. */
export function CorrelationGrid({ tickers, matrix }: { tickers: string[]; matrix: (number | null)[][] }) {
  return (
    <div className="overflow-x-auto px-4 py-3">
      <table className="border-separate border-spacing-0.5 text-xs" aria-label="Correlation of daily returns">
        <thead>
          <tr>
            <th />
            {tickers.map((t) => <th key={t} scope="col" className="px-1 pb-1 text-center font-medium text-slate-600">{t}</th>)}
          </tr>
        </thead>
        <tbody>
          {tickers.map((row, i) => (
            <tr key={row}>
              <th scope="row" className="pr-2 text-right font-medium text-slate-600">{row}</th>
              {matrix[i].map((raw, j) => {
                const v = raw == null ? null : Math.abs(raw) < 0.005 ? 0 : raw; // no "-0.00"
                const value = v ?? 0;
                const strong = Math.abs(value) > 0.55;
                return (
                  <td
                    key={tickers[j]}
                    className={`h-9 min-w-12 rounded text-center tabular-nums ${strong ? "text-white" : "text-slate-800"}`}
                    style={{ background: i === j ? "#f8fafc" : mix(NEUTRAL, value >= 0 ? GAIN : LOSS, Math.min(Math.abs(value), 1)) }}
                    title={`${row} / ${tickers[j]}: ${v == null ? "n/a" : v.toFixed(2)}`}
                  >
                    {i === j ? "" : v == null ? "—" : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
