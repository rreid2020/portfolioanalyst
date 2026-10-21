import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // "server-only" throws outside a React server build; tests run server code directly.
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js") } },
  test: { include: ["tests/web/**/*.test.ts"], env: { DATABASE_URL: "memory://" }, testTimeout: 30_000, hookTimeout: 120_000 },
});
