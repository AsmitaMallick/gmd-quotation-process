/** Legal status and doubtful-debt provision per party. Pure: no Prisma import. */

export const LEGAL_STATUSES = [
  "None",
  "Legal notice sent",
  "MSEFC conciliation",
  "MSEFC arbitration",
  "Award passed",
  "Court case – civil",
  "Court case – criminal (NI Act / BNS)",
  "NCLT-IBC claim",
  "Settled",
  "Closed",
] as const;

/**
 * The single predicate: reminders, the follow-up ladder and the collectable totals all ask this.
 * Task 6's `followUpStage` should take `underLitigation = isUnderLitigation(case?.status)` and return null when true.
 */
export const isUnderLitigation = (status: string | null | undefined): boolean => !!status && status !== "None" && status !== "Closed";

/** Everything the page edits, as strings (dates yyyy-mm-dd, numbers plain). */
export type LegalCaseView = {
  status: string | null;
  forum: string | null;
  caseNo: string | null;
  filingDate: string | null;
  nextHearingDate: string | null;
  advocate: string | null;
  claimAmount: string | null;
  interestClaimed: string | null;
  provisionPct: string | null;
  provisionAmount: string | null;
  documentLink: string | null;
  lastUpdate: string | null;
};
export const LEGAL_FIELDS = ["status", "forum", "caseNo", "filingDate", "nextHearingDate", "advocate", "claimAmount", "interestClaimed", "provisionPct", "provisionAmount", "documentLink", "lastUpdate"] as const satisfies readonly (keyof LegalCaseView)[];

export type LegalCaseInput = { ledger: string; accCode: string } & Partial<LegalCaseView>;

const text = (v: string | null | undefined) => v?.trim() || null;
const dateStr = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;
const numStr = (n: { toString(): string } | null | undefined) => (n === null || n === undefined ? null : n.toString());

/** DB row (or normalised data) to the string view the page edits and the change log compares. */
export function legalCaseToView(r: {
  status: string | null; forum: string | null; caseNo: string | null; filingDate: Date | null; nextHearingDate: Date | null;
  advocate: string | null; claimAmount: { toString(): string } | null; interestClaimed: { toString(): string } | null;
  provisionPct: number | null; provisionAmount: { toString(): string } | null; documentLink: string | null; lastUpdate: string | null;
}): LegalCaseView {
  return {
    status: r.status, forum: r.forum, caseNo: r.caseNo, filingDate: dateStr(r.filingDate), nextHearingDate: dateStr(r.nextHearingDate),
    advocate: r.advocate, claimAmount: numStr(r.claimAmount), interestClaimed: numStr(r.interestClaimed), provisionPct: numStr(r.provisionPct),
    provisionAmount: numStr(r.provisionAmount), documentLink: r.documentLink, lastUpdate: r.lastUpdate,
  };
}

function parseDate(v: string | null | undefined, label: string): { value: Date | null } | { error: string } {
  const t = text(v);
  if (!t) return { value: null };
  const d = new Date(`${t.slice(0, 10)}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}/.test(t) && !Number.isNaN(d.getTime()) ? { value: d } : { error: `${label} is not a valid date.` };
}

function parseNum(v: string | null | undefined, label: string, max?: number): { value: number | null } | { error: string } {
  const t = text(v)?.replace(/,/g, "");
  if (!t) return { value: null }; // blank clears, never 0
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && (max === undefined || n <= max) ? { value: n } : { error: `${label} must be a number${max ? ` from 0 to ${max}` : ""}.` };
}

export function normaliseLegalCase(i: LegalCaseInput) {
  if (i.ledger !== "debtor" && i.ledger !== "creditor") return { error: "Unknown ledger." };
  const accCode = text(i.accCode);
  if (!accCode) return { error: "Party code is required." };
  const status = text(i.status);
  if (status && !(LEGAL_STATUSES as readonly string[]).includes(status)) return { error: "Unknown legal status." };
  const filing = parseDate(i.filingDate, "Filing date");
  if ("error" in filing) return filing;
  const hearing = parseDate(i.nextHearingDate, "Next hearing date");
  if ("error" in hearing) return hearing;
  const claim = parseNum(i.claimAmount, "Claim amount");
  if ("error" in claim) return claim;
  const interest = parseNum(i.interestClaimed, "Interest claimed");
  if ("error" in interest) return interest;
  const pct = parseNum(i.provisionPct, "Provision %", 100);
  if ("error" in pct) return pct;
  const prov = parseNum(i.provisionAmount, "Provision amount");
  if ("error" in prov) return prov;
  return {
    data: {
      ledger: i.ledger, accCode, status, forum: text(i.forum), caseNo: text(i.caseNo), filingDate: filing.value, nextHearingDate: hearing.value,
      advocate: text(i.advocate), claimAmount: claim.value, interestClaimed: interest.value, provisionPct: pct.value, provisionAmount: prov.value,
      documentLink: text(i.documentLink), lastUpdate: text(i.lastUpdate),
    },
  };
}

/** One entry per changed field; a missing case counts as all-blank. */
export function diffLegalCase(before: LegalCaseView | null, after: LegalCaseView) {
  const out: { field: keyof LegalCaseView; oldValue: string | null; newValue: string | null }[] = [];
  for (const field of LEGAL_FIELDS) {
    const o = before?.[field] ?? null;
    const n = after[field] ?? null;
    if (o !== n) out.push({ field, oldValue: o, newValue: n });
  }
  return out;
}

/** Amount provided: an explicit amount wins over a percentage; never more than the dues, never negative. */
export function resolveProvision(c: Pick<LegalCaseView, "provisionPct" | "provisionAmount"> | undefined, dues: number): number {
  if (!c || dues <= 0) return 0;
  const amt = c.provisionAmount === null ? null : Number(c.provisionAmount);
  const pct = c.provisionPct === null ? null : Number(c.provisionPct);
  const raw = amt !== null && Number.isFinite(amt) ? amt : pct !== null && Number.isFinite(pct) ? (dues * pct) / 100 : 0;
  return Math.min(Math.max(raw, 0), dues);
}

/**
 * Splits gross dues into three parts that always add back to gross:
 * provision (written down), underLitigation (litigating dues still carried after provision), netCollectable (the rest).
 */
export function splitDues(parties: { accCode: string; totalDues: number }[], cases: Map<string, LegalCaseView>) {
  let gross = 0, underLitigation = 0, provision = 0;
  for (const p of parties) {
    const c = cases.get(p.accCode);
    const prov = resolveProvision(c, p.totalDues);
    gross += p.totalDues;
    provision += prov;
    if (isUnderLitigation(c?.status)) underLitigation += p.totalDues - prov;
  }
  return { gross, underLitigation, provision, netCollectable: gross - underLitigation - provision };
}
