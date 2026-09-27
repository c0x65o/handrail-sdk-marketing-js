/** Tomorrow through seven calendar days, in the selected account's timezone. */
export function defaultCampaignSchedule(timezone: string, now = new Date()) {
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
  const day = 86400000;
  const tomorrow = calendarDate(now.getTime()) + day;
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
  return { startAt: startOfDay(tomorrow), endAt: startOfDay(tomorrow + 7 * day) };
}
