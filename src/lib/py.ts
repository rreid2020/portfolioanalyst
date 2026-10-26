import "server-only";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";

// Server-side calls to the Python API (api/index.py), signed with the user's Clerk session token.

export class PyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function baseUrl() {
  if (process.env.PY_API_URL) return process.env.PY_API_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8000";
  // On Vercel the API is a function in this same deployment.
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export type PyCall = <T>(path: string, body?: unknown) => Promise<T>;

/**
 * A caller bound to this request's user, usable after the request's own context is gone (e.g. by the
 * analyst's tools while a response streams). Session tokens are short-lived, so each call asks Clerk
 * for a current one.
 */
export async function pyClient(): Promise<PyCall> {
  const session = await auth();
  const base = await baseUrl();
  const fixed: Record<string, string> = { Accept: "application/json" };
  // Preview deployments sit behind Vercel's login. Passing on the visitor's cookies (Vercel's _vercel_jwt
  // among them) lets this server call itself as that visitor; the bypass secret works when it's set up.
  const cookie = (await headers()).get("cookie");
  if (cookie) fixed.Cookie = cookie;
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) fixed["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  return async <T,>(path: string, body?: unknown): Promise<T> => {
    const h = { ...fixed };
    const token = await session.getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined) h["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${base}/api/py${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new PyError("The market data service isn't reachable. Locally, start it with `npm run dev:api`.", 503);
    }
    if (!res.ok) {
      const detail = await res.json().then((j) => (typeof j?.detail === "string" ? j.detail : null)).catch(() => null);
      throw new PyError(detail ?? `The market data service answered ${res.status}.`, res.status);
    }
    return res.json() as Promise<T>;
  };
}

export async function py<T>(path: string, body?: unknown): Promise<T> {
  return (await pyClient())<T>(path, body);
}

// /meta never changes within a deployment, so each server instance asks once.
let meta: Promise<Meta> | null = null;
export function pyMeta(): Promise<Meta> {
  meta ??= py<Meta>("/meta").catch((e) => {
    meta = null; // try again next time
    throw e;
  });
  return meta;
}

export type Base = "CAD" | "USD";

export type Position = {
  ticker: string; account: string; name: string; shares: number; price: number; currency: string;
  value: number; cost: number | null; pl: number | null; plPct: number | null; dayChange: number | null;
  weightPct: number; sector: string; country: string;
  balanceOnly: boolean; // a managed account or other balance: shares are its balance, price 1
};

export type Figures = {
  base: Base;
  totals: { value: number; cost: number | null; pl: number | null; plPct: number | null; dayChange: number | null; dayChangePct: number | null };
  fx: Record<string, number>;
  pricesAsOf: string | null; // when the newest price traded, UTC ISO
  unpriced: string[];
  positions: Position[];
  byTicker: Position[];
  allocation: Record<string, { group: string; value: number; weightPct: number }[]>;
  accounts: string[];
  balances: string[]; // names of balance-only holdings
};

export type Hint = { account: string; title: string; detail: string; tickers: string[]; amount: number | null };

export type AccountRow = {
  account: string; holdings: number; value: number; cost: number | null; pl: number | null; plPct: number | null;
  weightPct: number; annualIncome: number;
};

export type DividendRow = {
  ticker: string; account?: string; dividendPerShare: number; currency: string; yieldPct: number | null; annualIncome: number | null;
};

export type Performance = {
  period: string; benchmark: string; benchmarkName: string; start: string; end: string;
  series: { date: string; portfolio: number; benchmark?: number | null }[];
  portfolioReturn: number; benchmarkReturn: number | null; annualizedReturn: number | null;
  volatility: number | null; beta: number | null; maxDrawdown: number; drawdownPeak: string; drawdownTrough: string;
  correlation: { tickers: string[]; matrix: (number | null)[][] };
  excluded: string[]; lateStarts: Record<string, string>;
};

/** Recent daily closes per ticker, for the mini trend charts. `period` is Yahoo's, e.g. "1mo". */
export type Trends = { period: string; trends: Record<string, { closes: number[]; changePct: number | null }> };

export type Analytics = {
  performance: Performance | null;
  dividends: { base: Base; rows: DividendRow[]; byTicker: DividendRow[]; totalIncome: number; portfolioYield: number | null } | null;
  hints: Hint[];
  accountSummary: AccountRow[];
};

export type Meta = {
  accountTypes: string[]; baseCurrencies: Base[]; benchmarks: { symbol: string; name: string; currency: string }[];
  periods: string[]; defaultBenchmark: string; defaultPeriod: string; disclaimer: string;
};
