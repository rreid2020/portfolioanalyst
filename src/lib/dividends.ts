import type { AccountRow, DividendRow } from "@/lib/py";

/** Dividend income summed per account, largest first, with the yield on each account's market value. */
export function incomeByAccount(rows: DividendRow[], accounts: AccountRow[]) {
  const income = new Map<string, number>();
  for (const r of rows) {
    if (!r.annualIncome) continue;
    const account = r.account || "Unassigned";
    income.set(account, (income.get(account) ?? 0) + r.annualIncome);
  }
  const value = new Map(accounts.map((a) => [a.account, a.value]));
  return [...income]
    .map(([account, total]) => {
      const v = value.get(account);
      return { account, income: total, yieldPct: v ? (total / v) * 100 : null };
    })
    .sort((a, b) => b.income - a.income);
}
