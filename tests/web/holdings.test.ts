import { describe, expect, it } from "vitest";
import { checkRows, emptyRow, pastedRows, toRow, type Row } from "@/lib/holdings";

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
