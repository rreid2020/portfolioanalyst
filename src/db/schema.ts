// The tables the Streamlit app (db.py) created in Neon, unchanged, so saved portfolios carry over.
// Timestamps are ISO 8601 UTC text, as db.py writes them; they sort correctly as text.
import { bigint, doublePrecision, index, integer, jsonb, pgTable, text, unique, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  email: text("email"),
  name: text("name"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const portfolios = pgTable(
  "portfolios",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [unique("portfolios_user_id_name_key").on(t.userId, t.name), index("ix_portfolios_user").on(t.userId)],
);

export const holdings = pgTable(
  "holdings",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    portfolioId: bigint("portfolio_id", { mode: "number" }).notNull().references(() => portfolios.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    ticker: text("ticker").notNull(),
    shares: doublePrecision("shares").notNull(),
    avgPrice: doublePrecision("avg_price"),
    currency: text("currency"),
    account: text("account"),
  },
  (t) => [index("ix_holdings_portfolio").on(t.portfolioId)],
);

// AI analyst runs: the prompt built from the portfolio's figures, and the conversation as AI SDK UI
// messages (the first user message is the question as typed; the model saw `prompt` in its place).
export const analyses = pgTable(
  "analyses",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    portfolioId: bigint("portfolio_id", { mode: "number" }).notNull().references(() => portfolios.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    base: text("base").notNull(),
    prompt: text("prompt").notNull(),
    messages: jsonb("messages").notNull().$type<unknown[]>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("ix_analyses_portfolio").on(t.portfolioId, t.userId)],
);

// Each user's SnapTrade user, written and read only by the Python API (brokerage_store.py), which
// keeps the secret encrypted. Defined here so migrations create it and deleting a user removes it.
export const brokerageConnections = pgTable("brokerage_connections", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  snaptradeUserId: text("snaptrade_user_id").notNull(),
  sealedUser: text("sealed_user").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Guided mode: steps a user marked done or skipped, as in ProjectCost. period = "setup" for one-time
// steps, "YYYY-MM" for monthly ones.
export const guideMarks = pgTable(
  "guide_marks",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    period: text("period").notNull(),
    status: text("status").notNull(), // DONE | SKIPPED
    at: text("at").notNull(),
  },
  (t) => [uniqueIndex("guide_marks_user_step_period").on(t.userId, t.stepKey, t.period)],
);
