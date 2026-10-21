# Stock Portfolio Analyst 📈

An AI-powered Stock Portfolio Analyst built with the [Agno](https://www.agno.com/) framework, using models through [Vercel AI Gateway](https://vercel.com/ai-gateway), and served via Streamlit. It takes your holdings (ticker, shares, average buy price), pulls live market data, and produces a full portfolio review: valuation, P/L, concentration, risk flags, and rebalancing ideas.

Adapted from [`simple_ai_agents/stock_portfolio_analyst`](https://github.com/Arindam200/awesome-ai-apps/tree/main/simple_ai_agents/stock_portfolio_analyst) in Arindam200/awesome-ai-apps (MIT License).

## 🚀 Features

- **Portfolio editor**: spreadsheet-style UI to enter/edit holdings
- **Live market data**: prices, fundamentals, analyst ratings, news via YFinance
- **Web context**: DuckDuckGo search for market news not covered by YFinance
- **Math that adds up**: a Calculator tool keeps the agent honest on totals, weights, and P/L
- **Structured report**: tables for numbers, bullets for commentary
- **Model picker**: swap between Claude Sonnet 5.5, GPT-5 mini, Gemini 3 Flash, DeepSeek V4 Flash, and Llama 3.3 70B via Vercel AI Gateway

## 🛠️ Tech Stack

- **Framework**: [Agno](https://www.agno.com/)
- **Inference**: [Vercel AI Gateway](https://vercel.com/ai-gateway) (OpenAI-compatible endpoint)
- **Tools**: `YFinanceTools`, `DuckDuckGoTools`, `CalculatorTools`
- **UI**: Streamlit

## 📋 Prerequisites

- Python 3.10+
- Vercel AI Gateway API key
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
2. In **Project → Settings → Environment Variables**, add `AI_GATEWAY_API_KEY`.
3. Make sure **Fluid compute** is on (default for new projects). WebSockets require it.
4. The installed dependencies are ~540 MB, just over the 500 MB Python limit. New projects use large functions automatically; for an existing project, add the environment variable `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`.
5. Deploy, then open the preview URL and run an analysis before adding a domain.

### Add a subdomain

1. **Project → Settings → Domains → Add**, enter e.g. `stocks.example.com`.
2. If the parent domain's DNS is on Vercel, it's configured automatically. Otherwise add the `CNAME` record Vercel shows (pointing to `cname.vercel-dns.com` or the project-specific value it displays) at your DNS provider.
3. Vercel issues the HTTPS certificate once DNS resolves.

### Limits to know

- Each browser tab is one WebSocket connection, which closes when the function hits `maxDuration` (5 min on Hobby). Streamlit reconnects automatically but starts a fresh session, so a report on screen is lost when that happens. An analysis must finish within that window.
- Cold starts are slow (large dependencies); the first page load after idle can take 10–20s.
- Anyone with the URL can run analyses on your AI Gateway key. Add Vercel Deployment Protection or a password before sharing widely, and set a spend limit in AI Gateway.

## 💡 How to Use

1. In the **Your Holdings** table, add one row per position: `Ticker`, `Shares`, `Avg Buy Price (USD)`.
2. Optionally tweak the focus question (e.g. _"Assess my tech concentration risk"_ or _"Which position looks most overvalued?"_).
3. Click **Analyze Portfolio**.
4. Read the report: holdings table with live prices and P/L, portfolio-level metrics, risk flags, and 3–5 rebalancing recommendations.

## 🧠 What the Agent Does

1. Fetches live price + fundamentals + analyst ratings + news per ticker.
2. Computes market value, weight, and unrealized P/L for each position.
3. Rolls up portfolio totals and sector/asset concentration.
4. Flags risks: over-concentration, stretched valuations, bad news, weak sentiment.
5. Produces actionable rebalancing suggestions.

## 📝 Notes

- Output is informational and **not** financial advice.
- YFinance data is delayed and can occasionally be rate-limited; re-run if a ticker fails to fetch.

## 🔑 Getting a Vercel AI Gateway API Key

1. Go to your [Vercel dashboard](https://vercel.com/dashboard) and open the **AI Gateway** tab
2. Open **API Keys** and create a key
3. Paste it into your `.env` as `AI_GATEWAY_API_KEY`

To use another model, add any tool-capable model ID from the [AI Gateway model list](https://vercel.com/ai-gateway/models) to the picker in `main.py`.
