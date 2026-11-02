/**
 * In-transit maths. Pure functions over `PurchaseRow`s — no DB, no React — so
 * the sync, the server aggregates and the table all agree on one definition.
 *
 * **In transit = ordered but not yet received against a GRN.** The ERP already
 * computes it, in the tab's `BALANCE` column, so this file derives rather than
 * re-invents: `BALANCE` wins, and `NET_QTYORDER - QTYEXECUTE` is only the
 * fallback for a row whose balance cell is blank or junk.
 *
 * See `docs/purchase-in-transit.md`.
 */

import type { PurchaseRow } from "../columns";

/**
 * A sheet number to a real one. Handles the thousands separators and the
 * `-` `--` sentinels the GMD sheets use, and the parenthesised negatives the
 * ERP exports occasionally carry (`(2)` = -2).
 *
 * Returns `null` — not 0 — for anything unparseable, because "no number here"
 * and "zero" lead to different decisions: a null balance falls back to
 * ordered - received, a zero balance means the line is closed.
 */
export function parseQty(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim();
  if (!text) return null;

  let negative = false;
  const wrapped = text.match(/^\((.*)\)$/);
  if (wrapped) {
    negative = true;
    text = wrapped[1].trim();
  }

  // Strip grouping commas and spaces, and a leading currency symbol.
  text = text.replace(/[\s,]/g, "").replace(/^[₹$]/, "");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * The in-transit quantity of one line, never below zero.
 *
 * A negative balance means the GRN booked more than was ordered — real, and
 * reported by `overReceived`, but it is not material on its way, so it must not
 * subtract from another line's in-transit when the two are summed.
 */
export function inTransitQty(line: Pick<PurchaseRow, "balanceQty" | "netQtyOrder" | "qtyExecuted">): number {
  const balance = parseQty(line.balanceQty);
  if (balance !== null) return Math.max(0, balance);

  const ordered = parseQty(line.netQtyOrder);
  const received = parseQty(line.qtyExecuted);
  if (ordered === null) return 0;
  return Math.max(0, ordered - (received ?? 0));
}

/** True when the GRN booked more than the order asked for. Worth surfacing, not summing. */
export function overReceived(line: Pick<PurchaseRow, "balanceQty" | "netQtyOrder" | "qtyExecuted">): boolean {
  const balance = parseQty(line.balanceQty);
  if (balance !== null) return balance < 0;
  const ordered = parseQty(line.netQtyOrder);
  const received = parseQty(line.qtyExecuted);
  return ordered !== null && received !== null && received > ordered;
}

/**
 * True when the sheet's own `BALANCE` disagrees with `NET_QTYORDER -
 * QTYEXECUTE`. The sheet is trusted either way (see the file header), but a
 * mismatch means the ERP amended or cancelled something and the row is worth a
 * human eye, so the page flags it instead of hiding it.
 *
 * A tolerance is applied because the cells are rounded to two decimals.
 */
export function balanceDisagrees(
  line: Pick<PurchaseRow, "balanceQty" | "netQtyOrder" | "qtyExecuted">,
  tolerance = 0.01,
): boolean {
  const balance = parseQty(line.balanceQty);
  const ordered = parseQty(line.netQtyOrder);
  const received = parseQty(line.qtyExecuted);
  if (balance === null || ordered === null || received === null) return false;
  return Math.abs(balance - (ordered - received)) > tolerance;
}

/** An open line is one with material still to come. */
export function isOpen(line: Pick<PurchaseRow, "balanceQty" | "netQtyOrder" | "qtyExecuted">): boolean {
  return inTransitQty(line) > 0;
}

export interface ItemInTransit {
  itemCode: string;
  /** Summed in-transit quantity across the item's open lines. */
  qty: number;
  /** How many open PO lines contributed. */
  lineCount: number;
  /** Distinct units seen. More than one means `qty` is not a safe total. */
  uoms: string[];
  /** True when `uoms.length > 1` — the page must show the lines, not the sum. */
  mixedUom: boolean;
}

/**
 * In-transit quantity per ERP item code, over open lines only.
 *
 * Units are collected rather than converted: `AUM` and `UM` both appear on the
 * tab and no conversion table exists in this repo, so a mixed-unit item is
 * flagged and its sum treated as untrustworthy instead of quietly adding
 * kilograms to pieces.
 */
export function inTransitByItem(lines: readonly PurchaseRow[]): Map<string, ItemInTransit> {
  const out = new Map<string, ItemInTransit>();
  for (const line of lines) {
    const itemCode = (line.itemCode ?? "").trim();
    if (!itemCode) continue;
    const qty = inTransitQty(line);
    if (qty <= 0) continue;

    const existing = out.get(itemCode);
    const uom = (line.uom ?? "").trim().toUpperCase();
    if (existing) {
      existing.qty += qty;
      existing.lineCount += 1;
      if (uom && !existing.uoms.includes(uom)) existing.uoms.push(uom);
      existing.mixedUom = existing.uoms.length > 1;
    } else {
      out.set(itemCode, {
        itemCode,
        qty,
        lineCount: 1,
        uoms: uom ? [uom] : [],
        mixedUom: false,
      });
    }
  }
  return out;
}

export interface ContractInTransit {
  salesContract: string;
  qty: number;
  lineCount: number;
  /** Distinct item codes on the way for this contract. */
  itemCodes: string[];
  /** Summed `BASIC_AMT` of the open lines, where it parses. */
  value: number;
}

/**
 * In-transit grouped by the sales contract the purchase was raised against
 * (`SALES_CONT`). This is the "tagged from the order" view.
 *
 * Lines with no `SALES_CONT` are left out: they are real purchases, but they
 * cannot be attributed to an order, and counting them under a blank key would
 * invent a contract. `untaggedInTransit` reports them separately.
 */
export function inTransitByContract(lines: readonly PurchaseRow[]): Map<string, ContractInTransit> {
  const out = new Map<string, ContractInTransit>();
  for (const line of lines) {
    const contract = (line.salesContract ?? "").trim();
    if (!contract) continue;
    const qty = inTransitQty(line);
    if (qty <= 0) continue;

    const value = parseQty(line.basicAmount) ?? 0;
    const itemCode = (line.itemCode ?? "").trim();
    const existing = out.get(contract);
    if (existing) {
      existing.qty += qty;
      existing.lineCount += 1;
      existing.value += value;
      if (itemCode && !existing.itemCodes.includes(itemCode)) existing.itemCodes.push(itemCode);
    } else {
      out.set(contract, {
        salesContract: contract,
        qty,
        lineCount: 1,
        itemCodes: itemCode ? [itemCode] : [],
        value,
      });
    }
  }
  return out;
}

/** Open lines carrying no `SALES_CONT`: in transit, but attributable to no order. */
export function untaggedInTransit(lines: readonly PurchaseRow[]): { qty: number; lineCount: number } {
  let qty = 0;
  let lineCount = 0;
  for (const line of lines) {
    if ((line.salesContract ?? "").trim()) continue;
    const lineQty = inTransitQty(line);
    if (lineQty <= 0) continue;
    qty += lineQty;
    lineCount += 1;
  }
  return { qty, lineCount };
}

/**
 * What still has to be bought, once material already on its way is counted.
 *
 * `PhysicalStock.shortage_qty` answers the same question without the in-transit
 * term, so it overstates the gap for any item with an open PO. Returns `null`
 * when the stock row has no usable order-in-hand figure, because a shortage
 * computed from a missing number would read as a confident zero.
 */
export function trueShortage(input: {
  orderInHandQty: string | null | undefined;
  availableQty: string | null | undefined;
  inTransitQty: number;
}): number | null {
  const orderInHand = parseQty(input.orderInHandQty);
  if (orderInHand === null) return null;
  const available = parseQty(input.availableQty) ?? 0;
  return Math.max(0, orderInHand - available - input.inTransitQty);
}
