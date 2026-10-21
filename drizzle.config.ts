import { defineConfig } from "drizzle-kit";

// Only `drizzle-kit generate` is used (it needs no database). Migrations are applied by `npm run db:migrate`.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
