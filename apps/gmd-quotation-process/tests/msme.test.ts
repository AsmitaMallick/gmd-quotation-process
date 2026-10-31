import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MSME_SETTINGS, dueToday, followUpStage, msmeDueDate, msmeInterest, parseMsmeSettings, partyMsme } from "../lib/msme";

test("17.25% p.a. on ₹1,00,000 for 12 months, compounded monthly", () => {
  const expected = 100000 * ((1 + (3 * 5.75) / 100 / 12) ** 12 - 1);
  const got = msmeInterest(100000, new Date("2025-10-31"), new Date("2026-10-31"), 5.75);
  assert.ok(Math.abs(got - expected) < 1e-6);
  assert.equal(Math.round(got), 18681); // the plan quoted 18687; the formula gives 18681.34
});
test("interest counts whole months only and is never negative", () => {
  assert.equal(msmeInterest(1000, new Date("2026-10-01"), new Date("2026-10-30"), 5.75), 0);
  assert.equal(msmeInterest(1000, new Date("2026-10-31"), new Date("2026-10-01"), 5.75), 0);
});
test("no agreed credit days falls back to 15, not 45", () => {
  assert.deepEqual(msmeDueDate(new Date("2026-10-01"), null), new Date("2026-10-16"));
});
test("agreed credit days above 45 are capped at 45", () => {
  assert.deepEqual(msmeDueDate(new Date("2026-10-01"), 90), new Date("2026-11-15"));
  assert.deepEqual(msmeDueDate(new Date("2026-10-01"), 30), new Date("2026-10-31"));
});
test("a missed promise forces stage 3", () => {
  assert.equal(followUpStage(90, true), 3);
  assert.equal(followUpStage(2, true), 3);
});
test("stage thresholds", () => {
  const cases: [number, number][] = [[-8, 0], [-7, 0], [-1, 0], [0, 1], [6, 1], [7, 2], [15, 3], [30, 4], [45, 5], [60, 6], [200, 6]];
  for (const [d, s] of cases) assert.equal(followUpStage(d, false), s, `day ${d}`);
});
test("a party under litigation has no stage, even with a missed promise", () => {
  assert.equal(followUpStage(90, false, true), null);
  assert.equal(followUpStage(90, true, true), null);
});
test("settings fall back to the documented defaults when rows are absent or bad", () => {
  assert.deepEqual(parseMsmeSettings([]), DEFAULT_MSME_SETTINGS);
  assert.deepEqual(parseMsmeSettings([{ type: "msme.bankRatePct", value: "6.5" }, { type: "msme.defaultCreditDays", value: "abc" }]), { bankRatePct: 6.5, defaultCreditDays: 45, creditDaysNoAgreement: 15 });
});
test("partyMsme: no credit days uses 15 and accrues interest on the overdue bill", () => {
  const m = partyMsme([{ bal: 100000, vrDate: "2026-01-01" }], null, DEFAULT_MSME_SETTINGS, new Date("2026-10-31T12:00:00"), { promiseMissed: false, underLitigation: false });
  assert.equal(m.daysPastDue, 288); // due 16 Jan
  assert.ok(m.interest > 0 && m.claimable === 100000 + m.interest && m.stage === 6);
});
test("partyMsme: litigating party gets no stage", () => {
  const m = partyMsme([{ bal: 100000, vrDate: "2026-01-01" }], 45, DEFAULT_MSME_SETTINGS, new Date("2026-10-31"), { promiseMissed: false, underLitigation: true });
  assert.equal(m.stage, null);
});
test("due today: next action date reached, or promise passed with money overdue; never for litigating", () => {
  const t = new Date("2026-10-31T10:00:00");
  const base = { nextActionDate: null, promisedDate: null, overdue: 100, underLitigation: false };
  assert.equal(dueToday({ ...base, nextActionDate: "2026-10-31" }, t), true);
  assert.equal(dueToday({ ...base, nextActionDate: "2026-11-01" }, t), false);
  assert.equal(dueToday({ ...base, promisedDate: "2026-10-30" }, t), true);
  assert.equal(dueToday({ ...base, promisedDate: "2026-10-30", overdue: 0 }, t), false);
  assert.equal(dueToday({ ...base, nextActionDate: "2026-10-30", underLitigation: true }, t), false);
});
