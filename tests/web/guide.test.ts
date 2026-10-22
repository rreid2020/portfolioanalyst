import { describe, expect, it } from "vitest";
import { buildGuide, type GuideFacts } from "@/lib/guide";

const fresh: GuideFacts = {
  period: "2026-10", periodLabel: "October 2026", portfolioId: null, portfolios: 0, holdings: 0,
  holdingsWithoutAccount: 0, holdingsWithoutCost: 0, brokerageAvailable: false, brokerageConnected: false,
  daysSinceUpdate: null, updatedThisMonth: false, analysesThisMonth: 0,
};
const setUp: GuideFacts = {
  ...fresh, portfolioId: 7, portfolios: 1, holdings: 12, daysSinceUpdate: 2, updatedThisMonth: true,
};
const step = (g: ReturnType<typeof buildGuide>, key: string) => g.steps.find((s) => s.key === key)!;

describe("guide", () => {
  it("starts a new user at adding holdings", () => {
    const g = buildGuide(fresh, []);
    expect(step(g, "holdings").status).toBe("todo");
    expect(step(g, "holdings").href).toBe("/portfolios/new");
    expect(step(g, "analyst").href).toBe("/portfolios/new"); // nothing to analyze yet
    expect(g.done).toBe(0);
  });

  it("only shows the brokerage step where SnapTrade is set up", () => {
    expect(buildGuide(fresh, []).steps.map((s) => s.key)).not.toContain("brokerage");
    const g = buildGuide({ ...setUp, brokerageAvailable: true }, []);
    expect(step(g, "brokerage").status).toBe("todo");
    expect(buildGuide({ ...setUp, brokerageAvailable: true, brokerageConnected: true }, []).steps.find((s) => s.key === "brokerage")!.status).toBe("done");
  });

  it("ticks steps from the data and links to the latest portfolio", () => {
    const g = buildGuide({ ...setUp, holdingsWithoutCost: 3, analysesThisMonth: 1 }, []);
    expect(step(g, "holdings").status).toBe("done");
    expect(step(g, "accounts").status).toBe("done");
    expect(step(g, "costs").status).toBe("todo");
    expect(step(g, "costs").checks[0].detail).toBe("3 holdings without one");
    expect(step(g, "costs").href).toBe("/portfolios/7/edit");
    expect(step(g, "refresh").status).toBe("done");
    expect(step(g, "analyst").status).toBe("done");
    expect(step(g, "analyst").href).toBe("/portfolios/7?tab=analyst");
  });

  it("needs a confirmation for steps the data can't see, and honours skips for this month only", () => {
    const marks = [
      { stepKey: "review", period: "2026-10", status: "DONE" as const },
      { stepKey: "rebalance", period: "2026-09", status: "SKIPPED" as const },
      { stepKey: "costs", period: "setup", status: "SKIPPED" as const },
    ];
    const g = buildGuide({ ...setUp, holdingsWithoutCost: 3 }, marks);
    expect(step(g, "review").status).toBe("done");
    expect(step(g, "rebalance").status).toBe("todo"); // last month's skip doesn't carry over
    expect(step(g, "costs").status).toBe("skipped");
    expect(g.done).toBe(5); // holdings, accounts, costs (skipped), refresh, review
  });
});
