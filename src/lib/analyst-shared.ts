// Analyst settings shared by the route (server) and the Analyst tab (client).

/** Models offered through the Vercel AI Gateway, first is the default. Same list as the Streamlit app. */
export const MODELS = [
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
  { id: "openai/gpt-5-mini", label: "GPT-5 mini" },
  { id: "google/gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "meta/llama-3.3-70b", label: "Llama 3.3 70B" },
] as const;
export type ModelId = (typeof MODELS)[number]["id"];

export const DEFAULT_QUESTION = "Give me a full portfolio review: valuation, risk, concentration, and rebalancing recommendations.";

const TOOL_LABELS: Record<string, string> = {
  price: "Price",
  fundamentals: "Fundamentals",
  analystRatings: "Analyst ratings",
  news: "News",
  priceHistory: "Price history",
  webSearch: "Web search",
};

/** "Fundamentals: AAPL", "Web search: tsx outlook"... for the status lines under a running answer. */
export function toolLabel(name: string, input: unknown): string {
  const label = TOOL_LABELS[name] ?? name;
  const args = (input ?? {}) as { symbol?: unknown; query?: unknown };
  const subject = args.symbol ?? args.query;
  return typeof subject === "string" && subject ? `${label}: ${subject}` : label;
}
