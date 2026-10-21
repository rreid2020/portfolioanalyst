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

export async function py<T>(path: string, body?: unknown): Promise<T> {
  const token = await (await auth()).getToken();
  const h: Record<string, string> = { Accept: "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h["Content-Type"] = "application/json";
  // Preview deployments sit behind Vercel's protection; this lets the server call itself.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) h["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  let res: Response;
  try {
    res = await fetch(`${await baseUrl()}/api/py${path}`, {
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
}

export type Base = "CAD" | "USD";

export type Position = {
  ticker: string; account: string; name: string; shares: number; price: number; currency: string;
  value: number; cost: number | null; pl: number | null; plPct: number | null; dayChange: number | null;
  weightPct: number; sector: string; country: string;
};

export type Figures = {
  base: Base;
  totals: { value: number; cost: number | null; pl: number | null; plPct: number | null; dayChange: number | null; dayChangePct: number | null };
  fx: Record<string, number>;
  unpriced: string[];
  positions: Position[];
  byTicker: Position[];
  allocation: Record<string, { group: string; value: number; weightPct: number }[]>;
  accounts: string[];
};
