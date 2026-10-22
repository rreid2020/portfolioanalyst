import { describe, expect, it } from "vitest";
import { checkBalances, checkRows, emptyBalance, emptyRow, pastedRows, toBalanceRow, toRow, type BalanceRow, type Row } from "@/lib/holdings";

const row = (fields: Partial<Row>): Row => ({ ...emptyRow(), ...fields });

describe("checkRows", () => {
  it("turns typed rows into holdings and skips blank ones", () => {
    const { holdings, errors, count } = checkRows([
      row({ ticker: " shop.to ", shares: "1,200", avgBuyPrice: "$95.50", currency: "cad", account: "TFSA" }),
      row({}),
      row({ ticker: "AAPL", shares: "0.5" }),
    ]);
    expect(errors).toEqual({});
    expect(count).toBe(2);
    expect(holdings).toEqual([
      { ticker: "SHOP.TO", shares: 1200, avgBuyPrice: 95.5, currency: "CAD", account: "TFSA" },
      { ticker: "AAPL", shares: 0.5, avgBuyPrice: null, currency: null, account: null },
    ]);
  });

  it("explains what's wrong with each cell", () => {
    const bad = row({ ticker: "", shares: "-3", avgBuyPrice: "abc", currency: "dollars" });
    const { holdings, errors } = checkRows([bad, row({ ticker: "MS FT", shares: "1" })]);
    expect(holdings).toEqual([]);
    expect(errors[bad.key]).toEqual({ ticker: "Enter a ticker", shares: "More than 0", avgBuyPrice: "A price, or blank", currency: "3 letters, e.g. CAD" });
    expect(Object.values(errors)[1]).toEqual({ ticker: "Letters, digits, . and - only" });
  });

  it("round-trips saved holdings", () => {
    const h = { ticker: "XEQT.TO", shares: 12.5, avgBuyPrice: null, currency: null, account: "RRSP" };
    expect(checkRows([toRow(h)]).holdings).toEqual([h]);
  });
});

describe("pastedRows", () => {
  it("reads spreadsheet columns from the cell pasted into", () => {
    expect(pastedRows("AAPL\t10\t150\tUSD\tTFSA\r\nSHOP.TO\t20\n\n", "ticker")).toEqual([
      { ticker: "AAPL", shares: "10", avgBuyPrice: "150", currency: "USD", account: "TFSA" },
      { ticker: "SHOP.TO", shares: "20" },
    ]);
    expect(pastedRows("10\t150\textra\tignored\tgone", "shares")).toEqual([
      { shares: "10", avgBuyPrice: "150", currency: "extra", account: "ignored" },
    ]);
  });
});

describe("checkBalances", () => {
  const balance = (fields: Partial<BalanceRow>): BalanceRow => ({ ...emptyBalance(), ...fields });

  it("turns managed accounts into balance-only holdings", () => {
    const { holdings, errors } = checkBalances([
      balance({ name: " Wealthsimple Managed ", balance: "25,400.50", invested: "$20,000", account: "Non-registered" }),
      balance({}), // blank: skipped
      balance({ name: "US pension", balance: "1000", currency: "usd" }),
    ]);
    expect(errors).toEqual({});
    expect(holdings).toEqual([
      { ticker: "Wealthsimple Managed", shares: 0, balance: 25400.5, avgBuyPrice: 20000, currency: "CAD", account: "Non-registered" },
      { ticker: "US pension", shares: 0, balance: 1000, avgBuyPrice: null, currency: "USD", account: null },
    ]);
  });

  it("explains what's missing", () => {
    const bad = balance({ name: "", balance: "0", invested: "lots", currency: "dollars" });
    expect(checkBalances([bad]).errors[bad.key]).toEqual({ name: "Give it a name", balance: "More than 0", invested: "An amount, or blank", currency: "3 letters, e.g. CAD" });
  });

  it("round-trips a saved balance", () => {
    const saved = { ticker: "GIC", shares: 0, balance: 5000, avgBuyPrice: 5000, currency: "CAD", account: "TFSA" };
    expect(checkBalances([toBalanceRow(saved)]).holdings).toEqual([saved]);
  });
});
