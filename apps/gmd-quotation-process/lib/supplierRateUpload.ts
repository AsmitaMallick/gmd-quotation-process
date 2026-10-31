import * as XLSX from "xlsx";

/**
 * Supplier price upload for the valve rate master (RawMaterial, TRADING VALVE):
 * parse + validate an Excel/CSV upload and plan the change against the current
 * master, keyed by ERP Item Code. Pure: nothing here reads or writes the master.
 */

/** Template columns, in order. Only ERP Item Code and Rate USD are required; the rest is for the buyer's eye. */
export const SUPPLIER_RATE_HEADERS = [
  "ERP Item Code",
  "Item Type",
  "MOC",
  "Operation",
  "Size",
  "PN",
  "Rate USD",
  "Supplier",
  "Offer No",
  "Offer Date",
] as const;

const REQUIRED_HEADERS = ["ERP Item Code", "Rate USD"] as const;

export const VALID_ERP_CODE = /^[A-Z]{3}[0-9]{6}$/;

export interface SupplierRate {
  erpItemCode: string;
  rateUsd: number;
  supplier: string;
  offerNo: string;
  /** ISO yyyy-mm-dd, or "" when the row has no date. */
  offerDate: string;
}

export interface RowError {
  /** 1-based sheet row number, header = row 1. */
  row: number;
  message: string;
}

const squash = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
const headerKey = (v: unknown) => squash(v).toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "supplier / offerNo / dd-mm-yyyy", empty parts dropped. */
export function vendorReferenceOf(r: Pick<SupplierRate, "supplier" | "offerNo" | "offerDate">): string {
  const date = r.offerDate ? r.offerDate.split("-").reverse().join("-") : "";
  return [r.supplier, r.offerNo, date].filter(Boolean).join(" / ");
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || squash(v) === "") return "";
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = squash(v);
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // dd-mm-yyyy, the usual Indian form
  if (dmy) {
    const [, d, m, y] = dmy.map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))) return s;
  return null;
}

/** Rows of cells (header first) -> validated rates. Bad rows are reported and left out. */
export function parseSupplierRateRows(rows: unknown[][]): { rates: SupplierRate[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const header = (rows[0] ?? []).map(headerKey);
  const col: Record<string, number> = {};
  for (const h of SUPPLIER_RATE_HEADERS) col[h] = header.indexOf(headerKey(h));
  for (const h of REQUIRED_HEADERS) if (col[h] === -1) errors.push({ row: 1, message: `Missing column "${h}"` });
  if (errors.length) return { rates: [], errors };

  const rates: SupplierRate[] = [];
  const seen = new Map<string, number>();
  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const get = (h: (typeof SUPPLIER_RATE_HEADERS)[number]) => (col[h] === -1 ? null : cells?.[col[h]]);
    if (!cells || cells.every((c) => squash(c) === "")) return;

    const erpItemCode = squash(get("ERP Item Code")).toUpperCase();
    if (!erpItemCode) {
      errors.push({ row, message: "ERP Item Code is required" });
      return;
    }
    const rawRate = get("Rate USD");
    const rateUsd = typeof rawRate === "number" ? rawRate : Number(squash(rawRate).replace(/[$,]/g, ""));
    if (squash(rawRate) === "" || !Number.isFinite(rateUsd) || rateUsd < 0) {
      errors.push({ row, message: `${erpItemCode}: Rate USD must be a number, 0 or more (got "${squash(rawRate)}")` });
      return;
    }
    const offerDate = parseDate(get("Offer Date"));
    if (offerDate === null) {
      errors.push({ row, message: `${erpItemCode}: Offer Date "${squash(get("Offer Date"))}" is not a valid date (use dd-mm-yyyy)` });
      return;
    }
    if (seen.has(erpItemCode)) {
      errors.push({ row, message: `${erpItemCode}: repeated, same code as row ${seen.get(erpItemCode)}` });
      return;
    }
    seen.set(erpItemCode, row);
    rates.push({ erpItemCode, rateUsd, supplier: squash(get("Supplier")), offerNo: squash(get("Offer No")), offerDate });
  });
  return { rates, errors };
}

/** First sheet of an .xlsx/.xls/.csv file -> validated rates. */
export function parseSupplierRateFile(data: ArrayBuffer | Uint8Array): { rates: SupplierRate[]; errors: RowError[] } {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rates: [], errors: [{ row: 1, message: "The file has no sheet" }] };
  return parseSupplierRateRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false }));
}

export interface MasterRate {
  erpItemCode: string;
  /** usdRateOption parsed to a number, null when blank. */
  usd: number | null;
  vendorReference: string | null;
  /** l8ItemCategory; only TRADING VALVE(S) (or blank) rows may be priced here. */
  category: string | null;
}

/**
 * The master stores the plural "TRADING VALVES" (all 916 rows as of 31 Oct 2026),
 * while parts of the app say the singular. Both name the same category, so accept
 * either — an exact match on the singular rejected every real row.
 */
export const isTradingValve = (category: string): boolean =>
  /^TRADING VALVES?$/.test(category.trim().toUpperCase());

export interface RateChange {
  old: MasterRate;
  next: SupplierRate;
}

/**
 * What applying `incoming` to `master` would do: update matching rows (the old
 * value is returned so it can be kept as history), add valid new codes, never delete.
 */
export function planSupplierRateUpload(master: MasterRate[], incoming: SupplierRate[]) {
  const byCode = new Map(master.map((r) => [r.erpItemCode, r]));
  const updates: RateChange[] = [];
  const adds: SupplierRate[] = [];
  const unchanged: SupplierRate[] = [];
  const notMatched: { rate: SupplierRate; reason: string }[] = [];
  for (const next of incoming) {
    const old = byCode.get(next.erpItemCode);
    if (!old) {
      if (VALID_ERP_CODE.test(next.erpItemCode)) adds.push(next);
      else notMatched.push({ rate: next, reason: "Not in the master and not a valid ERP code (3 capital letters + 6 digits)" });
    } else if (old.category && !isTradingValve(old.category)) {
      notMatched.push({ rate: next, reason: `Item category is ${old.category}, not TRADING VALVE(S)` });
    } else if (old.usd === next.rateUsd && (old.vendorReference ?? "") === vendorReferenceOf(next)) unchanged.push(next);
    else updates.push({ old, next });
  }
  return { updates, adds, unchanged, notMatched };
}
