// The AI analyst, streamed with the Vercel AI SDK through the AI Gateway (AI_GATEWAY_API_KEY, or the
// deployment's OIDC token on Vercel). The first message of a run is replaced, for the model only, by the
// prompt Python builds from the portfolio's live figures; each run and its follow-ups are saved in Neon.
import { auth } from "@clerk/nextjs/server";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { createAnalysis, getAnalysis, saveMessages } from "@/lib/analyses";
import { analystTools, INSTRUCTIONS } from "@/lib/analyst";
import { DEFAULT_QUESTION, MODELS } from "@/lib/analyst-shared";
import { loadPortfolio } from "@/lib/portfolios";
import { pyClient, PyError } from "@/lib/py";

export const maxDuration = 300;

const MAX_STEPS = 12; // tool calls plus the final answer

const Body = z.object({
  messages: z.array(z.custom<UIMessage>((m) => typeof m === "object" && m !== null && "role" in m && "parts" in m)).min(1).max(100),
  portfolioId: z.number().int(),
  analysisId: z.number().int().optional(),
  model: z.enum(MODELS.map((m) => m.id) as [string, ...string[]]),
  base: z.enum(["CAD", "USD"]),
  period: z.string().max(10).optional(),
  benchmark: z.string().max(20).optional(),
});

// Plain text, which the chat client shows as the error message.
const fail = (status: number, message: string) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

function text(message: UIMessage) {
  return message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n").trim();
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return fail(401, "Sign in to use the analyst.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "That request isn't one the analyst understands.");
  const body = parsed.data;
  const call = await pyClient();

  let analysisId = body.analysisId;
  let prompt: string;
  try {
    if (analysisId != null) {
      const saved = await getAnalysis(userId, analysisId);
      if (!saved || saved.portfolioId !== body.portfolioId) return fail(404, "That analysis no longer exists.");
      prompt = saved.prompt;
    } else {
      const portfolio = await loadPortfolio(userId, body.portfolioId);
      if (!portfolio) return fail(404, "That portfolio no longer exists.");
      ({ prompt } = await call<{ prompt: string }>("/prompt", {
        holdings: portfolio.holdings,
        base: body.base,
        question: text(body.messages[0]) || DEFAULT_QUESTION,
        ...(body.period && { period: body.period }),
        ...(body.benchmark && { benchmark: body.benchmark }),
      }));
      analysisId = (await createAnalysis(userId, portfolio.id, { model: body.model, base: body.base, prompt, messages: body.messages }))!;
    }
  } catch (e) {
    if (e instanceof PyError) return fail(e.status === 422 ? 422 : 502, e.message);
    throw e;
  }

  // The model sees the full prompt where the user typed only their question.
  const [first, ...rest] = body.messages;
  const tools = analystTools(call);
  const result = streamText({
    model: body.model,
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages([{ ...first, parts: [{ type: "text", text: prompt }] }, ...rest], { tools }),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  let saved: () => void = () => {};
  after(new Promise<void>((resolve) => (saved = resolve)));
  const id = analysisId;
  return result.toUIMessageStreamResponse({
    originalMessages: body.messages,
    messageMetadata: ({ part }) => (part.type === "start" ? { analysisId: id } : undefined),
    onFinish: async ({ messages }) => {
      try {
        await saveMessages(userId, id, messages);
      } finally {
        saved();
      }
    },
    onError: (error) => (error instanceof Error ? error.message : "The analyst stopped unexpectedly."),
  });
}
