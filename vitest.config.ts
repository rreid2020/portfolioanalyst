import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/web/**/*.test.ts"], env: { DATABASE_URL: "memory://" }, testTimeout: 30_000, hookTimeout: 120_000 },
});
