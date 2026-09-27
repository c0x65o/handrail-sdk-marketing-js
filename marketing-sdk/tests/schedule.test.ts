import test from "node:test";
import assert from "node:assert/strict";
import { defaultCampaignSchedule } from "../react/schedule.js";

for (const [name, zone, now, startAt, endAt] of [
  ["staging UTC/local rollover", "America/Chicago", "2026-09-27T03:50:00Z", "2026-09-27T05:00:00.000Z", "2026-10-04T05:00:00.000Z"],
  ["positive offset and year rollover", "Asia/Tokyo", "2026-12-31T03:50:00Z", "2026-12-31T15:00:00.000Z", "2027-01-07T15:00:00.000Z"],
  ["fractional offset", "Asia/Kathmandu", "2026-09-27T03:50:00Z", "2026-09-27T18:15:00.000Z", "2026-10-04T18:15:00.000Z"],
  ["spring DST: 167 hours", "America/Chicago", "2026-03-07T18:00:00Z", "2026-03-08T06:00:00.000Z", "2026-03-15T05:00:00.000Z"],
  ["fall DST: 169 hours", "America/Chicago", "2026-10-31T18:00:00Z", "2026-11-01T05:00:00.000Z", "2026-11-08T06:00:00.000Z"],
  ["skipped midnight", "America/Santiago", "2026-09-05T18:00:00Z", "2026-09-06T04:00:00.000Z", "2026-09-13T03:00:00.000Z"],
  ["repeated midnight", "America/Havana", "2026-10-31T18:00:00Z", "2026-11-01T04:00:00.000Z", "2026-11-08T05:00:00.000Z"],
  ["leap day", "UTC", "2028-02-28T23:59:00Z", "2028-02-29T00:00:00.000Z", "2028-03-07T00:00:00.000Z"],
] as const) {
  test(`campaign calendar schedule: ${name}`, () => {
    assert.deepEqual(defaultCampaignSchedule(zone, new Date(now)), { startAt, endAt });
  });
}

test("invalid zones and entirely skipped calendar dates fail closed", () => {
  assert.throws(() => defaultCampaignSchedule("not/a-zone"), RangeError);
  assert.throws(() => defaultCampaignSchedule("Pacific/Apia", new Date("2011-12-29T12:00:00Z")), /skips this calendar date/);
});
