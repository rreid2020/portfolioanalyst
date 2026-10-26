// Analyst settings shared by the route (server) and the Analyst tab (client).

/**
 * Models offered through the Vercel AI Gateway, first is the default. Only models the Free AI
 * Gateway Credit covers (vercel.com/ai-gateway/models?freeTier=true) that are chat models with
 * tool use, since the analyst calls tools for prices, fundamentals and news. Toast 1 is left out:
 * its 4,000-token output limit can cut a full review short.
 */
export const MODELS = [
  // Recommended: the strongest of these for multi-step tool use and long reports.
  { id: "minimax/minimax-m3.1-flash", label: "MiniMax M3.1 Flash", recommended: true },
  { id: "inception/mercury-3", label: "Mercury 3" },
  { id: "nvidia/nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning (no credit used)" },
  { id: "inclusionai/ling-3.0-flash", label: "Ling 3.0 Flash" },
  { id: "inception/mercury-2.5", label: "Mercury 2.5" },
] as const;
export type ModelId = (typeof MODELS)[number]["id"];

/** Names for models earlier analyses were saved with, so their history still reads well. */
const PAST_MODEL_LABELS: Record<string, string> = {
  "anthropic/claude-sonnet-5.5": "Claude Sonnet 5.5",
  "openai/gpt-5-mini": "GPT-5 mini",
  "google/gemini-3-flash": "Gemini 3 Flash",
  "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
  "meta/llama-3.3-70b": "Llama 3.3 70B",
};

export function modelLabel(id: string) {
  return MODELS.find((m) => m.id === id)?.label ?? PAST_MODEL_LABELS[id] ?? id;
}

/** The model to continue with: the saved one if it is still offered, otherwise the default. */
export function availableModel(id: string | null | undefined): ModelId {
  return MODELS.find((m) => m.id === id)?.id ?? MODELS[0].id;
}

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
