// Applies drizzle/ migrations to DATABASE_URL (Neon) or the local PGlite folder. Runs before each Vercel build.
import { closeDb, migrateDb } from "../src/db";

migrateDb()
  .then(() => console.log("Database is up to date."))
  .finally(closeDb);
