import { describe, expect, it } from "vitest";
import { kindOf } from "@/components/MarkdownTable";

describe("analyst report tables", () => {
  it("sorts a column as numbers only when every filled cell is one", () => {
    expect(kindOf(["$1,234.50", "+12.3%", "(4.00)", "—", "n/a", "28.5x"])).toBe("number");
    expect(kindOf(["2,800.00 CAD", "US$346.03"])).toBe("number");
    expect(kindOf(["AAPL", "3M", "SHOP.TO"])).toBe("text");
    expect(kindOf(["Buy", "12"])).toBe("text");
    expect(kindOf(["2026-10-21", "2025-01-02"])).toBe("date");
    expect(kindOf(["", "—"])).toBe("text");
  });
});
