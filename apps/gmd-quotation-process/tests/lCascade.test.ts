import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLCascade, L_HEADERS } from "@gmd/dashboard/lib/lCascade";

// A tiny catalogue: two L8 categories that share no materials.
const HEADERS = ["ERP ITEM CODE", ...L_HEADERS];
const row = (...l: string[]) => ["code", ...l];

const CATALOGUE = [
  //   L1    L2            L3      L4       L5          L6     L7     L8
  row("RM", "BUTTERFLY", "100MM", "BODY", "CAST IRON", "STD", "K60", "CASTING"),
  row("RM", "BUTTERFLY", "200MM", "BODY", "DUCTILE IRON", "STD", "K60", "CASTING"),
  row("SSK", "SLUICE", "100MM", "BOLT", "STAINLESS STEEL", "AISI 304", "K150", "SS SPARES"),
];

const FULL = {
  "L5- MATERIAL": ["CAST IRON", "DUCTILE IRON", "STAINLESS STEEL", "BRONZE"],
};

const blank = () => row("", "", "", "", "", "", "", "");

test("an empty row offers every value the catalogue has for that level", () => {
  const cascade = buildLCascade(CATALOGUE, HEADERS, FULL);
  assert.deepEqual(cascade(blank(), "L8 -ITEM CATEGORY"), ["CASTING", "SS SPARES"]);
});

test("choosing L8 narrows the materials to the ones used with it", () => {
  const cascade = buildLCascade(CATALOGUE, HEADERS, FULL);
  const r = blank();
  r[HEADERS.indexOf("L8 -ITEM CATEGORY")] = "CASTING";
  assert.deepEqual(cascade(r, "L5- MATERIAL"), ["CAST IRON", "DUCTILE IRON"]);
});

test("the cascade runs both ways, not just down the levels", () => {
  const cascade = buildLCascade(CATALOGUE, HEADERS, FULL);
  const r = blank();
  r[HEADERS.indexOf("L5- MATERIAL")] = "STAINLESS STEEL";
  assert.deepEqual(cascade(r, "L8 -ITEM CATEGORY"), ["SS SPARES"]);
});

test("the level being edited does not constrain itself", () => {
  const cascade = buildLCascade(CATALOGUE, HEADERS, FULL);
  const r = blank();
  r[HEADERS.indexOf("L8 -ITEM CATEGORY")] = "CASTING";
  r[HEADERS.indexOf("L5- MATERIAL")] = "CAST IRON";
  // Still both, or the editor could never change its mind.
  assert.deepEqual(cascade(r, "L5- MATERIAL"), ["CAST IRON", "DUCTILE IRON"]);
});

test("a combination the catalogue has never seen falls back to the full list", () => {
  const cascade = buildLCascade(CATALOGUE, HEADERS, FULL);
  const r = blank();
  r[HEADERS.indexOf("L8 -ITEM CATEGORY")] = "GEAR BOX";
  assert.deepEqual(cascade(r, "L5- MATERIAL"), FULL["L5- MATERIAL"]);
});

test("a header outside L1-L8 is left alone", () => {
  const cascade = buildLCascade(CATALOGUE, HEADERS, FULL);
  assert.equal(cascade(blank(), "ERP ITEM CODE"), undefined);
  assert.equal(cascade(blank(), "NEW ITEM STATUS"), undefined);
});

test("an empty catalogue never returns an empty dropdown", () => {
  const cascade = buildLCascade([], HEADERS, FULL);
  assert.deepEqual(cascade(blank(), "L5- MATERIAL"), FULL["L5- MATERIAL"]);
  assert.deepEqual(cascade(blank(), "L1"), []);
});
