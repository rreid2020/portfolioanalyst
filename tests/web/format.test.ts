import { describe, expect, it } from "vitest";
import { date, dateTime, DASH, money, monthYear, num, pct, share, shares } from "@/lib/format";

describe("format", () => {
  it("shows amounts as currency, with the currency's own symbol", () => {
    expect(money(1234.5, "CAD")).toBe("$1,234.50");
    expect(money(1234.5, "USD")).toBe("US$1,234.50");
    expect(money(27248.3, "CAD", { whole: true })).toBe("$27,248");
    expect(money(0.4123, "CAD", { digits: 4 })).toBe("$0.4123");
    expect(money(0.4, "CAD", { digits: 4 })).toBe("$0.40");
    expect(money(-1234.5, "CAD", { signed: true })).toBe("-$1,234.50");
    expect(money(1234.5, "CAD", { signed: true })).toBe("+$1,234.50");
    expect(money(0, "CAD", { signed: true })).toBe("$0.00");
    expect(money(5, "XQ1")).toBe("5.00 XQ1"); // not a currency code
    expect(money(null, "CAD")).toBe(DASH);
    expect(money(Number.NaN, "CAD")).toBe(DASH);
  });

  it("signs changes but not shares of a whole", () => {
    expect(pct(12.345)).toBe("+12.3%");
    expect(pct(-4)).toBe("-4.0%");
    expect(pct(0.5432, 2)).toBe("+0.54%");
    expect(share(12.345)).toBe("12.3%");
    expect(share(1234.5)).toBe("1,234.5%");
    expect(pct(undefined)).toBe(DASH);
  });

  it("shows plain figures and share counts", () => {
    expect(num(0.7812, 2)).toBe("0.78");
    expect(num(1234.5, 1)).toBe("1,234.5");
    expect(shares(10)).toBe("10");
    expect(shares(12.5)).toBe("12.5");
    expect(shares(0.096912)).toBe("0.0969");
    expect(shares(1200)).toBe("1,200");
  });

  it("shows dates the same way everywhere", () => {
    expect(date("2026-10-21")).toBe("Oct 21, 2026"); // a bare date stays on its day
    expect(date("2026-10-21T15:00:00")).toBe("Oct 21, 2026");
    expect(dateTime("2026-10-21T19:04:00")).toBe("Oct 21, 2026, 7:04 p.m.");
    expect(monthYear("2026-10-21")).toBe("Oct 2026");
    expect(date("not a date")).toBe(DASH);
    expect(date(null)).toBe(DASH);
  });
});

describe("market hours and price times", () => {
  it("knows when North American markets trade (Eastern time, weekdays)", async () => {
    const { marketOpen } = await import("@/lib/market-hours");
    expect(marketOpen(new Date("2026-10-26T13:29:00Z"))).toBe(false); // Mon 9:29 a.m. EDT
    expect(marketOpen(new Date("2026-10-26T13:30:00Z"))).toBe(true); // 9:30 a.m.
    expect(marketOpen(new Date("2026-10-26T19:59:00Z"))).toBe(true); // 3:59 p.m.
    expect(marketOpen(new Date("2026-10-26T20:00:00Z"))).toBe(false); // 4:00 p.m.
    expect(marketOpen(new Date("2026-10-24T15:00:00Z"))).toBe(false); // Saturday
    expect(marketOpen(new Date("2026-12-07T14:30:00Z"))).toBe(true); // 9:30 a.m. EST, after the clock change
  });

  it("shows the day only when the price isn't from today", async () => {
    const { priceTime } = await import("@/lib/market-hours");
    const friday = "2026-10-23T20:00:00Z";
    expect(priceTime(friday, new Date("2026-10-26T14:00:00Z"), "America/Toronto")).toMatch(/^Fri, Oct 23, 4:00 p\.m\. EDT$/);
    expect(priceTime(friday, new Date("2026-10-23T21:00:00Z"), "America/Toronto")).toMatch(/^4:00 p\.m\. EDT$/);
  });
});

describe("sparkline points", () => {
  it("spans the box with the highest close at the top", async () => {
    const { sparkPoints } = await import("@/app/(app)/portfolios/[id]/charts");
    expect(sparkPoints([1, 3, 2], 10, 10, 0)).toBe("0.0,10.0 5.0,0.0 10.0,5.0");
    expect(sparkPoints([4, 4], 10, 10, 0)).toBe("0.0,10.0 10.0,10.0"); // flat line stays drawable
  });
});
