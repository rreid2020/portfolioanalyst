import { describe, expect, it } from "vitest";
import { analystTools } from "@/lib/analyst";
import { toolLabel } from "@/lib/analyst-shared";

// The tools only build /api/py/research URLs; a fake caller records them.
function fake(reply: (path: string) => unknown) {
  const calls: string[] = [];
  const call = async <T,>(path: string) => {
    calls.push(path);
    return reply(path) as T;
  };
  return { calls, tools: analystTools(call) };
}

const ctx = { toolCallId: "t", messages: [] } as never;

describe("analyst tools", () => {
  it("look things up through the research endpoints", async () => {
    const { calls, tools } = fake(() => ({ ok: true }));
    await tools.fundamentals.execute!({ symbol: "SHOP.TO" }, ctx);
    await tools.priceHistory.execute!({ symbol: "AAPL", period: "1y", interval: "1wk" }, ctx);
    await tools.webSearch.execute!({ query: "TSX banks & outlook", news: true }, ctx);
    expect(calls).toEqual([
      "/research/fundamentals?symbol=SHOP.TO",
      "/research/history?symbol=AAPL&period=1y&interval=1wk",
      "/research/search?q=TSX+banks+%26+outlook&news=true&limit=5",
    ]);
  });

  it("hand a failed lookup back to the model as an error, not an exception", async () => {
    const { tools } = fake(() => { throw new Error("No news for ZZZZ."); });
    expect(await tools.news.execute!({ symbol: "ZZZZ", limit: 5 }, ctx)).toEqual({ error: "No news for ZZZZ." });
  });

  it("label lookups for the status chips", () => {
    expect(toolLabel("fundamentals", { symbol: "AAPL" })).toBe("Fundamentals: AAPL");
    expect(toolLabel("webSearch", { query: "tsx outlook" })).toBe("Web search: tsx outlook");
    expect(toolLabel("somethingNew", {})).toBe("somethingNew");
  });
});
