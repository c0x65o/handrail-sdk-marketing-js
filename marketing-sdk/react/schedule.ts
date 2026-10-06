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
/** Tomorrow through seven calendar days, in the selected account's timezone. */
export function defaultCampaignSchedule(timezone: string, now = new Date()) {
  const { calendarDate, startOfDay } = calendar(timezone);
  const tomorrow = calendarDate(now.getTime()) + 86400000;
  return { startAt: startOfDay(tomorrow), endAt: startOfDay(tomorrow + 7 * 86400000) };
}
/** Exact completed local days contained in the campaign window; never widen it. */
export function completedCampaignWindow(from: string, until: string, timezone: string, now = new Date()) {
  const { calendarDate, startOfDay } = calendar(timezone);
  const start = Date.parse(from), end = Math.min(Date.parse(until), now.getTime());
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  let first = startOfDay(calendarDate(start));
  if (Date.parse(first) < start) first = startOfDay(calendarDate(start) + 86400000);
  const last = startOfDay(calendarDate(end));
  return Date.parse(first) < Date.parse(last) ? { from: first, until: last } : null;
}
