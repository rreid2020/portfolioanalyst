# Migration plan: Streamlit → Next.js

Status: Phase 0 (Python API) done on branch `nextjs-migration`; Phase 1 next. Written 2026-10-21 against commit `29cf95f`.

## Recommendation (short version)

**Migrate now, before Phase 5b/5c**, using a split where Python stays as a
stateless compute API and Next.js owns the UI, auth, the database and the AI
analyst. Estimated effort: **about 13–19 working days** (roughly three weeks
of focused work), during which the Streamlit app stays live at
portfolioanalyst-rho.vercel.app.

Why now rather than after 5b/5c: almost everything 5b and 5c add (a
per-user brokerage connection flow with a redirect round-trip, a value
history chart, a watchlist page, email digest settings, a cron job, HTML
email) is the kind of thing Streamlit makes awkward and Next.js makes
routine. Building it in Streamlit first means building the UI twice. The
backend half of 5b/5c (tables, snapshot job, digest job) is built once
either way, so it moves into the new stack at no extra cost. Details in
[Recommendation](#recommendation).

---

## 1. Target architecture

```
Browser
  │
  ├── Next.js (App Router, TypeScript) on Vercel ── same project, one domain
  │     ├── Clerk: <ClerkProvider>, embedded <SignIn/> / <SignUp/>, middleware
  │     ├── Pages: /sign-in, /sign-up, /(app)/portfolio, /rebalance, /analyst ...
  │     ├── Route handlers:
  │     │     /api/portfolios/*   saved portfolios CRUD (Drizzle + Neon)
  │     │     /api/analyst        Vercel AI SDK streamText → AI Gateway, tools
  │     │     /api/cron/*         snapshots (5b), weekly digest (5c, Resend)
  │     └── UI: shadcn/ui + Tailwind (as ProjectCost), Recharts, TanStack Table
  │
  └── Python functions (FastAPI, /api/py/*) on the same Vercel project
        stateless compute: quotes, FX, metrics, performance, dividends,
        placement hints, rebalance plan, file import, SnapTrade
  │
  Neon Postgres (existing database and tables)
```

### Decisions

**Frontend: Next.js App Router + shadcn/ui + Tailwind**, matching ProjectCost
so components, the Axiom theme and Clerk setup can be copied across.

**Auth: Clerk's Next.js SDK with the embedded `<SignIn/>` and `<SignUp/>`**
from the same Clerk instance as ProjectCost. This replaces the current OIDC
"OAuth application" route (`auth_config.py`, `st.login`, the auto-click
script in `access.py`). Things to check:

- *Domain.* A Clerk **production** instance only shares sessions across
  subdomains of its domain. To get one sign-in across both apps (and to use
  the embedded form at all on production keys), serve the new app from a
  subdomain such as `portfolio.axiomft.ca`, not `*.vercel.app`. A
  development instance works on any domain but shows the dev banner and has
  low user limits.
- *User ids.* Saved portfolios are keyed on `users.id`, which today is the
  OIDC `sub` from the Clerk OAuth application. Confirm it equals the Clerk
  user id (`user_...`) that `auth()` returns; if not, a one-off mapping by
  email is needed before cutover.
- Once the new app is live, delete the Clerk OAuth application and the
  `CLERK_OAUTH_*` variables.

**Database: Neon Postgres, same database and tables.** Next.js reads and
writes it with Drizzle on `@neondatabase/serverless` (HTTP driver, no cold
connection cost). Map the existing `users`, `portfolios`, `holdings` tables
in a Drizzle schema with `drizzle-kit pull` rather than recreating them, so
existing saved portfolios carry over untouched. New 5b/5c tables
(`brokerage_connections`, `value_snapshots`, `watchlist`, `digest_settings`)
are added as Drizzle migrations. The `user_id` scoping rule that `db.Store`
enforces moves into a small TS data-access module that takes the Clerk
user id from `auth()` and never from the request.

Ownership rule: **TypeScript owns user-facing CRUD; Python owns anything
holding a third-party secret.** The one exception to "Python is stateless"
is the SnapTrade user secret (Phase 5b), which Python encrypts with Fernet
today and should keep doing, writing its own `brokerage_connections` table.

**AI analyst: Vercel AI SDK** (`streamText` + `useChat`) through the AI
Gateway with the same model strings (`anthropic/claude-sonnet-5.5`,
`openai/gpt-5-mini`, ...). The agno agent becomes a `streamText` call with
the existing `INSTRUCTIONS` prompt and tools:

| agno tool today | AI SDK tool |
|---|---|
| YFinanceTools: price, fundamentals, analyst recs, news, history | `tool()`s that call `/api/py/research/*` (thin yfinance wrappers) |
| DuckDuckGoTools | `/api/py/research/search` wrapping `ddgs`, or a gateway-provided web search tool if available on the account |
| CalculatorTools | drop, or a tiny `mathjs` tool |

Tool-call progress ("Fundamentals: AAPL") comes from the tool parts in the
UI message stream, replacing `report.stream_text` / `tool_label`. Store the
analysis and follow-up chat in Neon (`analyses` table) so a report survives
a reload, which Streamlit session state never did.

### Where the Python logic lives: keep a Python API (decided)

| | Keep Python (FastAPI on Vercel) | Port to TypeScript |
|---|---|---|
| Market data | `yfinance`: quotes, `info` (sector, country, quoteType), 5-year `download` with dividends in one call, FX pairs. Already tested. | `yahoo-finance2` covers quote, quoteSummary and chart, but history + dividends + FX need rework and its Yahoo cookie/crumb handling breaks periodically, same as yfinance. |
| Math | pandas/numpy: returns, volatility, beta, drawdown, correlation, water-fill rebalancing. ~70 tests pass today. | Rewrite in plain TS arrays (or danfo.js). Low risk per function but ~900 lines and all the tests to redo. |
| SnapTrade | `snaptrade-python-sdk`, 19 tests on mapping positions to holdings. | `snaptrade-typescript-sdk` is equally complete; the mapping would be re-ported. |
| File import | pandas + openpyxl reads broker CSV/XLSX exports with header sniffing. | SheetJS can do it; header-sniffing logic re-ported. |
| Bundle size | Dropping `streamlit`, `pyarrow`, `altair`, `agno`, `openai`, `Authlib`, `markdown` leaves pandas, numpy, yfinance, ddgs, openpyxl, snaptrade, cryptography, fastapi: estimated **~150–200 MB**, well under the 500 MB limit (was ~470 MB). Verify on the first preview build. | No Python function at all. |
| Cold start | Python still cold-starts (~1–2 s for pandas) but only the data endpoints wait; the page shell and saved-portfolio list render instantly from Next.js with skeletons. Fluid compute keeps instances warm between requests. | Fastest, single runtime. |

The Python modules are already free of Streamlit except `dashboard.py`,
`branding.py`, `access.py` and `main.py`, so wrapping them is a small job,
and every pure-logic test keeps running unchanged. Porting to TS buys a
single runtime but costs roughly another 1.5–2 weeks for no user-visible
gain. Revisit only if Python cold starts on the data endpoints are still a
problem after Fluid compute.

Deployment: one Vercel project with the Next.js app at the root and
FastAPI at `api/index.py`, routed as `/api/py/*` (Vercel's
`nextjs-fastapi` layout). Locally, `next dev` proxies `/api/py` to
`uvicorn` via `rewrites`.

**Auth on the Python API:** the browser and Next.js call `/api/py/*` with
the Clerk session token; FastAPI verifies it networklessly against the
instance's JWKS public key (`CLERK_JWT_KEY`, PyJWT). No endpoint is public,
so nobody can use the deployment as a free yfinance proxy.

**Caching:** Streamlit's `@st.cache_data` (quotes and FX every 5 min,
history daily) becomes `Cache-Control: s-maxage` on GET endpoints keyed by
the ticker list, plus `fetch(..., { next: { revalidate } })` on the Next.js
side.

---

## 2. Feature inventory

Legend: **Reuse** = keep the Python module as-is behind an endpoint ·
**Port** = rewrite the logic in TS · **Rebuild** = new React UI ·
**Retire** = not needed.

| Module | What it does today | Plan |
|---|---|---|
| `main.py` | Sign-in gate + preload; sidebar (model picker, report currency CAD/USD, AI key warning); holdings `st.data_editor` with file upload and template download; saved-portfolio manager (save/load/rename/delete); brokerage panel; "Analyze" button streaming the agno report; follow-up chat; `parse_portfolio` / `format_prompt`. | **Rebuild** as pages + components. `INSTRUCTIONS`, `format_prompt` → **Port** to the analyst route (`format_prompt` stitches the markdown from the Python modules; the markdown itself comes from a `/api/py/context` endpoint). `parse_portfolio` validation → **Port** to a zod schema shared by editor and API. |
| `dashboard.py` | 4 metric tiles; 7 tabs (Allocation by holding/sector/country/currency, Gain/loss, Accounts, Performance & risk, Dividends, Rebalance, Positions); 5 Altair charts; rebalance target `data_editor`; cached fetch wrappers. | **Rebuild** in React. Charts → Recharts: allocation bar, P/L diverging bar, performance lines vs benchmark with end labels, income bar; correlation heatmap as a CSS grid (Recharts has no heatmap). Colour constants (`GAIN`, `LOSS`, ...) move to Tailwind theme tokens. `_fold` ("Other" bucket) and money/% formatting → **Port** (tiny). Cache wrappers → HTTP caching. |
| `portfolio_metrics.py` | yfinance quotes in a thread pool, FX, minor-unit currencies (GBp...), `compute()` → `Figures` (positions, totals, allocation), `to_markdown`. | **Reuse.** `POST /api/py/figures {holdings, base}` returns positions, totals, allocations, FX, unpriced list as JSON (and the markdown block for the analyst). |
| `portfolio_analytics.py` | 5-year history download, performance vs benchmark over periods, volatility/beta/drawdown, correlation, dividends (trailing income, yield, by account), `to_markdown`. | **Reuse.** `POST /api/py/performance {holdings, base, benchmark, period}` and `/api/py/dividends`. History download cached per symbol set. |
| `account_hints.py` | TFSA/RRSP/FHSA placement hints (US withholding, Canadian dividend credit), account summary, disclaimer. | **Reuse**, returned inside the dividends/accounts response. |
| `rebalance.py` | Target universe by holding/sector/currency, add new holding, water-fill buy-only mode, fractional rounding, per-account scope, trade list. | **Reuse.** `POST /api/py/rebalance {holdings, base, groupBy, scope, cash, buyOnly, fractional, targets}`. Adding a not-yet-held ticker needs a quote lookup: `GET /api/py/quote/{ticker}`. Debounce calls from the targets editor (~300 ms). |
| `report.py` | Stream agno events and label tool calls; analysis/chat data shapes; export report + chat as Markdown and styled HTML; filenames. | **Port** (small). Streaming → AI SDK. `to_markdown`/`to_html` → client-side download built from the stored messages (`marked` for HTML), keeping the Axiom HTML style block. |
| `portfolio_import.py` | Reads broker CSV/XLSX exports: header-row sniffing, column alias matching, book value → average price, exchange → `.TO`/`.V` suffixes, account normalisation; template CSV. | **Reuse.** `POST /api/py/import` (multipart) returns rows for the editor. Template CSV becomes a static file. `ACCOUNT_TYPES` and `COLUMNS` duplicated as TS constants (or served from `/api/py/meta`). |
| `brokerage_sync.py` | SnapTrade client, register/delete users, stale-user cleanup, Fernet-sealed user token in the URL, connection portal URL, positions → holdings mapping, personal-key mode. | **Reuse** the client calls and mapping; **rework** identity for 5b: the per-user SnapTrade user is stored encrypted in `brokerage_connections` keyed by Clerk user id, so the URL-token workaround (`seal_user` in the query string, `restore_brokerage_user`) and stale-user sweeping are retired. Endpoints: `POST /api/py/brokerage/connect` (portal URL), `POST /api/py/brokerage/holdings`, `DELETE /api/py/brokerage`. |
| `db.py` | pg8000/sqlite3 store bound to one user; schema creation; name validation; Neon URL → pg8000 args. | **Port** to Drizzle (TS) for portfolios/holdings; `_valid_name` → zod. Retire the SQLite fallback: local dev uses a Neon branch (free, per-developer). Python keeps a minimal pg8000 helper only for `brokerage_connections`. |
| `access.py` | Sign-in gate, local-user mode, background preload, sign-in page, account menu. | **Retire.** Clerk middleware (`clerkMiddleware` + `auth.protect()`), `<SignIn/>` page, `<UserButton/>`. "Fail closed on Vercel without settings" becomes: middleware throws if Clerk keys are missing. Local-user mode is replaced by Clerk dev keys. |
| `auth_config.py` | Builds `st.login` OIDC settings from `CLERK_OAUTH_*`. | **Retire.** |
| `branding.py` | Axiom colours, logo SVG, injected CSS, sidebar brand/facts, page header, eyebrow, sign-in panel. | **Rebuild** as Tailwind theme + `<Logo/>`, `<PageHeader/>`, `<Eyebrow/>`, sign-in side panel. Copy from ProjectCost where it already exists. |
| `asgi.py`, `vercel.json` | `st.App` entry, 300 s max duration. | **Replace** with `api/index.py` (FastAPI) and a Next.js `vercel.json` with per-function durations (`/api/analyst` 300 s, data endpoints 60 s) and cron entries. |

Also carried over: the `.TO/.V/.NE/.CN` Canadian listing convention, the
"not financial/tax advice" disclaimers, the "quotes delayed up to 15 min"
note, the AI Gateway key warning, and the README's setup sections.

---

## 3. What the move fixes, and what it costs

### Fixes

- **Cold start blank page.** Today a cold visit waits ~5 s on a blank
  Streamlit shell before anything renders. Next.js serves the shell, sign-in
  form and saved-portfolio list from the edge/Node runtime immediately;
  only the market-data panels wait on Python, behind skeletons.
- **Sessions dying at 300 s.** Streamlit holds each tab on a WebSocket that
  Vercel Hobby closes at the function's 300 s limit, losing session state
  (the reason for the sealed SnapTrade token in the URL). In Next.js every
  interaction is a short request; state lives in the URL, React state and
  Neon. Only the analyst stream is long, and it's one request well under
  300 s.
- **Sign-in can't be embedded.** Clerk's `<SignIn/>` renders inside the
  page, styled like ProjectCost; no redirect to an OAuth consent hop, no
  auto-click script.
- **Styling limits.** Full control of layout, typography, responsive
  behaviour and dark mode instead of CSS injected over Streamlit's DOM.
- Also: a lighter Python bundle (no 470 MB squeeze), real URLs per view
  (`/portfolio/[id]/rebalance`), and a natural home for 5b/5c's cron jobs
  and React Email templates.

### Costs

- **Size of the rewrite.** ~1,200 lines of Streamlit UI (`main.py`,
  `dashboard.py`, `branding.py`, `access.py`) become React. The ~1,700
  lines of logic are kept.
- **Charts.** Five Altair charts rebuilt in Recharts, including label
  placement details (end labels, diverging bars, padded domains). Shortcut
  if time is tight: `react-vega` renders the existing Vega-Lite specs that
  Altair produces, at the cost of a second charting style.
- **Data editors.** Two `st.data_editor` grids (holdings with dynamic rows,
  rebalance targets with a fixed "Current %" column and scale-to-100%)
  become editable TanStack Table grids with inputs, select for account,
  add/delete rows and validation. Paste-from-spreadsheet, which
  `data_editor` gives for free, is extra work; add it later if wanted.
- **Two runtimes** in one repo (pnpm + uv/pip), two test suites, and the
  JWT check between them.
- **Data endpoint cold starts** remain on the Python side (smaller than
  today, hidden behind skeletons).
- **Re-testing auth.** User id continuity for existing saved portfolios
  must be verified before cutover.

---

## 4. Phased order

The Streamlit app keeps serving production on its current project until
Phase 7. Build the new app in the same repo on a long-lived `next` branch
(or a `web/` folder) deployed as a **separate Vercel project** pointed at
the same Neon database (use a Neon branch for previews).

| Phase | Work | Effort |
|---|---|---|
| 0. Python API | Add `api/index.py` (FastAPI) wrapping metrics, analytics, hints, rebalance, import, research tools; Clerk JWT check; JSON serialisers for the dataclasses/DataFrames; trimmed `requirements.txt`; FastAPI `TestClient` tests. Can merge to `main` without touching Streamlit. | 1.5–2 d |
| 1. Shell + auth + data | Next.js app from ProjectCost's setup: Clerk provider, embedded sign-in/up pages, middleware, Axiom theme, layout and sidebar; Drizzle schema pulled from Neon; saved-portfolio list/load/save/rename/delete; verify user ids match. | 1.5–2.5 d |
| 2. Holdings | Editable holdings grid, account select, add/remove rows, validation, CSV/XLSX import via `/api/py/import`, template download, currency picker. | 2–3 d |
| 3. Dashboard | Metric tiles, tabs, allocation (4 views), gain/loss, accounts + hints, performance & risk (benchmark/period controls, correlation grid), dividends, positions table; loading skeletons and error states. | 3–4 d |
| 4. Analyst | `/api/analyst` with `streamText`, prompt and tools; model picker; tool progress; follow-up chat with `useChat`; analyses stored in Neon; Markdown/HTML downloads. | 2–3 d |
| 5. Rebalance | Controls (group by, account scope, cash, buy-only, fractional), targets grid, debounced plan calls, trades table, "send plan to analyst". | 1.5–2 d |
| 6. Brokerage | Connect/refresh/disconnect via Python endpoints with the 5b per-user storage built in (so this phase *is* the first half of 5b). | 1–2 d |
| 7. Cutover | Playwright smoke tests, Lighthouse check, point the domain at the new project, keep the Streamlit project up (unlinked) for a week, then delete it, the OAuth application and Streamlit-only code. | 0.5–1 d |
| **Total** | | **~13–19 d** |

Then 5b's second half (value snapshots: Vercel Cron → Python computes →
`value_snapshots`; history chart) and 5c (watchlist page, weekly digest:
Vercel Cron → TS route → React Email → Resend) are built directly on the
new stack.

Parity checkpoint before Phase 7: walk through every row of the feature
inventory above on the preview deployment with a real saved portfolio, in
both CAD and USD.

### Tests (88 passing today)

| File | Tests | Fate |
|---|---|---|
| `test_portfolio_metrics.py` | 11 | 9 pure-logic tests unchanged; 2 `AppTest` UI tests → API tests on `/figures` + Playwright |
| `test_portfolio_analytics.py` | 9 | unchanged |
| `test_accounts.py` | 8 | unchanged |
| `test_rebalance.py` | 15 | 13 unchanged; 2 `AppTest` → API tests on `/rebalance` + Playwright |
| `test_brokerage_sync.py` | 19 | mapping/client tests unchanged; 5 `AppTest` and the URL-token tests rewritten for DB-stored connections |
| `test_report.py` | 8 | streaming/label tests retired with agno; export tests ported to Vitest |
| `test_saved_portfolios.py` | 18 | `Store` behaviour (round trip, same-name replace, users isolated, rename/delete, name validation) ported to Vitest against a Neon test branch; Clerk config/gate/preload tests retired; middleware tests added |

Roughly **55–60 tests keep running as they are** (`pytest tests/`), about
15 are ported to Vitest, and the rest are replaced by FastAPI `TestClient`
tests and a short Playwright suite (sign in with a Clerk test user, load a
portfolio, see the dashboard, run a rebalance, start an analysis with a
mocked model). CI runs `pytest`, `vitest` and `next build` on each push.

---

## 5. Recommendation

Three options:

1. **Stay on Streamlit.** Cheapest today, but the cold-start blank page,
   the 300 s session loss and the non-embeddable sign-in are structural
   (they come from Streamlit's WebSocket model and `st.login`), and 5b/5c
   lean on exactly those weak spots: a brokerage redirect flow that must
   survive a dropped session, settings pages, a cron job and an email
   template. Not recommended unless the app stays a personal tool.
2. **Migrate after 5b/5c.** Ships 5b/5c sooner (perhaps a week earlier), but
   their UI gets written twice and the brokerage flow keeps the URL-token
   workaround a while longer. Net more work.
3. **Migrate now (recommended).** About three weeks, of which Phase 0 is
   useful on its own and Phase 6 already delivers half of 5b. The logic
   modules and most tests are kept, so the risk is mostly in UI parity,
   which the phased plan checks before switching the domain. 5b/5c then
   land on a stack that matches ProjectCost, sharing its Clerk setup,
   components and conventions.

Open questions to settle before Phase 1:

- Final domain (`portfolio.axiomft.ca`?) and whether ProjectCost's Clerk
  instance is moving to production keys.
- Whether Clerk's OIDC `sub` equals the Clerk user id for existing saved
  portfolios.
- Whether to put the new app in the same repo (`web/` + `api/`) or a fresh
  repo. Same repo is assumed above, so the Python modules and tests stay
  where they are.
