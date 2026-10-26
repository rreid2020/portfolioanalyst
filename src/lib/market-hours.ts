// When North American stock markets (TSX, NYSE, Nasdaq) are trading: 9:30 a.m. to 4:00 p.m.
// Eastern, Monday to Friday. Holidays aren't modelled; refreshing on one is harmless.

const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
});

export function marketOpen(at: Date = new Date()): boolean {
  const parts = Object.fromEntries(EASTERN.formatToParts(at).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** "Fri, Oct 23, 4:00 p.m. EDT" in the viewer's time zone, or "4:00 p.m. EDT" when it's today. */
export function priceTime(iso: string, now: Date = new Date(), timeZone?: string): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone });
  const sameDay = day(d) === day(now);
  return d.toLocaleString("en-CA", {
    timeZone,
    ...(sameDay ? {} : { weekday: "short", month: "short", day: "numeric" }),
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}
