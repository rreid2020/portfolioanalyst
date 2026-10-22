import { describe, expect, it } from "vitest";
import { applyTable, BLANK, distinctLabels, toNumber, type ColumnFilter, type FilterRow } from "@/lib/table-filter";

const row = (key: string, ticker: string, value: number | null, account: string | null, extra: Partial<FilterRow> = {}): FilterRow => ({
  key, values: { ticker, value, account }, labels: { value: value == null ? "" : `$${value}` }, ...extra,
});
const rows = [
  row("1", "SHOP.TO", 2000, "TFSA"),
  row("2", "AAPL", 2800, "RRSP"),
  row("3", "ry.to", 200, null),
  row("4", "MSFT", 2800, "TFSA"),
];
const kinds = { ticker: "text", value: "number", account: "text" } as const;
const keys = (rs: FilterRow[]) => rs.map((r) => r.key);
const only = (...labels: string[]): ColumnFilter => ({ selected: new Set(labels), condition: null });

describe("table sorting and filtering", () => {
  it("sorts text case-insensitively and numbers numerically, keeping ties in order", () => {
    expect(keys(applyTable(rows, {}, { key: "ticker", dir: "asc" }, kinds))).toEqual(["2", "4", "3", "1"]);
    expect(keys(applyTable(rows, {}, { key: "value", dir: "desc" }, kinds))).toEqual(["2", "4", "1", "3"]);
    expect(keys(applyTable(rows, {}, null, kinds))).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps blanks last in both directions", () => {
    expect(keys(applyTable(rows, {}, { key: "account", dir: "asc" }, kinds)).at(-1)).toBe("3");
    expect(keys(applyTable(rows, {}, { key: "account", dir: "desc" }, kinds)).at(-1)).toBe("3");
  });

  it("filters by ticked values, including blanks", () => {
    expect(keys(applyTable(rows, { account: only("TFSA") }, null, kinds))).toEqual(["1", "4"]);
    expect(keys(applyTable(rows, { account: only(BLANK) }, null, kinds))).toEqual(["3"]);
    expect(keys(applyTable(rows, { value: only("$2800") }, null, kinds))).toEqual(["2", "4"]);
  });

  it("filters by number and text conditions, and combines columns", () => {
    const over = { value: { selected: null, condition: { op: "gt" as const, a: 1000 } } };
    expect(keys(applyTable(rows, over, null, kinds))).toEqual(["1", "2", "4"]);
    const between = { value: { selected: null, condition: { op: "between" as const, a: 2500, b: 100 } } };
    expect(keys(applyTable(rows, between, null, kinds))).toEqual(["1", "3"]);
    const dotTo = { ticker: { selected: null, condition: { op: "ends" as const, text: ".TO" } } };
    expect(keys(applyTable(rows, { ...dotTo, account: only("TFSA") }, null, kinds))).toEqual(["1"]);
  });

  it("always shows pinned rows, last", () => {
    const withBlank = [...rows, row("new", "", null, null, { pinned: true })];
    expect(keys(applyTable(withBlank, { account: only("RRSP") }, { key: "value", dir: "asc" }, kinds))).toEqual(["2", "new"]);
  });

  it("lists each value once, in column order, for the checklist", () => {
    expect(distinctLabels(rows, "value", "number")).toEqual(["$200", "$2000", "$2800"]);
    expect(distinctLabels(rows, "account", "text")).toEqual(["RRSP", "TFSA", BLANK]);
  });

  it("reads numbers out of formatted text", () => {
    expect([toNumber("$1,234.50"), toNumber("+12.3%"), toNumber("-$5"), toNumber("(4.00)"), toNumber("n/a"), toNumber(null)])
      .toEqual([1234.5, 12.3, -5, -4, null, null]);
  });
});
