import "server-only";
// The AI analyst: its instructions and the lookups it can make. The figures it reviews are computed
// in Python (/api/py/prompt); these tools fetch what the figures don't cover, through /api/py/research.
import { tool } from "ai";
import { z } from "zod";
import type { PyCall } from "@/lib/py";

export const INSTRUCTIONS = `You are an expert Stock Portfolio Analyst.

Your job is to analyze a user's stock portfolio and produce a clear,
actionable report. For every portfolio you receive, you should:

1. The message includes figures already computed in code from live
   quotes: each position's price, market value, cost, unrealized P/L,
   weight, sector and country, portfolio totals in one base currency,
   the FX rates used, and allocation by sector, country and currency.
   Treat these figures as authoritative. Quote them; do not re-fetch
   prices or recompute them. Tickers ending in .TO, .V, .NE or .CN are
   Canadian listings.
2. Use the tools for what the figures don't cover: fundamentals,
   analystRatings, news and priceHistory. Use price only for tickers
   listed as having no live price.
3. Where the figures have no P/L for a position (unknown average buy
   price), say so rather than estimating one. Positions are listed per
   account (TFSA, RRSP, FHSA, Non-registered...). When account placement
   hints are included, mention the relevant ones, describe them as general
   Canadian tax rules rather than tax advice, and never tell the user to
   move money in a way that triggers a withdrawal or over-contribution.
4. Summarize portfolio-level metrics from the figures: total cost basis,
   total market value, total unrealized P/L, and sector, country and
   currency concentration. When the message includes a backtest (return
   vs benchmark, volatility, beta, max drawdown, correlations) and
   dividend income, use those too, and say that the backtest values
   today's holdings over the period rather than the user's actual returns.
5. Call out risk flags: over-concentration in a single ticker or
   sector, high P/E relative to peers, recent negative news, or
   weak analyst sentiment. Use webSearch when you need broader
   market context that the other tools do not cover. When the message
   includes a proposed rebalance (the user's own targets), comment on it:
   whether the trades fit the risk and concentration picture, tax or
   account considerations, and anything to check before trading. Don't
   invent different trades.
6. Finish with a short "Recommendations" section: 3-5 bullet points
   on rebalancing ideas, positions worth trimming, and positions
   worth adding to. Be specific but always remind the user this is
   informational, not financial advice.

Formatting rules:
- Use Markdown tables for all numerical data (holdings, fundamentals,
  analyst recommendations).
- Use bullet points for qualitative commentary.
- Keep the tone professional and concise.`;

const symbol = z.string().min(1).max(20).describe("Ticker symbol, e.g. AAPL or SHOP.TO");

/** A failed lookup goes back to the model as a short error it can mention, not an exception. */
async function lookup(call: PyCall, path: string) {
  try {
    return await call<unknown>(path);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function analystTools(call: PyCall) {
  const q = (params: Record<string, string | number | boolean>) =>
    new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return {
    price: tool({
      description: "Current price, currency and previous close for a ticker. Only for tickers with no live price in the figures.",
      inputSchema: z.object({ symbol }),
      execute: ({ symbol }) => lookup(call, `/research/price?${q({ symbol })}`),
    }),
    fundamentals: tool({
      description: "Company profile and valuation: sector, market cap, P/E, forward P/E, P/B, PEG, dividend yield, EPS, beta, margins, growth, 52-week range.",
      inputSchema: z.object({ symbol }),
      execute: ({ symbol }) => lookup(call, `/research/fundamentals?${q({ symbol })}`),
    }),
    analystRatings: tool({
      description: "Analyst recommendation counts (strong buy to strong sell) by month.",
      inputSchema: z.object({ symbol }),
      execute: ({ symbol }) => lookup(call, `/research/recommendations?${q({ symbol })}`),
    }),
    news: tool({
      description: "Recent news stories about a company.",
      inputSchema: z.object({ symbol, limit: z.number().int().min(1).max(10).default(5) }),
      execute: ({ symbol, limit }) => lookup(call, `/research/news?${q({ symbol, limit })}`),
    }),
    priceHistory: tool({
      description: "Daily, weekly or monthly closing prices over a period.",
      inputSchema: z.object({
        symbol,
        period: z.enum(["1mo", "3mo", "6mo", "1y", "2y", "5y", "ytd", "max"]).default("6mo"),
        interval: z.enum(["1d", "1wk", "1mo"]).default("1wk"),
      }),
      execute: ({ symbol, period, interval }) => lookup(call, `/research/history?${q({ symbol, period, interval })}`),
    }),
    webSearch: tool({
      description: "Search the web, or recent news with news=true, for market context the other tools don't cover.",
      inputSchema: z.object({ query: z.string().min(2).max(300), news: z.boolean().default(false) }),
      execute: ({ query, news }) => lookup(call, `/research/search?${q({ q: query, news, limit: 5 })}`),
    }),
  };
}
