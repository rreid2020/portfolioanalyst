// Saved AI analyst runs, one user's at a time, like portfolios.ts. A run belongs to a portfolio;
// deleting the portfolio deletes its runs.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

const { analyses, portfolios } = schema;

export type Analysis = {
  id: number; portfolioId: number | null; model: string; base: string; prompt: string; messages: unknown[]; createdAt: string; updatedAt: string;
};

const columns = {
  id: analyses.id, portfolioId: analyses.portfolioId, model: analyses.model, base: analyses.base, prompt: analyses.prompt,
  messages: analyses.messages, createdAt: analyses.createdAt, updatedAt: analyses.updatedAt,
};

/** Start a run for one of the user's portfolios (null: all of them combined); null if the portfolio isn't theirs. */
export async function createAnalysis(
  userId: string, portfolioId: number | null, run: { model: string; base: string; prompt: string; messages: unknown[] },
): Promise<number | null> {
  if (portfolioId != null) {
    const [mine] = await db.select({ id: portfolios.id }).from(portfolios).where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));
    if (!mine) return null;
  }
  const at = new Date().toISOString();
  const [{ id }] = await db
    .insert(analyses)
    .values({ userId, portfolioId, ...run, createdAt: at, updatedAt: at })
    .returning({ id: analyses.id });
  return id;
}

export async function getAnalysis(userId: string, id: number): Promise<Analysis | null> {
  if (!Number.isSafeInteger(id)) return null;
  const [row] = await db.select(columns).from(analyses).where(and(eq(analyses.id, id), eq(analyses.userId, userId)));
  return row ?? null;
}

/** The portfolio's (or, for null, the combined view's) most recent run, to show when its Analyst tab opens. */
export async function latestAnalysis(userId: string, portfolioId: number | null): Promise<Analysis | null> {
  const [row] = await db
    .select(columns)
    .from(analyses)
    .where(and(portfolioId == null ? isNull(analyses.portfolioId) : eq(analyses.portfolioId, portfolioId), eq(analyses.userId, userId)))
    .orderBy(desc(analyses.updatedAt), desc(analyses.id))
    .limit(1);
  return row ?? null;
}

export async function saveMessages(userId: string, id: number, messages: unknown[]): Promise<boolean> {
  const rows = await db
    .update(analyses)
    .set({ messages, updatedAt: new Date().toISOString() })
    .where(and(eq(analyses.id, id), eq(analyses.userId, userId)))
    .returning({ id: analyses.id });
  return rows.length > 0;
}
