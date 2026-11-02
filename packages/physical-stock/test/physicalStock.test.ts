import test from "node:test";
import assert from "node:assert/strict";
import {
  BLANK_ONLY_HEADERS,
  COLUMNS,
  DROPDOWN_OPTIONS,
  EDITABLE_CANDIDATES,
  FIELDS,
  addQty,
  buildSerial,
  cascadedOptions,
  computeAvailableQty,
  computeItemWiseValue,
  fieldOf,
  isGeneratedErpCode,
  itemKey,
  mergeRows,
} from "../src/columns";
import { editableFieldsFor, resolvePhysicalStockFlags } from "../src/flags";
import { updatePhysicalStockField } from "../src/server/index";

test("every column has a DB field", () => {
  assert.equal(COLUMNS.length, FIELDS.length);
});

test("new-item identity and qty merge", () => {
  assert.ok(isGeneratedErpCode("ABC000123"));
  assert.ok(!isGeneratedErpCode("1234567"));
  assert.equal(itemKey({ location: " kgp ", l4_component: "BODY" }), itemKey({ location: "KGP", l4_component: "body" }));
  assert.notEqual(itemKey({ location: "KGP" }), itemKey({ location: "HWH" }));
  assert.equal(addQty("1,000", "5"), "1005");
  assert.equal(addQty(null, "5"), "5");
  assert.equal(addQty(null, ""), null);
});

test("mergeRows adds qty and joins text fields", () => {
  const target = { received_qty: "5", dispatch_qty: "1", remarks: "a", item_type: "X", cost: "10" };
  const source = { received_qty: "2", dispatch_qty: null, remarks: "b", item_type: "X", cost: "7" };
  assert.deepEqual(mergeRows(target, source), {
    received_qty: "7",
    dispatch_qty: "1",
    available_qty: "6",
    item_wise_value: "42.00",
    remarks: "a, b",
  });
});

test("L dropdowns cascade on the row's other levels", () => {
  const at = (h: string) => COLUMNS.indexOf(h as (typeof COLUMNS)[number]);
  const mk = (l5: string, l8: string) => {
    const r: unknown[] = COLUMNS.map(() => "");
    r[at("L5- MATERIAL")] = l5;
    r[at("L8 -ITEM CATEGORY")] = l8;
    return r;
  };
  const rows = [mk("CAST IRON", "PATTERN"), mk("PLASTIC", "PATTERN"), mk("STAINLESS STEEL", "SPARES")];
  assert.deepEqual(cascadedOptions("L5- MATERIAL", mk("", "pattern"), rows), ["CAST IRON", "PLASTIC"]);
  // the edited level never narrows itself; an unseen combination gets the full list
  assert.equal(cascadedOptions("L5- MATERIAL", mk("PVC", ""), rows).length, DROPDOWN_OPTIONS["L5- MATERIAL"]!.length);
  assert.equal(cascadedOptions("L5- MATERIAL", mk("", "SCRAP"), rows).length, DROPDOWN_OPTIONS["L5- MATERIAL"]!.length);
});

test("qty and value math", () => {
  assert.equal(computeAvailableQty("1,000", "250"), "750");
  assert.equal(computeAvailableQty("10", ""), null);
  assert.equal(computeItemWiseValue("50,000.00", "2"), "100000.00");
  assert.equal(computeItemWiseValue("", "2"), "0.00");
});

test("editableFieldsFor maps headers and keeps BOM ID out", () => {
  const flags = resolvePhysicalStockFlags({ editableColumns: ["REMARKS", "DISPATCH QTY.", "ERP CODE", "BOM ID"] });
  assert.deepEqual([...editableFieldsFor(flags)].sort(), ["dispatch_qty", "erp_code", "remarks"]);
  assert.equal(editableFieldsFor(resolvePhysicalStockFlags({})).size, 0);
});

test("blank-only dropdown columns map to editable DB fields", () => {
  assert.ok(EDITABLE_CANDIDATES.includes("ERP CODE"));
  assert.deepEqual(
    BLANK_ONLY_HEADERS.filter((h) => h in DROPDOWN_OPTIONS).sort(),
    Object.keys(DROPDOWN_OPTIONS).sort(),
  );
  for (const header of BLANK_ONLY_HEADERS) {
    assert.ok(EDITABLE_CANDIDATES.includes(header), `${header} missing from EDITABLE_CANDIDATES`);
  }
  const fields = editableFieldsFor(
    resolvePhysicalStockFlags({ editableColumns: [...BLANK_ONLY_HEADERS] }),
  );
  assert.deepEqual([...fields].sort(), BLANK_ONLY_HEADERS.map((h) => fieldOf(h)!).sort());
});

test("buildSerial joins code, category, heat and number", () => {
  const row = { erp_code: "F001", l8_item_category: "CASTING", heat_no: "3500", heat_seq: 6 };
  assert.equal(buildSerial(row), "F001-CASTING-3500-6");
  assert.equal(buildSerial({ ...row, heat_no: null }), null);
  assert.equal(buildSerial({ ...row, heat_seq: null }), null);
});

test("HEAT NO is editable through the flag", () => {
  const flags = resolvePhysicalStockFlags({ editableColumns: ["HEAT NO"] });
  assert.deepEqual([...editableFieldsFor(flags)], ["heat_no"]);
});

// Allow-list is checked before any DB access, so no database is needed.
test("updatePhysicalStockField rejects fields outside the allow-list", async () => {
  const res = await updatePhysicalStockField("id", "location", "X", new Set(["remarks"]));
  assert.equal(res.success, false);
});
