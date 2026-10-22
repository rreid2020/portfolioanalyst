// How every number, amount and date is shown, so the whole app reads the same way (Canadian English).
//
//   money(1234.5, "CAD")                  $1,234.50        an amount, with its currency's symbol
//   money(1234.5, "USD")                  US$1,234.50      (CAD shows "$"; other currencies their symbol)
//   money(-1234.5, "CAD", { signed })     -$1,234.50       gains and losses carry a sign; +$… for gains
//   money(27248.3, "CAD", { whole })      $27,248          headline totals
//   pct(12.345)                           +12.3%           a change or return: always signed
//   share(12.345)                         12.3%            a part of a whole (weight, yield): never signed
//   num(0.7812, 2)                        0.78             a plain figure (beta, a correlation)
//   shares(12.5)                          12.5             a share count: up to 4 decimals, no trailing zeros
//   date("2026-10-21T…")                  Oct 21, 2026
//   dateTime("2026-10-21T19:04…")         Oct 21, 2026, 7:04 p.m.
//   monthYear("2026-10-21")               Oct 2026
// Anything unknown or not a number shows as an em dash.

export const DASH = "—";
const LOCALE = "en-CA";

const known = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(key: string, make: () => Intl.NumberFormat) {
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = make()));
  return f;
}

/** An amount in `currency`. `whole` drops the cents; `signed` puts + on gains; `digits` sets up to that many decimals. */
export function money(v: number | null | undefined, currency: string, { signed = false, whole = false, digits }: { signed?: boolean; whole?: boolean; digits?: number } = {}) {
  if (!known(v)) return DASH;
  const min = whole ? 0 : 2;
  const max = whole ? 0 : Math.max(digits ?? 2, 2);
  const code = (currency || "CAD").toUpperCase();
  try {
    return formatter(`m|${code}|${min}|${max}|${signed}`, () => new Intl.NumberFormat(LOCALE, {
      style: "currency", currency: code, currencyDisplay: "symbol",
      minimumFractionDigits: min, maximumFractionDigits: max, signDisplay: signed ? "exceptZero" : "auto",
    })).format(v);
  } catch {
    // Not an ISO currency code: show the number and the code as given.
    return `${num(v, max, { signed })} ${currency}`;
  }
}

/** A plain figure with a fixed number of decimals, grouped by thousands. */
export function num(v: number | null | undefined, digits = 2, { signed = false } = {}) {
  if (!known(v)) return DASH;
  return formatter(`n|${digits}|${signed}`, () => new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: signed ? "exceptZero" : "auto",
  })).format(v);
}

/** A change or return, in percent: always signed (+12.3%, -4.0%, 0.0%). */
export function pct(v: number | null | undefined, digits = 1) {
  return known(v) ? `${num(v, digits, { signed: true })}%` : DASH;
}

/** A part of a whole, in percent (a weight, a yield, a target): never signed. */
export function share(v: number | null | undefined, digits = 1) {
  return known(v) ? `${num(v, digits)}%` : DASH;
}

/** A share count: whole shares plain, fractional ones to at most 4 decimals. */
export function shares(v: number | null | undefined) {
  if (!known(v)) return DASH;
  return formatter("s", () => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 })).format(v);
}

function parse(iso: string) {
  // A bare date (YYYY-MM-DD) is a calendar day, not midnight UTC, so it mustn't shift a day west of Greenwich.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 21, 2026". */
export function date(iso: string | null | undefined) {
  const d = iso ? parse(iso) : null;
  return d ? d.toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "numeric" }) : DASH;
}

/** "Oct 21, 2026, 7:04 p.m." in the viewer's time zone. */
export function dateTime(iso: string | null | undefined) {
  const d = iso ? parse(iso) : null;
  return d ? d.toLocaleString(LOCALE, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : DASH;
}

/** "Oct 2026". */
export function monthYear(iso: string | null | undefined) {
  const d = iso ? parse(iso) : null;
  return d ? d.toLocaleDateString(LOCALE, { month: "short", year: "numeric" }) : DASH;
}
