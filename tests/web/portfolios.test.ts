// Saved portfolios against an in-memory PGlite database (vitest.config.ts sets DATABASE_URL=memory://).
// The same cases as tests/test_saved_portfolios.py's Store tests.
import { beforeAll, describe, expect, it } from "vitest";
import { migrateDb } from "@/db";
import {
  countPortfolios, deletePortfolio, listPortfolios, loadAllPortfolios, loadPortfolio, nameTaken, PortfolioNameError, renamePortfolio, savePortfolio, touchUser,
  updatePortfolio,
  type Holding,
} from "@/lib/portfolios";

const ALICE = "user_alice";
const BOB = "user_bob";

const HOLDINGS: Holding[] = [
  { ticker: " aapl ", shares: 10, avgBuyPrice: 150, currency: "usd", account: "TFSA" },
  { ticker: "SHOP.TO", shares: 20, avgBuyPrice: null, currency: "", account: "" },
  { ticker: "", shares: 5, avgBuyPrice: null, currency: null, account: null }, // blank rows are dropped
  { ticker: "XEQT.TO", shares: 12.5, avgBuyPrice: 30.1, currency: "CAD", account: "RRSP" },
];

beforeAll(async () => {
  await migrateDb();
  await touchUser(ALICE, "alice@example.com", "Alice");
  await touchUser(BOB, "bob@example.com", null);
});

describe("saved portfolios", () => {
  it("save and load round trip", async () => {
    const { id, replaced } = await savePortfolio(ALICE, "  Family TFSA ", HOLDINGS);
    expect(replaced).toBe(false);
    const loaded = await loadPortfolio(ALICE, id);
    expect(loaded?.name).toBe("Family TFSA");
    expect(loaded?.holdings).toEqual([
      { ticker: "AAPL", shares: 10, avgBuyPrice: 150, currency: "USD", account: "TFSA" },
      { ticker: "SHOP.TO", shares: 20, avgBuyPrice: null, currency: null, account: null },
      { ticker: "XEQT.TO", shares: 12.5, avgBuyPrice: 30.1, currency: "CAD", account: "RRSP" },
    ]);
  });

  it("saving the same name replaces", async () => {
    const first = await savePortfolio(ALICE, "Replace me", HOLDINGS);
    const second = await savePortfolio(ALICE, "Replace me", [HOLDINGS[0]]);
    expect(second).toEqual({ id: first.id, replaced: true });
    expect((await loadPortfolio(ALICE, first.id))?.holdings).toHaveLength(1);
    const listed = (await listPortfolios(ALICE)).find((p) => p.id === first.id);
    expect(listed?.holdings).toBe(1);
  });

  it("lists the most recently updated first", async () => {
    const older = await savePortfolio(ALICE, "Older", HOLDINGS);
    const newer = await savePortfolio(ALICE, "Newer", HOLDINGS);
    const ids = (await listPortfolios(ALICE)).map((p) => p.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });

  it("users never see each other's portfolios", async () => {
    const { id } = await savePortfolio(ALICE, "Private", HOLDINGS);
    expect(await loadPortfolio(BOB, id)).toBeNull();
    expect(await renamePortfolio(BOB, id, "Mine now")).toBe(false);
    expect(await deletePortfolio(BOB, id)).toBe(false);
    expect((await listPortfolios(BOB)).map((p) => p.id)).not.toContain(id);
    // Bob can use the same name for his own.
    expect((await savePortfolio(BOB, "Private", HOLDINGS)).replaced).toBe(false);
    expect((await loadPortfolio(ALICE, id))?.name).toBe("Private");
  });

  it("rename and delete", async () => {
    const { id } = await savePortfolio(ALICE, "Rename me", HOLDINGS);
    await savePortfolio(ALICE, "Taken", HOLDINGS);
    await expect(renamePortfolio(ALICE, id, "Taken")).rejects.toBeInstanceOf(PortfolioNameError);
    expect(await renamePortfolio(ALICE, id, " Renamed ")).toBe(true);
    expect((await loadPortfolio(ALICE, id))?.name).toBe("Renamed");
    const before = await countPortfolios(ALICE);
    expect(await deletePortfolio(ALICE, id)).toBe(true);
    expect(await loadPortfolio(ALICE, id)).toBeNull();
    expect(await countPortfolios(ALICE)).toBe(before - 1);
  });

  it("updates a portfolio in place", async () => {
    const { id } = await savePortfolio(ALICE, "Edit me", HOLDINGS);
    await savePortfolio(ALICE, "Also mine", HOLDINGS);
    expect(await updatePortfolio(ALICE, id, "Edited", [{ ticker: "vfv.to", shares: 3, avgBuyPrice: null, currency: null, account: "TFSA" }])).toBe(true);
    const loaded = await loadPortfolio(ALICE, id);
    expect(loaded?.name).toBe("Edited");
    expect(loaded?.holdings).toEqual([{ ticker: "VFV.TO", shares: 3, avgBuyPrice: null, currency: null, account: "TFSA" }]);
    await expect(updatePortfolio(ALICE, id, "Also mine", [])).rejects.toBeInstanceOf(PortfolioNameError);
    expect(await updatePortfolio(BOB, id, "Stolen", [])).toBe(false);
    expect((await loadPortfolio(ALICE, id))?.holdings).toHaveLength(1);
    expect(await nameTaken(ALICE, " Edited ")).toBe(true);
    expect(await nameTaken(BOB, "Edited")).toBe(false);
  });

  it("combines every portfolio's holdings for the all-portfolios view", async () => {
    const carol = "user_carol";
    await touchUser(carol, null, null);
    expect(await loadAllPortfolios(carol)).toEqual({ portfolios: 0, updatedAt: null, holdings: [] });
    await savePortfolio(carol, "TFSA", [HOLDINGS[0]]);
    await savePortfolio(carol, "RRSP", [HOLDINGS[1], HOLDINGS[3]]);
    const all = await loadAllPortfolios(carol);
    expect(all.portfolios).toBe(2);
    expect(all.holdings.map((h) => h.ticker)).toEqual(["SHOP.TO", "XEQT.TO", "AAPL"]); // newest portfolio first, in saved order
    expect((await loadAllPortfolios(BOB)).portfolios).toBe((await listPortfolios(BOB)).length); // only Bob's own
  });

  it("names are validated", async () => {
    await expect(savePortfolio(ALICE, "   ", HOLDINGS)).rejects.toThrow("Give the portfolio a name.");
    await expect(savePortfolio(ALICE, "x".repeat(101), HOLDINGS)).rejects.toThrow("up to 100 characters");
  });

  it("needs a user", async () => {
    await expect(listPortfolios("")).rejects.toThrow("A user id is required.");
  });

  it("ids that aren't numbers are missing, not errors", async () => {
    expect(await loadPortfolio(ALICE, Number.NaN)).toBeNull();
  });

  it("touching a user keeps the profile current", async () => {
    await touchUser(BOB, "bob@new.example.com", "Bob");
    await touchUser(BOB, "bob@new.example.com", "Bob");
    expect(await countPortfolios(BOB)).toBeGreaterThan(0);
  });
});
