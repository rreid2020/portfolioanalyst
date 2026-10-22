import "server-only";
import { cache } from "react";
import { and, count, desc, eq, gte, isNull, or } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { buildGuide, type GuideFacts, type Mark } from "./guide";

/** The month being reviewed: the current calendar month. */
export function currentPeriod(now: Date) {
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { period, start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), label: now.toLocaleDateString("en-CA", { month: "long", year: "numeric" }) };
}

const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

/** Everything the guide needs, in a few cheap queries run in parallel. Memoized per request. */
export const guideFor = cache(async (userId: string, now = new Date()) => {
  const { period, start, label } = currentPeriod(now);
  const P = s.portfolios, H = s.holdings;
  const mine = eq(P.userId, userId);
  const brokerageAvailable = Boolean(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
  const personalKey = (process.env.SNAPTRADE_KEY_TYPE ?? "").trim().toLowerCase() === "personal";

  const [marks, latest, portfolios, holdings, withoutAccount, withoutCost, connections, analysesThisMonth] = await Promise.all([
    db.select({ stepKey: s.guideMarks.stepKey, period: s.guideMarks.period, status: s.guideMarks.status }).from(s.guideMarks).where(eq(s.guideMarks.userId, userId)),
    db.select({ id: P.id, updatedAt: P.updatedAt }).from(P).where(mine).orderBy(desc(P.updatedAt), desc(P.id)).limit(1),
    one(db.select({ n: count() }).from(P).where(mine)),
    one(db.select({ n: count() }).from(H).innerJoin(P, eq(P.id, H.portfolioId)).where(mine)),
    one(db.select({ n: count() }).from(H).innerJoin(P, eq(P.id, H.portfolioId)).where(and(mine, or(isNull(H.account), eq(H.account, ""))))),
    one(db.select({ n: count() }).from(H).innerJoin(P, eq(P.id, H.portfolioId)).where(and(mine, isNull(H.avgPrice)))),
    brokerageAvailable && !personalKey ? one(db.select({ n: count() }).from(s.brokerageConnections).where(eq(s.brokerageConnections.userId, userId))) : Promise.resolve(0),
    one(db.select({ n: count() }).from(s.analyses).where(and(eq(s.analyses.userId, userId), gte(s.analyses.createdAt, start)))),
  ]);
  const lastSaved = latest[0]?.updatedAt ?? null;
  const facts: GuideFacts = {
    period, periodLabel: label,
    portfolioId: latest[0]?.id ?? null,
    portfolios, holdings, holdingsWithoutAccount: withoutAccount, holdingsWithoutCost: withoutCost,
    brokerageAvailable, brokerageConnected: personalKey ? brokerageAvailable : connections > 0,
    daysSinceUpdate: lastSaved ? Math.floor((now.getTime() - new Date(lastSaved).getTime()) / 86_400_000) : null,
    updatedThisMonth: lastSaved != null && lastSaved >= start,
    analysesThisMonth,
  };
  return { ...buildGuide(facts, marks as Mark[]), periodLabel: label };
});
