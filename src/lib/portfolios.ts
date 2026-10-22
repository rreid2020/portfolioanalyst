// One user's saved portfolios: the TypeScript port of db.Store. Every function takes the Clerk user id
// from the caller (requireUser), never from the request, and a portfolio id that belongs to someone
// else is treated as missing.
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { MAX_NAME } from "@/lib/limits";

const { users, portfolios, holdings } = schema;

/**
 * A position. With `balance` set it's a balance-only holding (a managed account, pension, GIC...):
 * `ticker` is its name, `balance` its value in `currency`, `avgBuyPrice` the total amount put in.
 */
export type Holding = {
  ticker: string;
  shares: number;
  avgBuyPrice: number | null;
  currency: string | null;
  account: string | null;
  balance?: number | null;
};

export type PortfolioSummary = { id: number; name: string; updatedAt: string; holdings: number };

export class PortfolioNameError extends Error {}

const now = () => new Date().toISOString();

export function validName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw new PortfolioNameError("Give the portfolio a name.");
  if (trimmed.length > MAX_NAME) throw new PortfolioNameError(`Portfolio names can be up to ${MAX_NAME} characters.`);
  return trimmed;
}

function need(userId: string) {
  if (!userId) throw new Error("A user id is required.");
}

/** Create the user row on first sign-in; keep email, name and last seen current. */
export async function touchUser(userId: string, email: string | null, name: string | null) {
  need(userId);
  const at = now();
  await db
    .insert(users)
    .values({ id: userId, email, name, createdAt: at, lastSeenAt: at })
    .onConflictDoUpdate({ target: users.id, set: { email, name, lastSeenAt: at } });
}

/** The user's row (email, name, last seen), or null before their first sign-in. */
export async function getUser(userId: string) {
  need(userId);
  const [row] = await db.select({ email: users.email, name: users.name, lastSeenAt: users.lastSeenAt }).from(users).where(eq(users.id, userId));
  return row ?? null;
}

/** Most recently updated first, with how many holdings each has. */
export async function listPortfolios(userId: string): Promise<PortfolioSummary[]> {
  need(userId);
  return db
    .select({ id: portfolios.id, name: portfolios.name, updatedAt: portfolios.updatedAt, holdings: count(holdings.id) })
    .from(portfolios)
    .leftJoin(holdings, eq(holdings.portfolioId, portfolios.id))
    .where(eq(portfolios.userId, userId))
    .groupBy(portfolios.id)
    .orderBy(desc(portfolios.updatedAt), desc(portfolios.id));
}

async function owned(userId: string, id: number) {
  if (!Number.isSafeInteger(id)) return null;
  const [row] = await db
    .select({ id: portfolios.id, name: portfolios.name, updatedAt: portfolios.updatedAt })
    .from(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)));
  return row ?? null;
}

type Cleaned = { position: number; ticker: string; shares: number; avgPrice: number | null; currency: string | null; account: string | null; balance: number | null };

function clean(rows: Holding[]): Cleaned[] {
  return rows.flatMap((h, i): Cleaned[] => {
    const avg = h.avgBuyPrice != null && Number.isFinite(h.avgBuyPrice) ? h.avgBuyPrice : null;
    const currency = (h.currency ?? "").trim().toUpperCase() || null;
    const account = (h.account ?? "").trim() || null;
    if (h.balance != null) {
      // A balance-only holding keeps its name as typed; its currency defaults to CAD.
      const name = (h.ticker ?? "").trim();
      if (!name || !Number.isFinite(h.balance)) return [];
      return [{ position: i, ticker: name, shares: 0, avgPrice: avg, currency: currency ?? "CAD", account, balance: h.balance }];
    }
    const ticker = (h.ticker ?? "").trim().toUpperCase();
    if (!ticker || h.shares == null || !Number.isFinite(h.shares)) return [];
    return [{ position: i, ticker, shares: h.shares, avgPrice: avg, currency, account, balance: null }];
  });
}

/** Save the holdings under `name`, replacing a portfolio of that name. */
export async function savePortfolio(userId: string, name: string, rows: Holding[]): Promise<{ id: number; replaced: boolean }> {
  need(userId);
  const valid = validName(name);
  const cleaned = clean(rows);
  const at = now();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(and(eq(portfolios.userId, userId), eq(portfolios.name, valid)));
    let id: number;
    if (existing) {
      id = existing.id;
      await tx.update(portfolios).set({ updatedAt: at }).where(eq(portfolios.id, id));
      await tx.delete(holdings).where(eq(holdings.portfolioId, id));
    } else {
      [{ id }] = await tx
        .insert(portfolios)
        .values({ userId, name: valid, createdAt: at, updatedAt: at })
        .returning({ id: portfolios.id });
    }
    if (cleaned.length) await tx.insert(holdings).values(cleaned.map((h) => ({ ...h, portfolioId: id })));
    return { id, replaced: Boolean(existing) };
  });
}

/** Replace one portfolio's name and holdings in place. False if it isn't this user's. */
export async function updatePortfolio(userId: string, id: number, name: string, rows: Holding[]): Promise<boolean> {
  need(userId);
  const valid = validName(name);
  const cleaned = clean(rows);
  return db.transaction(async (tx) => {
    const [mine] = await tx.select({ id: portfolios.id }).from(portfolios).where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)));
    if (!mine) return false;
    const [clash] = await tx
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(and(eq(portfolios.userId, userId), eq(portfolios.name, valid), ne(portfolios.id, id)));
    if (clash) throw new PortfolioNameError(`You already have a portfolio named "${valid}".`);
    await tx.update(portfolios).set({ name: valid, updatedAt: now() }).where(eq(portfolios.id, id));
    await tx.delete(holdings).where(eq(holdings.portfolioId, id));
    if (cleaned.length) await tx.insert(holdings).values(cleaned.map((h) => ({ ...h, portfolioId: id })));
    return true;
  });
}

/** Saving a new portfolio under a name that's taken would replace it; callers check first. */
export async function nameTaken(userId: string, name: string): Promise<boolean> {
  need(userId);
  const [row] = await db.select({ id: portfolios.id }).from(portfolios).where(and(eq(portfolios.userId, userId), eq(portfolios.name, name.trim())));
  return Boolean(row);
}

/** The portfolio and its holdings in their saved order, or null if it isn't this user's. */
export async function loadPortfolio(userId: string, id: number) {
  need(userId);
  const portfolio = await owned(userId, id);
  if (!portfolio) return null;
  const rows = await db
    .select({ ticker: holdings.ticker, shares: holdings.shares, avgBuyPrice: holdings.avgPrice, currency: holdings.currency, account: holdings.account, balance: holdings.balance })
    .from(holdings)
    .where(eq(holdings.portfolioId, id))
    .orderBy(asc(holdings.position));
  return { ...portfolio, holdings: rows as Holding[] };
}

/** Every holding in all the user's portfolios, for the combined view; newest portfolio first. */
export async function loadAllPortfolios(userId: string) {
  need(userId);
  const rows = await db
    .select({
      portfolioId: portfolios.id, updatedAt: portfolios.updatedAt,
      ticker: holdings.ticker, shares: holdings.shares, avgBuyPrice: holdings.avgPrice, currency: holdings.currency, account: holdings.account,
      balance: holdings.balance,
    })
    .from(portfolios)
    .innerJoin(holdings, eq(holdings.portfolioId, portfolios.id))
    .where(eq(portfolios.userId, userId))
    .orderBy(desc(portfolios.updatedAt), desc(portfolios.id), asc(holdings.position));
  return {
    portfolios: new Set(rows.map((r) => r.portfolioId)).size,
    updatedAt: rows[0]?.updatedAt ?? null,
    holdings: rows.map(({ ticker, shares, avgBuyPrice, currency, account, balance }) => ({ ticker, shares, avgBuyPrice, currency, account, balance })) as Holding[],
  };
}

export async function renamePortfolio(userId: string, id: number, newName: string): Promise<boolean> {
  need(userId);
  const valid = validName(newName);
  if (!(await owned(userId, id))) return false;
  const [clash] = await db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.userId, userId), eq(portfolios.name, valid), ne(portfolios.id, id)));
  if (clash) throw new PortfolioNameError(`You already have a portfolio named "${valid}".`);
  await db.update(portfolios).set({ name: valid, updatedAt: now() }).where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)));
  return true;
}

export async function deletePortfolio(userId: string, id: number): Promise<boolean> {
  need(userId);
  if (!(await owned(userId, id))) return false;
  // holdings go with it (ON DELETE CASCADE)
  await db.delete(portfolios).where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)));
  return true;
}

export async function countPortfolios(userId: string): Promise<number> {
  need(userId);
  const [{ n }] = await db.select({ n: count() }).from(portfolios).where(eq(portfolios.userId, userId));
  return n;
}
