import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceDisagrees,
  inTransitByContract,
  inTransitByItem,
  inTransitQty,
  isOpen,
  overReceived,
  parseQty,
  trueShortage,
  untaggedInTransit,
} from "../src/lib/inTransit";
import type { PurchaseRow } from "../src/columns";

function line(partial: Partial<PurchaseRow>): PurchaseRow {
  return {
    id: "x",
    poNo: "PA24Y-00027",
    poLineNo: "1",
    poDate: null,
    itemCode: null,
    itemName: null,
    supplierCode: null,
    supplierName: null,
    uom: null,
    altUom: null,
    netQtyOrder: null,
    qtyExecuted: null,
    balanceQty: null,
    rate: null,
    basicAmount: null,
    exchangeRate: null,
    deliverySched: null,
    grnDate: null,
    salesContract: null,
    partyRefNo: null,
    partyRefDate: null,
    inTransit: null,
    lineValue: null,
    ...partial,
  };
}

test("parseQty handles the shapes the GMD sheets actually hold", () => {
  assert.equal(parseQty("2"), 2);
  assert.equal(parseQty("1,73,460.00"), 173460);
  assert.equal(parseQty(" 12.5 "), 12.5);
  assert.equal(parseQty("(2)"), -2);
  assert.equal(parseQty("-3"), -3);
  assert.equal(parseQty("₹1,200"), 1200);
  assert.equal(parseQty(".5"), 0.5);

  // No number here is not the same as zero.
  assert.equal(parseQty(""), null);
  assert.equal(parseQty("   "), null);
  assert.equal(parseQty(null), null);
  assert.equal(parseQty(undefined), null);
  assert.equal(parseQty("TBD"), null);
  assert.equal(parseQty("12 PCS"), null);
  assert.equal(parseQty("0"), 0);
});

test("BALANCE wins over ordered - received", () => {
  // The ERP amended the order: trust its balance, not the arithmetic.
  const row = line({ balanceQty: "4", netQtyOrder: "10", qtyExecuted: "2" });
  assert.equal(inTransitQty(row), 4);
  assert.equal(balanceDisagrees(row), true);
});

test("falls back to ordered - received when BALANCE is blank or junk", () => {
  assert.equal(inTransitQty(line({ balanceQty: "", netQtyOrder: "10", qtyExecuted: "2" })), 8);
  assert.equal(inTransitQty(line({ balanceQty: "-", netQtyOrder: "10", qtyExecuted: "2" })), 8);
  assert.equal(inTransitQty(line({ balanceQty: "TBD", netQtyOrder: "10", qtyExecuted: null })), 10);
  // Nothing usable at all: not in transit, rather than NaN.
  assert.equal(inTransitQty(line({})), 0);
});

test("a negative balance never subtracts from the total", () => {
  const over = line({ balanceQty: "-3", netQtyOrder: "10", qtyExecuted: "13", itemCode: "RCC010016" });
  assert.equal(inTransitQty(over), 0);
  assert.equal(overReceived(over), true);
  assert.equal(isOpen(over), false);

  const open = line({ balanceQty: "5", itemCode: "RCC010016", uom: "PCS" });
  const byItem = inTransitByItem([over, open]);
  assert.equal(byItem.get("RCC010016")?.qty, 5);
  assert.equal(byItem.get("RCC010016")?.lineCount, 1);
});

test("balanceDisagrees tolerates two-decimal rounding and ignores unparseable rows", () => {
  assert.equal(balanceDisagrees(line({ balanceQty: "8.00", netQtyOrder: "10", qtyExecuted: "2" })), false);
  assert.equal(balanceDisagrees(line({ balanceQty: "8.005", netQtyOrder: "10", qtyExecuted: "2" })), false);
  assert.equal(balanceDisagrees(line({ balanceQty: "8.5", netQtyOrder: "10", qtyExecuted: "2" })), true);
  assert.equal(balanceDisagrees(line({ balanceQty: "", netQtyOrder: "10", qtyExecuted: "2" })), false);
});

test("per-item aggregation flags mixed units instead of adding them", () => {
  const byItem = inTransitByItem([
    line({ itemCode: "FBC020483", balanceQty: "2", uom: "PCS" }),
    line({ itemCode: "FBC020483", balanceQty: "3", uom: "PCS" }),
    line({ itemCode: "RCC010016", balanceQty: "10", uom: "PCS" }),
    line({ itemCode: "RCC010016", balanceQty: "4", uom: "KG" }),
    // No item code: cannot be attributed to stock.
    line({ itemCode: "", balanceQty: "99" }),
  ]);

  assert.equal(byItem.get("FBC020483")?.qty, 5);
  assert.equal(byItem.get("FBC020483")?.mixedUom, false);
  assert.equal(byItem.get("RCC010016")?.qty, 14);
  assert.equal(byItem.get("RCC010016")?.mixedUom, true);
  assert.deepEqual(byItem.get("RCC010016")?.uoms, ["PCS", "KG"]);
  assert.equal(byItem.size, 2);
});

test("per-contract aggregation tags in-transit to the order, and counts the rest apart", () => {
  const lines = [
    line({ salesContract: "OD22Y-00044", balanceQty: "2", basicAmount: "1,000", itemCode: "A1" }),
    line({ salesContract: "OD22Y-00044", balanceQty: "3", basicAmount: "500", itemCode: "A2" }),
    line({ salesContract: "  ", balanceQty: "7" }),
    line({ salesContract: null, balanceQty: "1" }),
    // Closed line: tagged, but nothing is coming.
    line({ salesContract: "OD22Y-00048", balanceQty: "0" }),
  ];

  const byContract = inTransitByContract(lines);
  assert.equal(byContract.size, 1);
  assert.equal(byContract.get("OD22Y-00044")?.qty, 5);
  assert.equal(byContract.get("OD22Y-00044")?.value, 1500);
  assert.deepEqual(byContract.get("OD22Y-00044")?.itemCodes, ["A1", "A2"]);

  assert.deepEqual(untaggedInTransit(lines), { qty: 8, lineCount: 2 });
});

test("true shortage counts material already on its way", () => {
  // 10 needed, 2 on the shelf, 5 on the way -> only 3 still to buy.
  assert.equal(trueShortage({ orderInHandQty: "10", availableQty: "2", inTransitQty: 5 }), 3);
  // Already covered: never negative.
  assert.equal(trueShortage({ orderInHandQty: "10", availableQty: "2", inTransitQty: 20 }), 0);
  // Missing available qty is treated as nothing on the shelf.
  assert.equal(trueShortage({ orderInHandQty: "10", availableQty: null, inTransitQty: 1 }), 9);
  // No order in hand: unknown, not zero.
  assert.equal(trueShortage({ orderInHandQty: null, availableQty: "2", inTransitQty: 1 }), null);
  assert.equal(trueShortage({ orderInHandQty: "n/a", availableQty: "2", inTransitQty: 1 }), null);
});
