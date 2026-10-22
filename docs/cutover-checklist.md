# Phase 7: switching portfolioanalyst-rho.vercel.app to the Next.js app

Written 2026-10-21 for branch `nextjs-migration` (Phases 0–6 done). Production still serves the
Streamlit app from `main`; nothing here changes it until step C3.

Vercel project: **portfolioanalyst** (`prj_qsDiyyUkJS51ziCWwk4O1zF8pPYd`).
Branch preview: `portfolioanalyst-git-nextjs-migration-rreid2020s-projects.vercel.app`
(behind your Vercel login, like every preview on this project).

---

## A. Get the preview working (one-time)

| # | Do | Where |
|---|---|---|
| A1 | Add `CLERK_SECRET_KEY` = the `sk_test_…` key from ProjectCost's `.env.local` (same as this branch's local `.env.local`). Environment **Preview**, branch **nextjs-migration**. | Vercel → portfolioanalyst → Settings → Environment Variables |
| A2 | Optional, to test brokerage on the preview: add `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY` for **Preview** too (they're Production-only today). | same |
| A3 | Optional, only if the analyst fails on the preview with an AI Gateway authentication error: add `AI_GATEWAY_API_KEY` for **Preview**. (Vercel deployments normally reach the gateway with their own OIDC token, so try without it first.) | same |
| A4 | Redeploy the latest `nextjs-migration` deployment so it picks up the new variables (env changes don't apply to existing builds). | Vercel → Deployments → ⋯ → Redeploy |

Already in place for previews: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
`NEXT_PUBLIC_CLERK_SIGN_UP_URL` (branch-scoped), and the Neon variables (`DATABASE_URL` etc.,
shared with production, so the preview sees your real saved portfolios).

## B. Test on the preview

Open the preview while signed in to Vercel. Tick each one off.

**Sign-in and your existing data**
- [ ] B1. Visiting the preview shows the Axiom sign-in page with Clerk's form inside it (dev-mode banner is expected).
- [ ] B2. Sign in with your Axiom account (the one you use for ProjectCost). You land on **Portfolios**.
- [ ] B3. **Your portfolios saved in the Streamlit app are listed.** If the list is empty but you know you saved some, stop and see [User ids](#user-ids-if-b3-fails) below before going further.
- [ ] B4. Sign out from the avatar menu, then back in.

**Portfolios and holdings**
- [ ] B5. Open a saved portfolio: four tiles (market value, cost basis, P/L, today) show live numbers; CAD/USD switch changes them.
- [ ] B6. New portfolio → type two rows → Save → it opens with live figures.
- [ ] B7. Edit holdings → change a share count → Save changes → figures update; the list shows the new "Updated" date.
- [ ] B8. Import a real broker CSV/XLSX export (e.g. Wealthsimple holdings report): rows and account types fill in; warnings show.
- [ ] B9. Paste two rows copied from Excel into the Ticker column.
- [ ] B10. Rename and delete a test portfolio from the list; saving a new one under an existing name is refused.

**Dashboard tabs** (on a portfolio with several holdings and accounts)
- [ ] B11. Allocation: all five groupings.
- [ ] B12. Gain / loss: gains right in teal, losses left in orange.
- [ ] B13. Accounts: table and placement hints (a US stock in a TFSA should trigger one).
- [ ] B14. Performance & risk: try 1Y and 5Y and two benchmarks; chart hover shows dates and values; correlation grid.
- [ ] B15. Dividends and Positions tabs.

**Rebalance and analyst**
- [ ] B16. Rebalance: change a target, add a ticker you don't own, add new cash with buy-only, switch to Sector and one account.
- [ ] B17. Analyst: Analyze portfolio with the default model. Lookup chips appear, the report streams, tables render. **This is the first run against a real model.**
- [ ] B18. Ask a follow-up; reload the page; report and follow-up are still there.
- [ ] B19. Download Markdown and HTML; open the HTML and print to PDF.
- [ ] B20. From Rebalance, "Ask the analyst about this plan" → run → the report comments on the trades.
- [ ] B21. Try one other model (e.g. GPT-5 mini).

**Brokerage** (only if you did A2)
- [ ] B22. Edit holdings → Connect brokerage → sign in on SnapTrade's page → you're returned to the editor with the panel open → Load holdings.
- [ ] B23. Close the tab, come back later: "Load from brokerage" works without signing in to the broker again.
- [ ] B24. Disconnect.

**Speed** (the reason for the move)
- [ ] B25. After the preview has been idle for 15+ minutes, open it: the page and portfolio list appear right away; only the market-data panels wait (a few seconds on a cold Python function).
- [ ] B26. Leave a portfolio page open for 10 minutes, then click a tab: it works (no dropped session as in Streamlit).

### User ids (if B3 fails)

Saved portfolios hang off `users.id`. The Streamlit app stored the `sub` its Clerk OAuth application
returned; the new app uses the Clerk user id (`user_…`). Clerk documents these as the same value, so
B3 should pass. If it doesn't, check in the Neon SQL editor:

```sql
SELECT id, email, created_at FROM users ORDER BY created_at;
```

If your Streamlit-era row has a different id than the `user_…` row the new app just created for the
same email, move the portfolios across (replace both ids):

```sql
BEGIN;
UPDATE portfolios SET user_id = 'user_NEW' WHERE user_id = 'OLD_ID';
DELETE FROM users WHERE id = 'OLD_ID';
COMMIT;
```

Tell me if this happens and I'll add the mapping to the app for everyone instead.

## C. Switch production over

Do these in order, after section B passes.

| # | Do | Notes |
|---|---|---|
| C1 | Add for **Production**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_dGVuZGVyLWNvbGxpZS01NTMwLmNsZXJrLmFjY291bnRzLmRldiQ`), `CLERK_SECRET_KEY` (the same `sk_test_…`), `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`. | The Streamlit app ignores these, so adding them early is harmless. |
| C2 | Nothing to do for `CLERK_ISSUER_URL`: the Python API now takes the Clerk instance from the publishable key, so the Streamlit-era value can't get in the way (delete it in D2). Optionally add `CLERK_AUTHORIZED_PARTIES=https://portfolioanalyst-rho.vercel.app`. | |
| C3 | Merge `nextjs-migration` into `main` (I can open the pull request). | Vercel builds production: runs the database migrations (no-ops now; the tables already exist), builds Next.js, deploys the Python API. |
| C4 | In Vercel → Settings → Build and Deployment, set **Framework Preset** to **Next.js**. | `vercel.json` already overrides it per build; this makes the setting match. |
| C5 | Smoke-test https://portfolioanalyst-rho.vercel.app: sign in, open a portfolio, Performance tab, one analyst run. | Repeat B2, B3, B5, B14, B17 against production. |
| C6 | If anything is badly wrong: Vercel → Deployments → the last Streamlit production deployment → **Instant Rollback**. | Rolls back the code only; the env vars added in C1 don't affect Streamlit. Then fix on the branch and merge again. |

Things that stay the same: `DATABASE_URL` and the other Neon variables, `AI_GATEWAY_API_KEY`,
`SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`.

## D. Clean up (about a week after C5)

- [ ] D1. Delete the Clerk **OAuth application** the Streamlit app used (Clerk dashboard → Configure → OAuth applications).
- [ ] D2. Remove Production env vars `CLERK_OAUTH_CLIENT_ID`, `CLERK_OAUTH_CLIENT_SECRET` and `CLERK_ISSUER_URL`.
- [ ] D3. Remove the Streamlit code (I can do this as one PR): `main.py`, `asgi.py`, `dashboard.py`, `access.py`, `auth_config.py`, `branding.py`, `report.py`, `requirements-streamlit.txt`, `.streamlit/`, and the `AppTest` UI tests in `tests/` (their pure-logic tests stay). Update the README's Streamlit sections.
- [ ] D4. Clean old Streamlit-session SnapTrade users: already automatic (abandoned ones are deleted on the next connect).

## Known limits after cutover

- **Clerk development keys in production.** They work on `portfolioanalyst-rho.vercel.app`, but show
  a "Development mode" badge and have Clerk's development-instance user limits. When ProjectCost moves
  to a production Clerk instance, give this app a subdomain of the same domain (e.g.
  `portfolio.axiomft.ca`) and switch both apps' keys.
- **Cold Python function.** The first data request after a quiet spell takes a few seconds while
  pandas loads; the page itself no longer waits for it.
- **Still to build:** Phase 5b's value-history snapshots and Phase 5c's watchlist and weekly email.
