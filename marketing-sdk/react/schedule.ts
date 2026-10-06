function calendar(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Use UTC only for calendar arithmetic, never as the account's offset.
  const calendarDate = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"));
  };
  const startOfDay = (date: number) => {
    // Find the first instant of this local date. This also handles zones that
    // skip or repeat midnight: use the first valid instant of the calendar day.
    let low = date - 36 * 3600000;
    let high = date + 36 * 3600000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (calendarDate(middle) < date) low = middle;
      else high = middle;
    }
    if (calendarDate(high) !== date)
      throw new Error("The account timezone skips this calendar date. Choose an explicit schedule.");
    return new Date(high).toISOString();
  };
  return { calendarDate, startOfDay };
}
function parseInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString() === value.replace(/(?<!\.\d{3})Z$/, ".000Z") ? n : NaN;
}
/** Tomorrow through seven calendar days, in the selected account's timezone. */
export function defaultCampaignSchedule(timezone: string, now = new Date()) {
  const { calendarDate, startOfDay } = calendar(timezone);
  const tomorrow = calendarDate(now.getTime()) + 86400000;
  return { startAt: startOfDay(tomorrow), endAt: startOfDay(tomorrow + 7 * 86400000) };
}
/** Exact completed local days contained in the campaign window; never widen it. */
export function completedCampaignWindow(from: string, until: string, timezone: string, now = new Date()) {
  const { calendarDate, startOfDay } = calendar(timezone);
  const start = parseInstant(from), end = Math.min(parseInstant(until), now.getTime());
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  let first = startOfDay(calendarDate(start));
  if (Date.parse(first) < start) {
    // A timezone may skip a whole date (e.g. Apia). There is no reportable day
    // there; choose the next actual boundary without widening the window.
    for (let offset = 1; offset <= 3; offset++) {
      try { first = startOfDay(calendarDate(start) + offset * 86400000); break; }
      catch { if (offset === 3) return null; }
    }
  }
  const last = startOfDay(calendarDate(end));
  return Date.parse(first) < Date.parse(last) ? { from: first, until: last } : null;
}

/** A date field is a calendar date in an explicit provider zone, never browser time. */
export function instantAtDate(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new Error("Choose a valid calendar date.");
  return calendar(timezone).startOfDay(Date.parse(value));
}
export function dateAtInstant(value: string, timezone: string): string {
  const instant = parseInstant(value);
  if (!Number.isFinite(instant)) throw new Error("An explicit valid UTC instant is required");
  return new Date(calendar(timezone).calendarDate(instant)).toISOString().slice(0, 10);
}
/** Reject invalid/custom windows, including historical non-UTC LinkedIn grants. */
export function selectedCompletedWindow(fromDate: string, untilDate: string, start: string, end: string, timezone: string, provider: string, now = new Date()) {
  if (provider === "linkedin" && timezone !== "UTC") throw new Error("LinkedIn provider reports require UTC. Historical non-UTC material is not relabeled.");
  const available = completedCampaignWindow(start, end, timezone, now);
  const from = instantAtDate(fromDate, timezone), until = instantAtDate(untilDate, timezone);
  if (!available || Date.parse(from) < Date.parse(available.from) || Date.parse(until) > Date.parse(available.until) || Date.parse(from) >= Date.parse(until))
    throw new Error("Choose completed whole days inside the campaign; the end date is exclusive.");
  return { from, until };
}
