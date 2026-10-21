// The tables the Streamlit app (db.py) created in Neon, unchanged, so saved portfolios carry over.
// Timestamps are ISO 8601 UTC text, as db.py writes them; they sort correctly as text.
import { bigint, doublePrecision, index, integer, pgTable, text, unique } from "drizzle-orm/pg-core";

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
