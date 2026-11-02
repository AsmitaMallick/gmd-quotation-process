/** Pure shapes and grouping for the Creditors (payables) dashboard. */
import { summarise } from "./debtorsAgeing";
import type { AgeingSummary, LedgerRow, PartyAgeing } from "./debtorsAgeing";
import type { FollowUp } from "./debtorJoins";

export type CreditorRow = {
  id: string;
  accSch: string | null;
  accCode: string;
  accName: string | null;
  vrNo: string | null;
  vrDate: string | null;
  dueDate: string | null;
  unAllocCr: number | null;
  partyBillNo: string | null;
  partyBillDate: string | null;
};

export type AdvanceRow = {
  id: string;
  accSch: string | null;
  accCode: string;
  vrNo: string | null;
  vrDate: string | null;
  unAllocDr: number | null;
  partyBillNo: string | null;
  partyBillDate: string | null;
  particular: string | null;
  narration: string | null;
};

export type CreditorsResult = {
  rows: CreditorRow[];
  advances: AdvanceRow[];
  summary: AgeingSummary;
  syncedAt: string | null;
  names: Record<string, string>; // code to name, for advance-only parties
  followUps: Record<string, FollowUp>;
};

export type VendorGroup = "local" | "customs" | "labour" | "import";
export const GROUP_LABELS: Record<VendorGroup, string> = { local: "Local vendors", customs: "Customs", labour: "Labour", import: "Import" };

// shortcut: the sheet gives only a schedule code and no vendor-type column, so this is matched on schedule/party
// text plus the importers' company suffixes; upgrade to a vendor-type flag on the party master when one exists.
const CUSTOMS = /\bcustoms?\b/i;
const LABOUR = /\blabou?rs?\b/i;
const IMPORT = /\bimport(s|ers?)?\b|\btianjin\b|\b(gmbh|pte|fzco?|fze|llc|co\.?,? ?ltd)\b/i;

export function vendorGroup(name: string | null, schedule: string | null): VendorGroup {
  const t = `${schedule ?? ""} ${name ?? ""}`;
  if (CUSTOMS.test(t)) return "customs";
  if (LABOUR.test(t)) return "labour";
  if (IMPORT.test(t)) return "import";
  return "local";
}

export type CreditorParty = PartyAgeing & {
  schedule: string | null;
  group: VendorGroup;
  /** holds both open bills and unadjusted advances: the advance should be set off against the bills */
  advanceNotAdjusted: boolean;
  oldestDue: string | null;
};

/** Bills stay positive and advances (debit) come out negative, which `summarise` books as credits. */
export function buildCreditorParties(rows: CreditorRow[], advances: AdvanceRow[], today: Date, names?: Map<string, string>) {
  const ledger: LedgerRow[] = [
    ...rows.map((r) => ({ ...r, unAllocDr: 0, unAllocCr: r.unAllocCr ?? 0 })),
    ...advances.map((a) => ({ ...a, accName: names?.get(a.accCode) ?? null, dueDate: null, unAllocDr: a.unAllocDr ?? 0, unAllocCr: 0 })),
  ];
  const summary = summarise(ledger, today, { side: "creditor" });
  const sch = new Map<string, string>();
  const oldest = new Map<string, string>();
  for (const r of [...rows, ...advances]) if (r.accSch && !sch.has(r.accCode)) sch.set(r.accCode, r.accSch);
  for (const r of rows) {
    const d = r.dueDate || r.vrDate;
    if (d && (r.unAllocCr ?? 0) > 0 && (!oldest.has(r.accCode) || d < oldest.get(r.accCode)!)) oldest.set(r.accCode, d);
  }
  const parties: CreditorParty[] = summary.parties.map((p) => {
    const schedule = sch.get(p.accCode) ?? null;
    return {
      ...p,
      schedule,
      group: vendorGroup(p.accName, schedule),
      advanceNotAdjusted: p.totalDues > 0 && p.credits > 0,
      oldestDue: oldest.get(p.accCode) ?? null,
    };
  });
  return { summary, parties };
}
