// The holdings editor's rows: text as typed, checked and turned into Holdings for saving.
// Shared by the client editor and its tests, so nothing here touches the database.
import type { Holding } from "@/lib/portfolios";

export type Row = { key: string; ticker: string; shares: string; avgBuyPrice: string; currency: string; account: string };
export const FIELDS = ["ticker", "shares", "avgBuyPrice", "currency", "account"] as const;
export type Field = (typeof FIELDS)[number];

let counter = 0;
export function newKey() {
  counter += 1;
  return `r${Date.now().toString(36)}${counter}`;
}

export function emptyRow(): Row {
  return { key: newKey(), ticker: "", shares: "", avgBuyPrice: "", currency: "", account: "" };
}

export function toRow(h: { ticker: string; shares: number | null; avgBuyPrice: number | null; currency: string | null; account: string | null }): Row {
  return {
    key: newKey(),
    ticker: h.ticker ?? "",
    shares: h.shares == null ? "" : String(h.shares),
    avgBuyPrice: h.avgBuyPrice == null ? "" : String(h.avgBuyPrice),
    currency: h.currency ?? "",
    account: h.account ?? "",
  };
}

function number(text: string): number | null | undefined {
  const t = text.replace(/[,$\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export type Checked = { holdings: Holding[]; errors: Record<string, Partial<Record<Field, string>>>; count: number };

/** Blank rows are skipped; every other row needs a ticker and a positive number of shares. */
export function checkRows(rows: Row[]): Checked {
  const holdings: Holding[] = [];
  const errors: Checked["errors"] = {};
  for (const r of rows) {
    if (FIELDS.every((f) => !r[f].trim())) continue;
    const e: Partial<Record<Field, string>> = {};
    const ticker = r.ticker.trim().toUpperCase();
    if (!ticker) e.ticker = "Enter a ticker";
    else if (!/^[A-Z0-9.\-^=]{1,20}$/.test(ticker)) e.ticker = "Letters, digits, . and - only";
    const shares = number(r.shares);
    if (shares == null || shares === undefined || shares <= 0) e.shares = "More than 0";
    const avg = number(r.avgBuyPrice);
    if (avg === undefined || (avg != null && avg < 0)) e.avgBuyPrice = "A price, or blank";
    const currency = r.currency.trim().toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) e.currency = "3 letters, e.g. CAD";
    if (Object.keys(e).length) {
      errors[r.key] = e;
      continue;
    }
    holdings.push({ ticker, shares: shares!, avgBuyPrice: avg ?? null, currency: currency || null, account: r.account.trim() || null });
  }
  return { holdings, errors, count: holdings.length + Object.keys(errors).length };
}

/** Rows from text copied out of a spreadsheet: tab-separated columns starting at `from`. */
export function pastedRows(text: string, from: Field): Partial<Record<Field, string>>[] {
  const start = FIELDS.indexOf(from);
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const cells = line.split("\t");
      const row: Partial<Record<Field, string>> = {};
      cells.forEach((cell, i) => {
        const field = FIELDS[start + i];
        if (field) row[field] = cell.trim();
      });
      return row;
    });
}
