/**
 * Read side of the debtors ledger.
 *
 * The rows are written by whatever sync is approved later; this module only
 * reads them. Money arrives as Prisma `Decimal`, so it is flattened to a number
 * here (same as `lib/pbg/pbg-data.ts`) before it reaches the table.
 */
import { squish } from "@gmd/dashboard/lib/squish";
import type { BgRow, BillInfo, FollowUp } from "./debtorJoins";
import type { LegalCaseView } from "./legalStatus";
import type { MsmeSettings } from "./msme";

export type DebtorRow = {
  id: string;
  accSch: string | null;
  accCode: string;
  accName: string | null;
  tCode: string | null;
  vrNo: string | null;
  vrDate: string | null;
  dueDate: string | null;
  particular: string | null;
  drAmt: number | null;
  drAllocAmt: number | null;
  unAllocDr: number | null;
  unAllocCr: number | null;
  partyBillNo: string | null;
  partyBillDate: string | null;
};

export type DebtorTotals = {
  drAmt: number;
  drAllocAmt: number;
  unAllocDr: number;
  unAllocCr: number;
};

export type DebtorsResult = {
  rows: DebtorRow[];
  totals: DebtorTotals;
  syncedAt: string | null;
  /** Optional joins; empty when the tables / tabs are empty. */
  billInfo: Record<string, BillInfo>;
  bgs: BgRow[];
  followUps: Record<string, FollowUp>;
  /** Legal case per accCode (debtor ledger). */
  legalCases: Record<string, LegalCaseView>;
  msme: MsmeSettings;
};

/** Sums the four money columns, treating a missing value as zero. */
export function computeDebtorTotals(
  rows: Pick<DebtorRow, "drAmt" | "drAllocAmt" | "unAllocDr" | "unAllocCr">[],
): DebtorTotals {
  const totals: DebtorTotals = {
    drAmt: 0,
    drAllocAmt: 0,
    unAllocDr: 0,
    unAllocCr: 0,
  };
  for (const row of rows) {
    totals.drAmt += row.drAmt ?? 0;
    totals.drAllocAmt += row.drAllocAmt ?? 0;
    totals.unAllocDr += row.unAllocDr ?? 0;
    totals.unAllocCr += row.unAllocCr ?? 0;
  }
  return totals;
}

/** Client-side search across the columns the page exposes. */
export function filterDebtors(rows: DebtorRow[], query: string): DebtorRow[] {
  const needle = squish(query);
  if (needle === "") return rows;
  return rows.filter((row) =>
    [
      row.accCode,
      row.accName,
      row.vrNo,
      row.partyBillNo,
      row.particular,
    ].some((value) => squish(value).includes(needle)),
  );
}
