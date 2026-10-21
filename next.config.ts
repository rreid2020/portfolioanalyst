import type { NextConfig } from "next";

// The Python API (api/index.py) serves /api/py/*. On Vercel it's a function in this project; locally
// it runs beside `next dev` (npm run dev:api) and these rewrites send /api/py there.
const PY_DEV_URL = process.env.PY_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // lets a production build run beside `next dev` without overwriting its files (NEXT_DIST_DIR=.next-build)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // hide the "N" dev-tools badge in the corner while running locally (it never shows in production)
  devIndicators: false,
  // PGlite ships a WASM Postgres; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
  async rewrites() {
    return process.env.NODE_ENV === "development" ? [{ source: "/api/py/:path*", destination: `${PY_DEV_URL}/api/py/:path*` }] : [];
  },
};

export default nextConfig;
