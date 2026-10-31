import "server-only";

import { prisma } from "@/lib/prisma";
import { getAccNameMap } from "@/lib/accMasterLookup";
import { normalizeKey } from "@/lib/gmd_lib/execution-tracking-columns";
import { getFollowUps } from "@/lib/debtors-server";
import { buildCreditorParties } from "@/lib/creditors";
import type { AdvanceRow, CreditorRow, CreditorsResult } from "@/lib/creditors";

const num = (v: { toString(): string } | null) => (v === null ? null : Number(v.toString()));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getCreditors(): Promise<CreditorsResult> {
  const [bills, advs, followUps, accNames] = await Promise.all([
    prisma.creditor.findMany({ orderBy: [{ dueDate: "asc" }, { accCode: "asc" }] }),
    prisma.creditorAdvance.findMany({ orderBy: [{ accCode: "asc" }, { vrDate: "asc" }] }),
    getFollowUps("creditor"),
    getAccNameMap(),
  ]);

  const rows: CreditorRow[] = bills.map((r) => ({
    id: r.id, accSch: r.accSch, accCode: r.accCode, accName: r.accName, vrNo: r.vrNo,
    vrDate: iso(r.vrDate), dueDate: iso(r.dueDate), unAllocCr: num(r.unAllocCr),
    partyBillNo: r.partyBillNo, partyBillDate: iso(r.partyBillDate),
  }));
  const advances: AdvanceRow[] = advs.map((a) => ({
    id: a.id, accSch: a.accSch, accCode: a.accCode, vrNo: a.vrNo, vrDate: iso(a.vrDate),
    unAllocDr: num(a.unAllocDr), partyBillNo: a.partyBillNo, partyBillDate: iso(a.partyBillDate),
    particular: a.particular, narration: a.narration,
  }));

  const names = new Map<string, string>();
  for (const a of advances) {
    const n = accNames.get(normalizeKey(a.accCode));
    if (n) names.set(a.accCode, n);
  }
  const { summary } = buildCreditorParties(rows, advances, new Date(), names);

  const latest = [...bills, ...advs].reduce<Date | null>((m, r) => (m === null || r.syncedAt > m ? r.syncedAt : m), null);
  return { rows, advances, summary, names: Object.fromEntries(names), syncedAt: latest ? latest.toISOString() : null, followUps };
}
