// Plain-language readings of the Performance & risk figures, using the portfolio's own numbers.
// The bands are rough rules of thumb for a diversified stock portfolio, not a rating.
import type { Performance } from "@/lib/py";
import { date, money, num, pct, share } from "@/lib/format";

export type Reading = { term: string; text: string };

/** What each figure measures, for the "i" tips. */
export const RISK_TIPS = {
  return:
    "How much today's holdings would have gained or lost over the period, with dividends reinvested. It is a backtest of the current mix, not your actual history of buys and sells.",
  volatility:
    "How much the value swings, as a yearly percentage. In about two years out of three the result lands within this many points of the average year. Higher means a bumpier ride.",
  beta:
    "How strongly the portfolio follows the benchmark. 1.0 moves with it; 1.2 tends to move 20% more (up and down); 0.8 tends to move 20% less.",
  drawdown:
    "The largest drop from a high point to the low that followed, before it recovered. It shows the worst stretch you would have had to sit through.",
  annualized:
    "The steady yearly return that would compound to the same total over the period. Only shown for periods of a year or more.",
  correlation:
    "Each square compares two holdings' daily moves. Near 1, they rise and fall together, so owning both adds little diversification. Near 0, they move independently. Below 0, one tends to rise when the other falls.",
} as const;

function volatilityBand(v: number) {
  if (v < 10) return "low: closer to a balanced or bond-heavy portfolio";
  if (v < 20) return "typical for a stock portfolio";
  return "high: expect large swings in value";
}

function betaBand(b: number) {
  if (b < 0) return "it has tended to move against the benchmark";
  if (b < 0.8) return "it has been more defensive than the benchmark, falling less in sell-offs but often rising less in rallies";
  if (b <= 1.2) return "it has moved roughly in step with the benchmark";
  return "it has amplified the benchmark's moves, rising more in rallies and falling more in sell-offs";
}

function correlationReading(tickers: string[], matrix: (number | null)[][]): Reading | null {
  const pairs: { a: string; b: string; r: number }[] = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const r = matrix[i]?.[j];
      if (r != null && Number.isFinite(r)) pairs.push({ a: tickers[i], b: tickers[j], r });
    }
  }
  if (!pairs.length) return null;
  pairs.sort((x, y) => y.r - x.r);
  const avg = pairs.reduce((s, p) => s + p.r, 0) / pairs.length;
  const high = pairs[0];
  const low = pairs[pairs.length - 1];
  const level = avg >= 0.7 ? "high: most of your holdings move together, so they diversify each other less than the number of holdings suggests"
    : avg >= 0.4 ? "moderate: your holdings share the market's direction but still spread some risk"
    : "low: your holdings tend to move independently, which smooths the overall ride";
  let text = `The average correlation between your holdings is ${num(avg, 2)}, which is ${level}.`;
  if (pairs.length > 1) {
    text += ` ${high.a} and ${high.b} move most alike (${num(high.r, 2)}); ${low.a} and ${low.b} move least alike (${num(low.r, 2)}).`;
  }
  return { term: "Correlation", text };
}

export function readPerformance(p: Performance, base: string): Reading[] {
  const out: Reading[] = [];
  const bench = p.benchmarkName;
  let ret = `Over ${p.period}, today's holdings would have returned ${pct(p.portfolioReturn)}`;
  if (p.benchmarkReturn != null) {
    const gap = p.portfolioReturn - p.benchmarkReturn;
    ret += `, against ${pct(p.benchmarkReturn)} for ${bench}: ${num(Math.abs(gap), 1)} points ${gap >= 0 ? "ahead" : "behind"}.`;
  } else {
    ret += ".";
  }
  if (p.annualizedReturn != null) ret += ` That works out to about ${pct(p.annualizedReturn)} a year, compounded.`;
  out.push({ term: "Return", text: ret });

  if (p.volatility != null) {
    out.push({
      term: "Volatility",
      text: `At ${share(p.volatility)}, volatility is ${volatilityBand(p.volatility)}. In a typical year, expect the value to land within about ${num(p.volatility, 0)} points either side of its average return.`,
    });
  }
  if (p.beta != null) {
    out.push({
      term: "Beta",
      text: `A beta of ${num(p.beta, 2)} means that when ${bench} moved 1%, this mix moved about ${num(p.beta, 2)}% on average, so ${betaBand(p.beta)}.`,
    });
  }
  const left = 10000 * (1 + p.maxDrawdown / 100);
  out.push({
    term: "Max drawdown",
    text: p.maxDrawdown < 0
      ? `The worst stretch was a ${num(Math.abs(p.maxDrawdown), 1)}% fall from ${date(p.drawdownPeak)} to ${date(p.drawdownTrough)}: ${money(10000, base, { whole: true })} at the peak would have been ${money(left, base, { whole: true })} at the low. A useful test is whether you would have held on through that.`
      : "The portfolio never fell below a previous high during this period.",
  });
  const corr = correlationReading(p.correlation.tickers, p.correlation.matrix);
  if (corr) out.push(corr);
  return out;
}
