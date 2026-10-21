// The tables the Streamlit app (db.py) created in Neon, unchanged, so saved portfolios carry over.
// Timestamps are ISO 8601 UTC text, as db.py writes them; they sort correctly as text.
import { bigint, doublePrecision, index, integer, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";

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
