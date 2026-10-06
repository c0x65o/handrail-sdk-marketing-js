import test from "node:test";
import assert from "node:assert/strict";
import { defaultCampaignSchedule, completedCampaignWindow } from "../react/schedule.js";

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


test("results select only completed provider days without widening partial campaign windows", () => {
  for (const [from, until] of [["2026-03-08T06:00:00.000Z", "2026-03-09T05:00:00.000Z"],
    ["2026-11-01T05:00:00.000Z", "2026-11-02T06:00:00.000Z"]]) {
    assert.deepEqual(completedCampaignWindow(from!, until!, "America/Chicago", new Date(until!)), { from, until });
    assert.equal(completedCampaignWindow(from!, until!, "America/Chicago", new Date(Date.parse(until!) - 1)), null);
    assert.equal(completedCampaignWindow(new Date(Date.parse(from!) + 1).toISOString(), until!, "America/Chicago", new Date(until!)), null);
  }
  assert.deepEqual(completedCampaignWindow("2026-11-01T06:00:00Z", "2026-11-04T20:00:00Z", "America/Chicago", new Date("2026-11-03T18:00:00Z")),
    { from: "2026-11-02T06:00:00.000Z", until: "2026-11-03T06:00:00.000Z" });
  assert.equal(completedCampaignWindow("2099-01-01T00:00:00Z", "2099-01-08T00:00:00Z", "UTC"), null);
});

import { dateAtInstant, instantAtDate, selectedCompletedWindow } from "../react/schedule.js";
test("guided calendar dates preserve DST boundaries and reject partial, future, impossible and non-UTC LinkedIn reports", () => {
  assert.equal(instantAtDate("2026-03-08", "America/Chicago"), "2026-03-08T06:00:00.000Z");
  assert.equal(instantAtDate("2026-03-09", "America/Chicago"), "2026-03-09T05:00:00.000Z");
  assert.equal(dateAtInstant("2026-03-09T05:00:00Z", "America/Chicago"), "2026-03-09");
  const now = new Date("2026-03-10T18:00:00Z");
  assert.deepEqual(selectedCompletedWindow("2026-03-08", "2026-03-09", "2026-03-08T06:00:00Z", "2026-03-12T05:00:00Z", "America/Chicago", "meta", now), { from: "2026-03-08T06:00:00.000Z", until: "2026-03-09T05:00:00.000Z" });
  assert.throws(() => selectedCompletedWindow("2026-03-08", "2026-03-09", "2026-03-08T06:00:01Z", "2026-03-12T05:00:00Z", "America/Chicago", "meta", now), /completed whole days/);
  assert.throws(() => selectedCompletedWindow("2026-03-08", "2026-03-11", "2026-03-08T06:00:00Z", "2026-03-12T05:00:00Z", "America/Chicago", "meta", now), /completed whole days/);
  assert.throws(() => selectedCompletedWindow("2026-03-08", "2026-03-09", "2026-03-08T06:00:00Z", "2026-03-12T05:00:00Z", "America/Chicago", "linkedin", now), /require UTC/);
  for (const date of ["2026-02-30", "", "2026-1-2", "tomorrow"]) assert.throws(() => instantAtDate(date, "UTC"), /valid calendar date/);
});

test("calendar controls reject timezone-less instants and handle midnight gaps, overlaps and a skipped date", () => {
  for (const value of ["2026-03-09T00:00:00", "2026-02-30T00:00:00Z", "2026-03-09"]) {
    assert.throws(() => dateAtInstant(value, "America/Chicago"), /explicit valid UTC/);
    assert.equal(completedCampaignWindow(value, "2026-03-11T00:00:00Z", "America/Chicago"), null);
  }
  assert.equal(instantAtDate("2018-11-04", "America/Sao_Paulo"), "2018-11-04T03:00:00.000Z");
  assert.equal(instantAtDate("2026-11-01", "America/Havana"), "2026-11-01T04:00:00.000Z");
  assert.throws(() => instantAtDate("2011-12-30", "Pacific/Apia"), /skips this calendar date/);
  assert.deepEqual(completedCampaignWindow("2011-12-29T23:00:00Z", "2012-01-01T10:00:00Z", "Pacific/Apia"),
    { from: "2011-12-30T10:00:00.000Z", until: "2012-01-01T10:00:00.000Z" });
});
