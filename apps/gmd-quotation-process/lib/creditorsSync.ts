/**
 * CREDITORS and ADVANCE TO CREDITORS tabs (execution-tracking workbook) ->
 * `Creditor` / `CreditorAdvance` tables. Same workbook and date format as DEBTORS.
 *
 * Column names are matched exactly after normalisation, so a renamed column
 * fails loudly instead of writing nulls (a silent zero reads as "we owe nothing").
 */

import { cell, requireColumns } from "./gmd_lib/bomMastErp";
import { parseAmount, parseSheetDate } from "./debtorsSync";

export { parseAmount, parseSheetDate };

// shortcut: tabs resolved by title; switch to gid like DEBTORS_GID once the gids are known.
export const CREDITORS_TAB = "CREDITORS";
export const ADVANCES_TAB = "ADVANCE TO CREDITORS";

export const CREDITOR_HEADERS = {
  accSch: "ACC_SCH",
  accCode: "ACC_CODE",
  accName: "ACC_NAME",
  vrNo: "VRNO",
  vrDate: "VRDATE",
  dueDate: "DUEDATE",
  unAllocCr: "UN_ALLOC_CR",
  partyBillNo: "PARTYBILLNO",
  partyBillDate: "PARTYBILLDATE",
} as const;

export const ADVANCE_HEADERS = {
  accCode: "ACC_CODE",
  vrNo: "VRNO",
  vrDate: "VRDATE",
  unAllocDr: "UN_ALLOC_DR",
  partyBillNo: "PARTYBILLNO",
  accSch: "ACC_SCH",
  partyBillDate: "PARTYBILLDATE",
  particular: "PARTICULAR",
  narration: "NARRATION",
} as const;

export type CreditorRecord = {
  accSch: string | null;
  accCode: string;
  accName: string | null;
  vrNo: string | null;
  vrDate: Date | null;
  dueDate: Date | null;
  unAllocCr: number | null;
  partyBillNo: string | null;
  partyBillDate: Date | null;
};

export type CreditorAdvanceRecord = {
  accSch: string | null;
  accCode: string;
  vrNo: string | null;
  vrDate: Date | null;
  unAllocDr: number | null;
  partyBillNo: string | null;
  partyBillDate: Date | null;
  particular: string | null;
  narration: string | null;
};

export type RowResult<T> = { ok: true; record: T } | { ok: false; error: string };

function resolve<H extends Record<string, string>>(headers: string[], tabTitle: string, map: H) {
  const keys = Object.keys(map) as (keyof H)[];
  const idx = requireColumns(headers, Object.values(map), tabTitle);
  return Object.fromEntries(keys.map((k, i) => [k, idx[i]])) as Record<keyof H, number>;
}

export const resolveCreditorColumns = (headers: string[], tabTitle: string) =>
  resolve(headers, tabTitle, CREDITOR_HEADERS);
export const resolveAdvanceColumns = (headers: string[], tabTitle: string) =>
  resolve(headers, tabTitle, ADVANCE_HEADERS);

function mapRow<T>(row: string[], accCodeIdx: number, build: () => T): RowResult<T> {
  if (!cell(row, accCodeIdx)) return { ok: false, error: "blank ACC_CODE" };
  try {
    return { ok: true, record: build() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function mapCreditorRow(
  row: string[],
  idx: Record<keyof typeof CREDITOR_HEADERS, number>,
): RowResult<CreditorRecord> {
  const c = (k: keyof typeof CREDITOR_HEADERS) => cell(row, idx[k]);
  return mapRow(row, idx.accCode, () => ({
    accSch: c("accSch") || null,
    accCode: c("accCode"),
    accName: c("accName") || null,
    vrNo: c("vrNo") || null,
    vrDate: parseSheetDate(c("vrDate")),
    dueDate: parseSheetDate(c("dueDate")),
    unAllocCr: parseAmount(c("unAllocCr")),
    partyBillNo: c("partyBillNo") || null,
    partyBillDate: parseSheetDate(c("partyBillDate")),
  }));
}

export function mapAdvanceRow(
  row: string[],
  idx: Record<keyof typeof ADVANCE_HEADERS, number>,
): RowResult<CreditorAdvanceRecord> {
  const c = (k: keyof typeof ADVANCE_HEADERS) => cell(row, idx[k]);
  return mapRow(row, idx.accCode, () => ({
    accSch: c("accSch") || null,
    accCode: c("accCode"),
    vrNo: c("vrNo") || null,
    vrDate: parseSheetDate(c("vrDate")),
    unAllocDr: parseAmount(c("unAllocDr")),
    partyBillNo: c("partyBillNo") || null,
    partyBillDate: parseSheetDate(c("partyBillDate")),
    particular: c("particular") || null,
    narration: c("narration") || null,
  }));
}
