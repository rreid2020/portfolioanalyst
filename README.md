# Stock Portfolio Analyst 📈

An AI-powered Stock Portfolio Analyst built with the [Agno](https://www.agno.com/) framework, using models through [Vercel AI Gateway](https://vercel.com/ai-gateway), and served via Streamlit. It takes your holdings (ticker, shares, average buy price), pulls live market data, and produces a full portfolio review: valuation, P/L, concentration, risk flags, and rebalancing ideas.

Adapted from [`simple_ai_agents/stock_portfolio_analyst`](https://github.com/Arindam200/awesome-ai-apps/tree/main/simple_ai_agents/stock_portfolio_analyst) in Arindam200/awesome-ai-apps (MIT License).

## 🚀 Features

- **Axiom sign-in**: everyone signs in with their Axiom account (the same Clerk login as ProjectCost) before using the app
- **Saved portfolios**: save the holdings table under a name, then load, rename or delete it later, from any device; each person sees only their own
- **Portfolio editor**: spreadsheet-style UI to enter/edit holdings
- **CSV / Excel import**: upload a broker holdings export (e.g. Wealthsimple's Holdings report) or your own sheet; columns are auto-detected, each account's type is read from an account type or name column, lots in the same account are merged, and Canadian listings get yfinance suffixes (`SHOP` on TSX → `SHOP.TO`)
- **Connect brokerage (optional)**: pull live holdings from Wealthsimple, Questrade, IBKR and other brokers through [SnapTrade](https://snaptrade.com/), read-only. You sign in on SnapTrade's page, so the app never sees your brokerage password
- **Live dashboard**: as soon as holdings are entered, figures are computed in code from live Yahoo Finance quotes: market value, cost basis, unrealized P/L and today's change, in CAD or USD at live FX rates (London pence handled). Allocation by holding, sector, country and currency, a gain/loss chart, and a positions table
- **Canadian accounts**: an Account column (TFSA, RRSP, FHSA, RRIF, RESP, RDSP, LIRA, Non-registered), filled in from CSV imports and brokerage connections; per-account value, P/L and dividend totals, and placement hints such as US dividends losing 15% withholding in a TFSA or FHSA (general rules, not tax advice)
- **Performance & risk**: a backtest of today's holdings over 1 month to 5 years against a benchmark (XIC, XEQT, S&P 500 or Nasdaq 100), in CAD or USD at daily FX with dividends reinvested; return, annualized volatility, beta, max drawdown, and a correlation heatmap of your holdings
- **Dividend income**: trailing 12-month dividends per holding, portfolio yield and expected annual income in your report currency
- **Rebalancing calculator**: set target weights by holding (including ones you don't own yet), sector or currency, for all accounts or one; add new cash; choose buy-only (no selling, cash goes to the most underweight first) and fractional or whole shares. Shows the trades, before/after weights, cash left and an estimated capital gain on non-registered sales. Informational only; no orders are placed
- **Verified numbers for the analyst**: the computed figures go into the analyst's prompt, so the report quotes them instead of doing its own arithmetic
- **Streaming report**: the analyst's review appears as it's written, with each data lookup (fundamentals, news, web search) listed in a status box
- **Follow-up chat**: ask questions about the report ("what if I sold half my NVDA?"); the analyst keeps the report and figures in context
- **Downloads**: save the report and follow-ups as Markdown, or as a styled HTML page that prints cleanly to PDF
- **Live market data**: prices, fundamentals, analyst ratings, news via YFinance
- **Web context**: DuckDuckGo search for market news not covered by YFinance
- **Math that adds up**: a Calculator tool keeps the agent honest on totals, weights, and P/L
- **Structured report**: tables for numbers, bullets for commentary
- **Model picker**: swap between Claude Sonnet 5.5, GPT-5 mini, Gemini 3 Flash, DeepSeek V4 Flash, and Llama 3.3 70B via Vercel AI Gateway

## 🛠️ Tech Stack

- **Framework**: [Agno](https://www.agno.com/)
- **Inference**: [Vercel AI Gateway](https://vercel.com/ai-gateway) (OpenAI-compatible endpoint)
- **Tools**: `YFinanceTools`, `DuckDuckGoTools`, `CalculatorTools`
- **UI**: Streamlit, themed to match the Axiom apps (navy sidebar, teal accent, Inter) through `.streamlit/config.toml` and `branding.py`

## 📋 Prerequisites

- Python 3.11+
- Vercel AI Gateway API key
- Optional: SnapTrade API keys for **Connect brokerage**
- Internet connection (for YFinance + DuckDuckGo)

## ⚡ Quick Start

```bash
cd simple_ai_agents/stock_portfolio_analyst

# Install dependencies
pip install -r requirements.txt
# or
uv pip install -r requirements.txt

# Configure your API key
cp .env.example .env
# then edit .env and paste your AI_GATEWAY_API_KEY

# Run the app
streamlit run main.py
```

Open the URL Streamlit prints (usually http://localhost:8501).

### Run as an ASGI app (same way Vercel runs it)

```bash
uvicorn asgi:app --port 8501
```

`asgi.py` wraps `main.py` with Streamlit's `st.App`, so `streamlit run main.py` keeps working too.

## ▲ Deploy to Vercel

The repo is ready to deploy as a Python project:

- `pyproject.toml` sets `[tool.vercel] entrypoint = "asgi:app"`
- `vercel.json` sets the function's `maxDuration` to 300s (the Hobby maximum; Pro allows up to 800s)
- `.vercelignore` keeps `.venv` and `.env` out of the upload

Steps:

1. Push this folder to a GitHub repo and import it in the Vercel dashboard (or run `vercel` from this folder with the Vercel CLI).
2. In **Project → Settings → Environment Variables**, add `AI_GATEWAY_API_KEY` (and the `SNAPTRADE_*` keys to enable **Connect brokerage**).
3. Make sure **Fluid compute** is on (default for new projects). WebSockets require it.
4. The installed dependencies are about 470 MB, close to Vercel's 500 MB maximum for a Python function (the build fails with `LAMBDA_SIZE_EXCEEDED` above it). Keep new dependencies small: for example, the database uses the pure-Python `pg8000` driver rather than SQLAlchemy and a compiled driver, which would add about 37 MB.
5. Deploy, then open the preview URL and run an analysis before adding a domain.

### Add a subdomain

1. **Project → Settings → Domains → Add**, enter e.g. `stocks.example.com`.
2. If the parent domain's DNS is on Vercel, it's configured automatically. Otherwise add the `CNAME` record Vercel shows (pointing to `cname.vercel-dns.com` or the project-specific value it displays) at your DNS provider.
3. Vercel issues the HTTPS certificate once DNS resolves.

### Limits to know

- Each browser tab is one WebSocket connection, which closes when the function hits `maxDuration` (5 min on Hobby). Streamlit reconnects automatically but starts a fresh session, so a report on screen is lost when that happens. An analysis must finish within that window.
- Cold starts are slow (large dependencies): after the function has been idle, the first page load waits for Vercel to start Python and load the packages, typically several seconds of a blank page titled "Streamlit". The sign-in page itself is kept light: `main.py` checks sign-in before importing pandas, the AI agent and the market-data libraries, and preloads those in the background while the sign-in page is up. A free uptime monitor pinging the site every few minutes keeps an instance warm if the first-load delay matters.
- Only signed-in Axiom users can run analyses on your AI Gateway key, but anyone can create an Axiom account unless sign-ups are restricted in Clerk (for example with an allowlist). Set a spend limit in AI Gateway too.

## 🔐 Sign-in and saved portfolios

The deployed app requires sign-in. It uses Streamlit's built-in sign-in (`st.login`) with Clerk as the OpenID Connect provider, in the **same Clerk instance as ProjectCost**, so one Axiom account works in both. Saved portfolios live in Postgres (Neon). Each row belongs to the signed-in user's Clerk user id, and every query is limited to that id.

**Without these settings the deployed app refuses to run** and shows "Sign-in isn't configured". Locally, with no Clerk settings, it runs as a single local user and saves portfolios to `.data/portfolios.db` (gitignored).

### 1. Clerk: add an OAuth application

1. In the Clerk Dashboard for the instance ProjectCost uses, open **OAuth applications → Add application**.
2. Name it (e.g. "Portfolio Analyst") and select the scopes `openid`, `email` and `profile`.
3. Add the redirect URI `https://<your app domain>/oauth2callback`. For local testing, also add `http://localhost:8501/oauth2callback`.
4. Copy the **Client ID** and **Client Secret**. The secret is shown only once.
5. Optional: turn off the consent screen for this app, since it's your own.
6. Note the instance's **Frontend API URL** (Dashboard → Domains or API keys). It looks like `https://clerk.axiomft.ca` for a production instance, or `https://<name>.clerk.accounts.dev` for a development instance. ProjectCost's sign-in page currently shows "Development mode". If it moves to a production instance, update `CLERK_ISSUER_URL` and create the OAuth application there.

### 2. Neon: add the database

In the Vercel project, open **Storage** (or the Marketplace), add **Neon Postgres** and connect it to this project. Vercel adds `DATABASE_URL` to the project's environment variables. The app creates its tables on first use.

### 3. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Value |
|---|---|
| `CLERK_OAUTH_CLIENT_ID` | the OAuth application's Client ID |
| `CLERK_OAUTH_CLIENT_SECRET` | its Client Secret |
| `CLERK_ISSUER_URL` | the Frontend API URL from step 1.6 |
| `APP_URL` | the app's public URL, e.g. `https://portfolio.axiomft.ca`. Defaults to the Vercel production URL |
| `DATABASE_URL` | set by the Neon integration |
| `AUTH_COOKIE_SECRET` | optional: a long random string for the session cookie. Derived from the client secret when unset |
| `CLERK_OAUTH_PROMPT` | optional: the OIDC `prompt` sent to Clerk, default `login`. Set it to `consent` if Clerk rejects `login` |

Redeploy after adding them. Sign-in sessions last 30 days (Streamlit's cookie).

`asgi.py` hands these to `st.App` as programmatic secrets (`auth_config.py`), so no `secrets.toml` is needed on Vercel. With `streamlit run main.py`, put the same values in `.streamlit/secrets.toml` under `[auth]` instead, or leave them out to run as the local user.

## 🔗 Connect brokerage (optional)

The **Connect brokerage** panel loads your current positions straight from your broker through [SnapTrade](https://snaptrade.com/brokerage-integrations), which supports Wealthsimple (stocks, ETFs, crypto, mutual funds), Questrade, Interactive Brokers, and many more. Wealthsimple has no public API; SnapTrade connects with your own Wealthsimple sign-in, entered on SnapTrade's connection portal.

- **Read-only.** Connections are created with `connectionType=read`, so they can't place trades.
- **No passwords here.** You sign in on SnapTrade's page. This app only ever holds a SnapTrade user id and secret.
- The panel is hidden until `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY` are set.

### Setup

1. Sign up at [dashboard.snaptrade.com](https://dashboard.snaptrade.com/) and create API keys.
2. Add them to `.env` (and to Vercel's environment variables when deployed):

   ```bash
   SNAPTRADE_CLIENT_ID=...
   SNAPTRADE_CONSUMER_KEY=...
   # Optional, see "Key types" below
   SNAPTRADE_KEY_TYPE=commercial
   ```

3. Restart the app, open **Connect brokerage**, click **Open connection portal**, then **Sign in to your brokerage ↗**. The link expires after 5 minutes.
4. When the brokerage is connected, SnapTrade sends that tab back to the app. Click **Load holdings** there. This replaces the holdings table with one row per ticker per account, labelled with the account type (TFSA, RRSP, ...) from SnapTrade.

Stocks, ETFs, ADRs and closed-end funds are loaded. Canadian listings get yfinance suffixes (`SHOP` on TSX → `SHOP.TO`, `RCI.B` → `RCI-B.TO`), the same way CSV import does. Options, crypto, bonds and mutual funds are skipped with a note, because yfinance can't price them by ticker. Paper accounts are ignored.

### Key types

- **Commercial key** (`SNAPTRADE_KEY_TYPE=commercial`, the default): each visitor gets their own SnapTrade user. Use it for a deployed app that other people may open. New keys are test keys; production keys need SnapTrade's KYC approval.
- **Personal key** (`SNAPTRADE_KEY_TYPE=personal`): the key belongs to your own SnapTrade account and is free. No users are registered, and **anyone who opens the app sees your holdings**. Use it only locally (`uvicorn asgi:app`) or behind Vercel Deployment Protection. SnapTrade's terms say a personal key must not be shared with other people.

### How a visitor's connection is kept

The app has no login, so with a commercial key:

- The first **Open connection portal** click registers a SnapTrade user named `portfolio-analyst-<unix time>-<random>`. Its id and secret are kept in the Streamlit session and, encrypted, in the page URL as `?brokerage=<token>`. The token is encrypted with a key derived from `SNAPTRADE_CONSUMER_KEY` and expires after an hour. Nothing is stored on disk or in a cookie.
- The portal opens in a new tab. When the brokerage is connected, SnapTrade redirects that tab back to the app with the token. The panel opens already connected, so you click **Load holdings** there and can close the original tab.
- The URL copy also covers Vercel recycling the session: the WebSocket closes at the function's max duration (5 min on Hobby), and a slow sign-in with 2FA can outlast it. The reconnected session reads the token and picks up the same SnapTrade user.
- While the token is in the URL, anyone with that exact URL can load those holdings for up to an hour, so don't share the URL mid-connection. Loading with **Disconnect after loading** (on by default) or clicking **Disconnect** deletes the SnapTrade user and its brokerage connection, and removes the token from the URL.
- Visitors reconnect on each visit. Users left behind by closed tabs are deleted the next time anyone connects, once they are more than an hour old (`STALE_USER_SECONDS` in `brokerage_sync.py`). Only ids with this app's prefix are touched.

### Pricing (checked October 2026)

From [snaptrade.com/pricing](https://snaptrade.com/pricing):

- **Build:** free, with up to 5 brokerage connections and real-time data.
- **Launch:** $100/month plus $2 per connected user per month (real-time), or $1 per user (daily data, read-only).
- **Personal keys:** currently free.

Positions are read with `get_all_account_positions`. SnapTrade's older `get_user_holdings` endpoint returns HTTP 410 for customers who signed up after May 11, 2026.

## 💡 How to Use

1. In the **Your Holdings** table, add one row per position: `Ticker`, `Shares`, `Avg Buy Price`, `Currency`, and optionally `Account` (TFSA, RRSP, FHSA...). Or fill it from **Import from CSV or Excel** or **Connect brokerage**.
2. Optionally tweak the focus question (e.g. _"Assess my tech concentration risk"_ or _"Which position looks most overvalued?"_).
3. Check the **Dashboard** below the table: totals, allocation, gains and losses, performance and risk against a benchmark, dividend income, and every position. The performance figures value today's holdings over the chosen period, so they show how this mix would have done rather than your actual returns. Pick CAD or USD under **Report currency** in the sidebar. A blank `Currency` means the average buy price is in the currency the ticker trades in.
4. Optionally, open **Rebalance** to plan trades toward target weights. Pick one account for trades you can place with that account's cash. The analyst comments on the plan if one is set.
5. Click **Analyze portfolio**.
6. Read the report as it streams in: holdings table with live prices and P/L, portfolio-level metrics, risk flags, and 3–5 rebalancing recommendations.
7. Ask follow-up questions in the box under the report, and download it as Markdown or HTML (open the HTML file and print it to save a PDF). The report and conversation last for the browser session.

## 🧪 Tests

```bash
python -m unittest discover -s tests
```

The brokerage tests replace SnapTrade's HTTP API with canned responses, so the real SDK still signs, sends and deserializes each request, and they drive the Streamlit UI with `AppTest`. They need no API keys.

## 🧠 What the Agent Does

1. Receives the dashboard's figures (`portfolio_metrics.py`, `portfolio_analytics.py`): per-position value, cost, P/L, weight, sector and country, totals in one currency, the FX rates used, the backtest's return, volatility, beta, drawdown and correlations for the selected period and benchmark, and dividend income.
2. Fetches fundamentals, analyst ratings, news and price history per ticker.
3. Comments on totals and sector, country and currency concentration using those figures.
4. Flags risks: over-concentration, stretched valuations, bad news, weak sentiment.
5. Produces actionable rebalancing suggestions.

## 📝 Notes

- Output is informational and **not** financial advice.
- YFinance data is delayed and can occasionally be rate-limited; re-run if a ticker fails to fetch. The dashboard caches quotes and FX rates for 5 minutes, and 5 years of daily history for an hour.

## 🔑 Getting a Vercel AI Gateway API Key

1. Go to your [Vercel dashboard](https://vercel.com/dashboard) and open the **AI Gateway** tab
2. Open **API Keys** and create a key
3. Paste it into your `.env` as `AI_GATEWAY_API_KEY`

To use another model, add any tool-capable model ID from the [AI Gateway model list](https://vercel.com/ai-gateway/models) to the picker in `main.py`.
