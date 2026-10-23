import { describe, expect, it } from "vitest";
import { readPerformance } from "@/lib/risk-reading";
import { incomeByAccount } from "@/lib/dividends";
import type { Performance } from "@/lib/py";

const perf: Performance = {
  period: "1y", benchmark: "XIC.TO", benchmarkName: "XIC", start: "2025-10-23", end: "2026-10-23", series: [],
  portfolioReturn: 14.2, benchmarkReturn: 10.0, annualizedReturn: 14.2, volatility: 15.4, beta: 1.31,
  maxDrawdown: -18.5, drawdownPeak: "2026-02-10", drawdownTrough: "2026-04-08",
  correlation: { tickers: ["A", "B", "C"], matrix: [[1, 0.9, 0.2], [0.9, 1, 0.3], [0.2, 0.3, 1]] },
  excluded: [], lateStarts: {},
};

describe("risk readings", () => {
  const byTerm = Object.fromEntries(readPerformance(perf, "CAD").map((r) => [r.term, r.text]));

  it("compares the return with the benchmark", () => {
    expect(byTerm.Return).toContain("4.2 points ahead");
    expect(byTerm.Return).toContain("+14.2% a year");
  });

  it("puts volatility and beta in bands", () => {
    expect(byTerm.Volatility).toContain("typical for a stock portfolio");
    expect(byTerm.Beta).toContain("amplified");
  });

  it("turns the drawdown into dollars", () => {
    expect(byTerm["Max drawdown"]).toContain("$8,150");
  });

  it("names the most and least alike pair", () => {
    expect(byTerm.Correlation).toContain("A and B move most alike (0.90)");
    expect(byTerm.Correlation).toContain("A and C move least alike (0.20)");
  });

  it("skips figures that are missing", () => {
    const terms = readPerformance({ ...perf, beta: null, volatility: null, benchmarkReturn: null, annualizedReturn: null }, "CAD").map((r) => r.term);
    expect(terms).toEqual(["Return", "Max drawdown", "Correlation"]);
  });
});

describe("income by account", () => {
  it("sums positions per account, largest first, with yield on account value", () => {
    const rows = [
      { ticker: "RY.TO", account: "TFSA", dividendPerShare: 6, currency: "CAD", yieldPct: 4, annualIncome: 300 },
      { ticker: "AAPL", account: "RRSP", dividendPerShare: 1, currency: "USD", yieldPct: 0.5, annualIncome: 40 },
      { ticker: "ENB.TO", account: "TFSA", dividendPerShare: 3.7, currency: "CAD", yieldPct: 7, annualIncome: 500 },
      { ticker: "SHOP.TO", account: "TFSA", dividendPerShare: 0, currency: "CAD", yieldPct: 0, annualIncome: 0 },
    ];
    const accounts = [
      { account: "TFSA", holdings: 3, value: 20000, cost: null, pl: null, plPct: null, weightPct: 60, annualIncome: 800 },
      { account: "RRSP", holdings: 1, value: 8000, cost: null, pl: null, plPct: null, weightPct: 40, annualIncome: 40 },
    ];
    expect(incomeByAccount(rows, accounts)).toEqual([
      { account: "TFSA", income: 800, yieldPct: 4 },
      { account: "RRSP", income: 40, yieldPct: 0.5 },
    ]);
  });
});
