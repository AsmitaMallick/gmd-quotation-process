import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPIRY_WARNING_DAYS, validityStatus } from "@/lib/pbg/validity";

const TODAY = new Date("2026-10-31T09:30:00Z");

test("a guarantee past its validity date is expired", () => {
  assert.equal(validityStatus("2026-10-30", TODAY), "expired");
  assert.equal(validityStatus("2025-01-01", TODAY), "expired");
});

test("today counts as expiring, not expired, whatever the time of day", () => {
  assert.equal(validityStatus("2026-10-31", TODAY), "expiring");
  // Late in the day, the answer must not flip.
  assert.equal(validityStatus("2026-10-31", new Date("2026-10-31T23:59:00Z")), "expiring");
});

test("the warning window is inclusive at both ends", () => {
  // 30 days out: still warned.
  assert.equal(validityStatus("2026-11-30", TODAY), "expiring");
  // 31 days out: clear.
  assert.equal(validityStatus("2026-12-01", TODAY), "ok");
  assert.equal(EXPIRY_WARNING_DAYS, 30);
});

test("no usable date is unknown, never ok", () => {
  assert.equal(validityStatus(null, TODAY), null);
  assert.equal(validityStatus(undefined, TODAY), null);
  assert.equal(validityStatus("", TODAY), null);
  assert.equal(validityStatus("-", TODAY), null);
  assert.equal(validityStatus("not a date", TODAY), null);
  assert.equal(validityStatus("31-10-2026", TODAY), null);
});

test("an ISO timestamp is accepted, since the column stores dates as strings", () => {
  assert.equal(validityStatus("2026-11-15T00:00:00.000Z", TODAY), "expiring");
});
