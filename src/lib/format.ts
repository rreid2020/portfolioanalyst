const moneyFmt = new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeFmt = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

/** 1,234.56, or "—" when unknown. `signed` adds + to gains. */
export function money(v: number | null | undefined, { signed = false, whole = false } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (whole ? wholeFmt : moneyFmt).format(v);
  return signed && v > 0 ? `+${s}` : s;
}

/** +12.3%, or "—". */
export function pct(v: number | null | undefined, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function shares(v: number) {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: 6 }).format(v);
}

/** "Oct 21, 2026" from an ISO timestamp. */
export function date(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}
