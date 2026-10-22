import { beforeAll, describe, expect, it } from "vitest";
import { migrateDb } from "@/db";
import { createAnalysis, getAnalysis, latestAnalysis, saveMessages } from "@/lib/analyses";
import { deletePortfolio, savePortfolio, touchUser } from "@/lib/portfolios";

const ALICE = "user_alice_a";
const BOB = "user_bob_a";
let portfolioId: number;
const run = { model: "anthropic/claude-sonnet-5.5", base: "CAD", prompt: "Here is my current stock portfolio: …", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Focus on risk." }] }] };

beforeAll(async () => {
  await migrateDb();
  await touchUser(ALICE, null, null);
  await touchUser(BOB, null, null);
  ({ id: portfolioId } = await savePortfolio(ALICE, "Analysed", [{ ticker: "AAPL", shares: 1, avgBuyPrice: null, currency: null, account: null }]));
});

describe("analyses", () => {
  it("saves a run and its conversation for the portfolio's owner only", async () => {
    expect(await createAnalysis(BOB, portfolioId, run)).toBeNull();
    const id = (await createAnalysis(ALICE, portfolioId, run))!;
    expect((await getAnalysis(ALICE, id))?.prompt).toBe(run.prompt);
    expect(await getAnalysis(BOB, id)).toBeNull();

    const later = [...run.messages, { id: "m2", role: "assistant", parts: [{ type: "text", text: "Report" }] }];
    expect(await saveMessages(BOB, id, later)).toBe(false);
    expect(await saveMessages(ALICE, id, later)).toBe(true);
    expect((await latestAnalysis(ALICE, portfolioId))?.messages).toEqual(later);
    expect(await latestAnalysis(BOB, portfolioId)).toBeNull();
  });

  it("keeps combined-view runs apart from single-portfolio ones", async () => {
    const combined = (await createAnalysis(ALICE, null, run))!;
    expect((await latestAnalysis(ALICE, null))?.id).toBe(combined);
    expect((await latestAnalysis(ALICE, portfolioId))?.id).not.toBe(combined);
    expect(await latestAnalysis(BOB, null)).toBeNull();
  });

  it("shows the newest run, and goes with its portfolio", async () => {
    await createAnalysis(ALICE, portfolioId, run);
    const newest = await createAnalysis(ALICE, portfolioId, { ...run, model: "openai/gpt-5-mini" });
    expect((await latestAnalysis(ALICE, portfolioId))?.id).toBe(newest);
    await deletePortfolio(ALICE, portfolioId);
    expect(await getAnalysis(ALICE, newest!)).toBeNull();
  });
});
