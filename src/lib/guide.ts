// Guided mode, as in ProjectCost: getting a portfolio set up, then a monthly review, as steps with
// checklists that tick themselves from the user's data. Pure: facts in, steps out (facts are gathered
// in guide-facts.ts).

export type GuideFacts = {
  period: string; // YYYY-MM, the month being reviewed
  periodLabel: string;
  portfolioId: number | null; // the most recently updated portfolio; step links open it
  portfolios: number;
  holdings: number;
  holdingsWithoutAccount: number;
  holdingsWithoutCost: number;
  brokerageAvailable: boolean; // SnapTrade keys are set on this deployment
  brokerageConnected: boolean;
  daysSinceUpdate: number | null; // since any portfolio was last saved
  updatedThisMonth: boolean;
  analysesThisMonth: number;
};

export type GuideCheck = { label: string; done: boolean; detail?: string; action?: { label: string; href: string } };
type Text = string | ((f: GuideFacts) => string);
export type GuideStepDef = {
  key: string;
  group: "Set up" | "Monthly review";
  title: Text;
  optional?: boolean;
  monthly?: boolean; // resets every month
  confirmable?: string; // label for a "mark done" confirmation when the data can't tell
  when?: (f: GuideFacts) => boolean; // shown only when this holds
  href: string | ((f: GuideFacts) => string);
  openLabel: Text;
  why: Text;
  how: (f: GuideFacts) => string[]; // **bold** marks UI names
  checks: (f: GuideFacts) => GuideCheck[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ago = (d: number | null) => (d == null ? "never" : d === 0 ? "today" : `${plural(d, "day")} ago`);
/** A view of the user's latest portfolio, or the new-portfolio page when there isn't one yet. */
const view = (f: GuideFacts, tab?: string) => (f.portfolioId == null ? "/portfolios/new" : `/portfolios/${f.portfolioId}${tab ? `?tab=${tab}` : ""}`);
const edit = (f: GuideFacts) => (f.portfolioId == null ? "/portfolios/new" : `/portfolios/${f.portfolioId}/edit`);

export const GUIDE_STEPS: GuideStepDef[] = [
  {
    key: "holdings", group: "Set up", title: "Add your holdings", href: (f) => (f.holdings ? "/portfolios" : "/portfolios/new"), openLabel: (f) => (f.holdings ? "Open portfolios" : "New portfolio"),
    why: "Everything here starts from what you own: one row per position, with the account it's in. Portfolio values them with live prices; nothing is ever traded.",
    how: (f) => [
      "On **Portfolios**, click **New portfolio**.",
      "Fill the table any way you like: type rows, paste them from a spreadsheet into the **Ticker** column, use **Import CSV or Excel** with your broker's holdings export (Wealthsimple, Questrade, IBKR and most others)" + (f.brokerageAvailable ? ", or **Connect brokerage**." : "."),
      "Canadian listings end in **.TO** (TSX) or **.V** (TSX Venture), e.g. SHOP.TO. Give the portfolio a name and click **Save portfolio**.",
    ],
    checks: (f) => [{
      label: "A saved portfolio with holdings", done: f.holdings > 0,
      detail: f.holdings ? `${plural(f.portfolios, "portfolio")}, ${plural(f.holdings, "holding")}` : undefined,
      action: f.holdings ? undefined : { label: "New portfolio", href: "/portfolios/new" },
    }],
  },
  {
    key: "accounts", group: "Set up", title: "Label each account", optional: true, href: edit, openLabel: "Edit holdings",
    why: "The account (TFSA, RRSP, FHSA, non-registered…) drives the per-account totals, the placement hints about withholding tax and the dividend credit, and the trades the rebalancer suggests.",
    how: () => [
      "Open the portfolio and click **Edit holdings**.",
      "Pick the **Account** for each row, then **Save changes**. Imports and brokerage connections fill it in for you.",
    ],
    checks: (f) => [{
      label: "Every holding has an account", done: f.holdings > 0 && f.holdingsWithoutAccount === 0,
      detail: f.holdingsWithoutAccount ? `${plural(f.holdingsWithoutAccount, "holding")} without one` : undefined,
    }],
  },
  {
    key: "costs", group: "Set up", title: "Add average buy prices", optional: true, href: edit, openLabel: "Edit holdings",
    why: "With your average buy price, Portfolio shows unrealized gain or loss per holding and account, and the rebalancer estimates the capital gain a sale would realize.",
    how: () => [
      "Open the portfolio and click **Edit holdings**.",
      "Enter the **Avg buy price** per share (your broker's book value ÷ shares) and its **Currency** if it isn't the listing's, then **Save changes**.",
    ],
    checks: (f) => [{
      label: "Every holding has a buy price", done: f.holdings > 0 && f.holdingsWithoutCost === 0,
      detail: f.holdingsWithoutCost ? `${plural(f.holdingsWithoutCost, "holding")} without one` : undefined,
    }],
  },
  {
    key: "brokerage", group: "Set up", title: "Connect your brokerage", optional: true, when: (f) => f.brokerageAvailable, href: edit, openLabel: "Edit holdings",
    why: "Loads your positions straight from your broker through SnapTrade, read-only, so updating each month is one click. You sign in on SnapTrade's page; Portfolio never sees your password.",
    how: () => [
      "Open a portfolio, click **Edit holdings**, then **Connect brokerage** and **Connect brokerage ↗**.",
      "Sign in to your broker on SnapTrade's page. It sends you back to the editor; click **Load holdings**, then **Save changes**.",
    ],
    checks: (f) => [{ label: "A brokerage is connected", done: f.brokerageConnected }],
  },
  {
    key: "refresh", group: "Monthly review", title: "Bring holdings up to date", monthly: true, href: edit, openLabel: "Edit holdings",
    why: "Values use live prices, but share counts are only as current as your last save. Update them after trades, contributions and DRIP purchases.",
    how: (f) => [
      f.brokerageConnected ? "In **Edit holdings**, click **Load from brokerage**, then **Load holdings** and **Save changes**." : "Import a fresh holdings export with **Import CSV or Excel**, or edit the share counts, then **Save changes**.",
    ],
    checks: (f) => [{ label: "Holdings saved this month", done: f.updatedThisMonth, detail: `Last saved ${ago(f.daysSinceUpdate)}` }],
  },
  {
    key: "review", group: "Monthly review", title: "Review the dashboard", monthly: true, href: (f) => view(f), openLabel: "Open dashboard", confirmable: "Allocation, performance and dividends reviewed",
    why: "A quick look each month catches drift: a holding that's grown too large, an account doing worse than its benchmark, income that's changed, or a placement hint worth acting on.",
    how: () => [
      "On the portfolio, check **Allocation** by holding, sector and currency for concentration.",
      "On **Performance & risk**, compare the last year against your benchmark, and look at volatility and drawdown.",
      "Check **Accounts** for placement hints and **Dividends** for expected income.",
    ],
    checks: () => [],
  },
  {
    key: "analyst", group: "Monthly review", title: "Ask the analyst", monthly: true, href: (f) => view(f, "analyst"), openLabel: "Open analyst",
    why: "The AI analyst reads the same figures, looks up fundamentals, analyst ratings and news, and writes a review with risk flags and recommendations. Informational only, not financial advice.",
    how: () => [
      "On the portfolio's **Analyst** tab, say what to focus on (or keep the full review), pick a model and click **Analyze portfolio**.",
      "Ask follow-ups underneath, and download the report as **Markdown** or **HTML** to print to PDF.",
    ],
    checks: (f) => [{ label: "A review this month", done: f.analysesThisMonth > 0, detail: f.analysesThisMonth ? plural(f.analysesThisMonth, "review") : undefined }],
  },
  {
    key: "rebalance", group: "Monthly review", title: "Plan a rebalance", optional: true, monthly: true, href: (f) => view(f, "rebalance"), openLabel: "Open rebalance", confirmable: "Plan reviewed",
    why: "Shows the trades that bring your holdings, sectors or currencies back to target, using new cash first if you like. Nothing is ever traded from here.",
    how: () => [
      "On the **Rebalance** tab, set targets (they start at today's weights), choose one account to get trades you can place there, and add any **new cash**.",
      "Optionally click **Ask the analyst about this plan** for a second opinion before trading at your broker.",
    ],
    checks: () => [],
  },
];

export type Mark = { stepKey: string; period: string; status: "DONE" | "SKIPPED" };
export type GuideStep = Omit<GuideStepDef, "checks" | "how" | "title" | "href" | "openLabel" | "why" | "when"> & {
  title: string; href: string; openLabel: string; why: string; how: string[];
  number: number;
  checks: GuideCheck[];
  status: "todo" | "partial" | "done" | "skipped";
  marked: Mark["status"] | null;
  period: string;
  doneCount: number;
  totalCount: number;
};

const text = (t: Text, f: GuideFacts) => (typeof t === "function" ? t(f) : t);

/** Steps with their checklists and status. A step is done when every check passes or the user marked it done; optional and monthly steps can be skipped. */
export function buildGuide(f: GuideFacts, marks: Mark[]): { steps: GuideStep[]; done: number; total: number } {
  const steps = GUIDE_STEPS.filter((def) => !def.when || def.when(f)).map((def, i): GuideStep => {
    const period = def.monthly ? f.period : "setup";
    const marked = marks.find((m) => m.stepKey === def.key && m.period === period)?.status ?? null;
    const checks = def.checks(f);
    const doneCount = checks.filter((c) => c.done).length + (def.confirmable && marked === "DONE" ? 1 : 0);
    const totalCount = checks.length + (def.confirmable ? 1 : 0);
    const allChecks = checks.every((c) => c.done);
    const status: GuideStep["status"] =
      marked === "SKIPPED" ? "skipped"
      : (allChecks && (!def.confirmable || marked === "DONE")) || (marked === "DONE" && !def.confirmable) ? "done"
      : doneCount > 0 ? "partial" : "todo";
    return {
      key: def.key, group: def.group, optional: def.optional, monthly: def.monthly, confirmable: def.confirmable,
      title: text(def.title, f), href: text(def.href, f), openLabel: text(def.openLabel, f), why: text(def.why, f), how: def.how(f),
      number: i + 1, checks, status, marked, period, doneCount, totalCount,
    };
  });
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return { steps, done, total: steps.length };
}
