import "server-only";

import { prisma } from "@/lib/prisma";
import { computeDebtorTotals } from "@/lib/debtors";
import type { DebtorRow, DebtorsResult } from "@/lib/debtors";
import { buildBillInfo } from "@/lib/debtorJoins";
import { indexFollowUps } from "@/lib/ledgerFollowUp";
import type { LedgerSide } from "@/lib/debtorsAgeing";
import type { FollowUp } from "@/lib/debtorJoins";
import { parseMsmeSettings } from "@/lib/msme";
import type { MsmeSettings } from "@/lib/msme";
import { legalCaseToView } from "@/lib/legalStatus";
import type { LegalCaseView } from "@/lib/legalStatus";

/** DB is authoritative for follow-ups (no cache, so a fresh edit is never overwritten by a stale read). */
export async function getFollowUps(ledger: LedgerSide): Promise<Record<string, FollowUp>> {
  const rows = await prisma.ledgerFollowUp.findMany({ where: { ledger }, orderBy: { updatedAt: "asc" } });
  return indexFollowUps(
    rows.map((r) => ({
      ...r,
      lastFollowUp: r.lastFollowUp?.toISOString().slice(0, 10) ?? null,
      promisedDate: r.promisedDate?.toISOString().slice(0, 10) ?? null,
      promisedAmount: r.promisedAmount?.toString() ?? null,
      creditDays: r.creditDays?.toString() ?? null,
      nextActionDate: r.nextActionDate?.toISOString().slice(0, 10) ?? null,
    })),
  );
}

/** Legal cases keyed by accCode. */
export async function getLegalCases(ledger: LedgerSide): Promise<Record<string, LegalCaseView>> {
  const rows = await prisma.partyLegalCase.findMany({ where: { ledger } });
  return Object.fromEntries(rows.map((r) => [r.accCode, legalCaseToView(r)]));
}

/** Settings live as LookupOption rows (edited on /admin/lookup-options); absent rows fall back to the documented defaults. */
export async function loadMsmeSettings(): Promise<MsmeSettings> {
  const rows = await prisma.lookupOption.findMany({ where: { type: { startsWith: "msme." }, isActive: true }, select: { type: true, value: true } });
  return parseMsmeSettings(rows);
}

function toNum(value: { toString(): string } | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function getDebtors(): Promise<DebtorsResult> {
  const [bills, regs, bgRecords, followUps, legalCases, msme] = await Promise.all([
    prisma.saleBill.findMany({ select: { vrNo: true, orderVrNo: true, partyRefNo: true, itemCode: true } }),
    prisma.saleRegister.findMany({ select: { invoiceNo: true, itemName: true, orderCopy: true, invoice: true, inspectionReport: true, driveLink: true } }),
    prisma.bankGuarantee.findMany({ select: { beneficiaryName: true, bgAmt: true, cancelledStatus: true } }),
    getFollowUps("debtor"),
    getLegalCases("debtor"),
    loadMsmeSettings(),
  ]);

  const records = await prisma.debtor.findMany({
    orderBy: [{ dueDate: "asc" }, { accCode: "asc" }],
    select: {
      id: true,
      accSch: true,
      accCode: true,
      accName: true,
      tCode: true,
      vrNo: true,
      vrDate: true,
      dueDate: true,
      particular: true,
      drAmt: true,
      drAllocAmt: true,
      unAllocDr: true,
      unAllocCr: true,
      partyBillNo: true,
      partyBillDate: true,
      syncedAt: true,
    },
  });

  const rows: DebtorRow[] = records.map((row) => ({
    id: row.id,
    accSch: row.accSch,
    accCode: row.accCode,
    accName: row.accName,
    tCode: row.tCode,
    vrNo: row.vrNo,
    vrDate: toIso(row.vrDate),
    dueDate: toIso(row.dueDate),
    particular: row.particular,
    drAmt: toNum(row.drAmt),
    drAllocAmt: toNum(row.drAllocAmt),
    unAllocDr: toNum(row.unAllocDr),
    unAllocCr: toNum(row.unAllocCr),
    partyBillNo: row.partyBillNo,
    partyBillDate: toIso(row.partyBillDate),
  }));

  const latestSyncedAt = records.reduce<Date | null>(
    (latest, row) => (latest === null || row.syncedAt > latest ? row.syncedAt : latest),
    null,
  );

  return {
    rows,
    totals: computeDebtorTotals(rows),
    syncedAt: latestSyncedAt ? latestSyncedAt.toISOString() : null,
    billInfo: buildBillInfo(bills, regs),
    bgs: bgRecords.map((b) => ({ ...b, bgAmt: toNum(b.bgAmt) })),
    followUps,
    legalCases,
    msme,
  };
}
