/**
 * `PURCHASE ORD AND GRN` (GMD EXECUTION TRACKING) -> `PurchaseOrderLine`.
 *
 * Plain TS, no server imports: the sync, the server queries and the client
 * table all read this file.
 *
 * Adding a column later is one line in `COLUMN_MAP`; the sync's insert payload,
 * its diff loop and the table all iterate that list.
 */

/** Columns that identify a line. `(VRNO, SLNO)` is unique on the tab. */
export const KEY_HEADERS = {
  /** The purchase order number. */
  poNo: "VRNO",
  /** The line number within that order. Blank on a few rows — see `rowKey`. */
  poLineNo: "SLNO",
} as const;

export type PurchaseField =
  | "poDate"
  | "itemCode"
  | "itemName"
  | "supplierCode"
  | "supplierName"
  | "uom"
  | "altUom"
  | "netQtyOrder"
  | "qtyExecuted"
  | "balanceQty"
  | "rate"
  | "basicAmount"
  | "exchangeRate"
  | "deliverySched"
  | "grnDate"
  | "salesContract"
  | "partyRefNo"
  | "partyRefDate";

/** Sheet column -> DB field, in the order the columns appear on the tab. */
export const COLUMN_MAP: readonly { sheet: string; db: PurchaseField }[] = [
  { sheet: "ACC_CODE", db: "supplierCode" },
  { sheet: "AUM", db: "altUom" },
  { sheet: "ITEM_CODE", db: "itemCode" },
  { sheet: "VRDATE", db: "poDate" },
  { sheet: "UM", db: "uom" },
  { sheet: "BALANCE", db: "balanceQty" },
  { sheet: "BASIC_AMT", db: "basicAmount" },
  { sheet: "DELIVERY_SCH", db: "deliverySched" },
  { sheet: "GRN_VRDATE", db: "grnDate" },
  { sheet: "NET_QTYORDER", db: "netQtyOrder" },
  { sheet: "QTYEXECUTE", db: "qtyExecuted" },
  { sheet: "RATE", db: "rate" },
  { sheet: "SALES_CONT", db: "salesContract" },
  { sheet: "EXCHANGE_RATE", db: "exchangeRate" },
  { sheet: "PARTYREFNO", db: "partyRefNo" },
  { sheet: "PARTYREFDATE", db: "partyRefDate" },
  { sheet: "ITEM_NAME", db: "itemName" },
  { sheet: "ACC_NAME", db: "supplierName" },
];

/** Table headers, in display order, with the field each one reads. */
export const PURCHASE_HEADERS = [
  "PO NO",
  "LINE",
  "PO DATE",
  "ITEM CODE",
  "ITEM NAME",
  "SUPPLIER",
  "UOM",
  "ORDERED",
  "RECEIVED",
  "IN TRANSIT",
  "RATE",
  "VALUE",
  "DELIVERY SCH",
  "GRN DATE",
  "SALES CONTRACT",
  "PARTY REF",
] as const;

export type PurchaseHeader = (typeof PURCHASE_HEADERS)[number];

export const HEADER_TO_FIELD: Record<PurchaseHeader, keyof PurchaseRow> = {
  "PO NO": "poNo",
  LINE: "poLineNo",
  "PO DATE": "poDate",
  "ITEM CODE": "itemCode",
  "ITEM NAME": "itemName",
  SUPPLIER: "supplierName",
  UOM: "uom",
  ORDERED: "netQtyOrder",
  RECEIVED: "qtyExecuted",
  "IN TRANSIT": "balanceQty",
  RATE: "rate",
  VALUE: "basicAmount",
  "DELIVERY SCH": "deliverySched",
  "GRN DATE": "grnDate",
  "SALES CONTRACT": "salesContract",
  "PARTY REF": "partyRefNo",
};

/** Headers rendered right-aligned, because they hold numbers. */
export const NUMERIC_HEADERS: ReadonlySet<PurchaseHeader> = new Set([
  "ORDERED",
  "RECEIVED",
  "IN TRANSIT",
  "RATE",
  "VALUE",
]);

/** One PO line as the page sees it. Mirrors `PurchaseOrderLine` minus timestamps. */
export interface PurchaseRow {
  id: string;
  poNo: string;
  poLineNo: string;
  poDate: string | null;
  itemCode: string | null;
  itemName: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  uom: string | null;
  altUom: string | null;
  netQtyOrder: string | null;
  qtyExecuted: string | null;
  balanceQty: string | null;
  rate: string | null;
  basicAmount: string | null;
  exchangeRate: string | null;
  deliverySched: string | null;
  grnDate: string | null;
  salesContract: string | null;
  partyRefNo: string | null;
  partyRefDate: string | null;
  /** Derived by the sync (see `lib/inTransit.ts`); null when the cells were unparseable. */
  inTransit: number | null;
  /** Derived by the sync: `BASIC_AMT` parsed. */
  lineValue: number | null;
}

const DASH_SENTINELS = new Set(["-", "--", "—", "–"]);

/**
 * True for a cell that carries no information. Such a value must never clear a
 * stored one — the same policy as `executionTrackingSync`.
 */
export function isBlankSheetValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || DASH_SENTINELS.has(trimmed);
}

/** Trim + collapse whitespace + upper-case, for keys that are compared. */
export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * The tab repeats its header as the first data row (confirmed on the live
 * sheet: row 2 reads `ACC_CODE | AUM | ITEM_CODE | ...`). Such a row would
 * otherwise be stored as a PO called "VRNO".
 */
export function isRepeatedHeaderRow(poNoValue: string): boolean {
  return normalizeKey(poNoValue) === KEY_HEADERS.poNo;
}

/**
 * The match key for a row. `SLNO` is blank on a few lines; an empty line number
 * is kept as `""` so the row still has one stable key rather than colliding
 * with every other blank-SLNO line on a different order.
 */
export function rowKey(poNo: string, poLineNo: string): string {
  return `${normalizeKey(poNo)}#${normalizeKey(poLineNo)}`;
}
