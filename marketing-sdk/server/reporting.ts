import type { ReportingBasis } from "../core/index.js";
import { instant } from "./validation.js";
import { requireThat } from "./store.js";

export function localDate(value: string | number, timezone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/** Calendar boundaries, not multiples of 24 hours (DST days can be 23/25h).
 * The preceding millisecond must belong to a different local date; this rejects
 * the second midnight in zones with a repeated midnight, and accepts skipped 00h.
 */
export function providerDayWindow(from: string, until: string, timezone: string, now = Date.now()): ReportingBasis {
  instant(from); instant(until);
  requireThat(Date.parse(from) < Date.parse(until), "invalid_report_window", 422);
  for (const boundary of [from, until]) {
    const normalized = new Date(boundary).toISOString();
    requireThat(boundary === normalized || boundary === normalized.replace(".000Z", "Z"), "invalid_instant", 422);
    requireThat(
      localDate(boundary, timezone) !== localDate(Date.parse(boundary) - 1, timezone),
      "provider_report_requires_local_midnights", 422);
  }
  requireThat(Date.parse(until) <= now, "provider_report_requires_completed_days", 422);
  return { window: "completed-provider-days", timezone, from, until, completeThrough: until };
}

export function remainingCalendarDays(now: number, until: string, timezone: string) {
  return Math.max(0, (Date.parse(localDate(until, timezone)) - Date.parse(localDate(now, timezone))) / 86400000);
}
