import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGAL_STATUSES, diffLegalCase, isUnderLitigation, normaliseLegalCase, resolveProvision, splitDues } from "../lib/legalStatus";
import type { LegalCaseView } from "../lib/legalStatus";

const blank: LegalCaseView = { status: null, forum: null, caseNo: null, filingDate: null, nextHearingDate: null, advocate: null, claimAmount: null, interestClaimed: null, provisionPct: null, provisionAmount: null, documentLink: null, lastUpdate: null };
const c = (o: Partial<LegalCaseView>): LegalCaseView => ({ ...blank, ...o });
const party = (accCode: string, totalDues: number) => ({ accCode, totalDues });

test("every status except None, Closed and null counts as under litigation", () => {
  for (const s of LEGAL_STATUSES) assert.equal(isUnderLitigation(s), s !== "None" && s !== "Closed");
  assert.equal(isUnderLitigation(null), false);
  assert.equal(isUnderLitigation(""), false);
});

test("provision given as a percentage resolves to an amount; an explicit amount wins; capped at the dues", () => {
  assert.equal(resolveProvision(c({ provisionPct: "25" }), 200), 50);
  assert.equal(resolveProvision(c({ provisionPct: "25", provisionAmount: "80" }), 200), 80);
  assert.equal(resolveProvision(c({ provisionAmount: "500" }), 200), 200);
  assert.equal(resolveProvision(c({}), 200), 0);
  assert.equal(resolveProvision(undefined, 200), 0);
});

test("gross = under litigation + provision + net collectable", () => {
  const parties = [party("A", 1000), party("B", 400), party("C", 250), party("D", 90)];
  const cases = new Map([
    ["A", c({ status: "MSEFC arbitration", provisionPct: "50" })], // 500 provided, 500 still carried
    ["B", c({ status: "Closed" })], // back in collection
    ["C", c({ status: "None", provisionAmount: "100" })], // doubtful but not litigating
    ["D", c({ status: "Court case – civil" })],
  ]);
  const s = splitDues(parties, cases);
  assert.equal(s.gross, 1740);
  assert.equal(s.provision, 600);
  assert.equal(s.underLitigation, 590);
  assert.equal(s.netCollectable, 550);
  assert.equal(s.underLitigation + s.provision + s.netCollectable, s.gross);
});

test("with no cases everything is collectable", () => {
  const s = splitDues([party("A", 10)], new Map());
  assert.deepEqual(s, { gross: 10, underLitigation: 0, provision: 0, netCollectable: 10 });
});

test("normaliseLegalCase validates status, dates and numbers", () => {
  assert.ok("error" in normaliseLegalCase({ ledger: "debtor", accCode: "A", status: "Made up" }));
  assert.ok("error" in normaliseLegalCase({ ledger: "debtor", accCode: "A", nextHearingDate: "soon" }));
  assert.ok("error" in normaliseLegalCase({ ledger: "debtor", accCode: "A", provisionPct: "120" }));
  assert.ok("error" in normaliseLegalCase({ ledger: "debtor", accCode: "A", claimAmount: "abc" }));
  assert.ok("error" in normaliseLegalCase({ ledger: "debtor", accCode: "" }));
  const r = normaliseLegalCase({ ledger: "debtor", accCode: " A ", status: "Settled", caseNo: " 9/2024 ", claimAmount: "1,00,000", filingDate: "2024-08-17", provisionPct: "" });
  assert.ok(r.data);
  if (r.data) {
    assert.equal(r.data.accCode, "A");
    assert.equal(r.data.caseNo, "9/2024");
    assert.equal(r.data.claimAmount, 100000);
    assert.equal(r.data.provisionPct, null);
    assert.equal(r.data.filingDate?.toISOString(), "2024-08-17T00:00:00.000Z");
  }
});

test("diffLegalCase lists only changed fields, treating a new case as all-blank before", () => {
  assert.deepEqual(diffLegalCase(null, c({ status: "Settled" })), [{ field: "status", oldValue: null, newValue: "Settled" }]);
  const d = diffLegalCase(c({ status: "Settled", caseNo: "1" }), c({ status: "Closed", caseNo: "1", forum: "X" }));
  assert.deepEqual(d.map((x) => x.field).sort(), ["forum", "status"]);
  assert.deepEqual(diffLegalCase(c({ status: "Settled" }), c({ status: "Settled" })), []);
});
