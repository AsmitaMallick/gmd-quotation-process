/** Pure helpers for the follow-up columns shared by the Debtors and Creditors ledgers. */
import type { FollowUp } from "./debtorJoins";

export type LedgerKind = "debtor" | "creditor";

/** Everything the page edits, as strings. Blank = clear. vrNo blank = party-level row. */
export type LedgerFollowUpInput = {
  ledger: string;
  accCode: string;
  vrNo?: string | null;
  owner?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  lastFollowUp?: string | null; // yyyy-mm-dd
  promisedDate?: string | null; // yyyy-mm-dd
  promisedAmount?: string | null;
  status?: string | null;
  remarks?: string | null;
  creditDays?: string | null;
  clientType?: string | null;
  udyamOnInvoice?: string | null;
  nextActionDate?: string | null; // yyyy-mm-dd
  samadhaanNo?: string | null;
  samadhaanStatus?: string | null;
};

export const CREDITOR_STATUSES = ["to pay", "on hold", "disputed", "adjust advance"] as const;

/** accCode for the party-level row, accCode|vrNo for a bill. */
export const followUpKey = (accCode: string, vrNo?: string | null) => (vrNo ? `${accCode}|${vrNo}` : accCode);

const text = (v: string | null | undefined) => v?.trim() || null;

function parseDate(v: string | null | undefined, label: string): { value: Date | null } | { error: string } {
  const t = text(v);
  if (!t) return { value: null };
  const d = new Date(`${t.slice(0, 10)}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}/.test(t) && !Number.isNaN(d.getTime()) ? { value: d } : { error: `${label} is not a valid date.` };
}

/** Validates and converts to the DB shape. A blank amount is null (clears it), never 0. */
export function normaliseFollowUp(i: LedgerFollowUpInput) {
  if (i.ledger !== "debtor" && i.ledger !== "creditor") return { error: "Unknown ledger." };
  const accCode = text(i.accCode);
  if (!accCode) return { error: "Party code is required." };
  const last = parseDate(i.lastFollowUp, "Last follow-up");
  if ("error" in last) return last;
  const promised = parseDate(i.promisedDate, "Promised date");
  if ("error" in promised) return promised;
  const amt = text(i.promisedAmount)?.replace(/,/g, "") ?? null;
  const promisedAmount = amt === null ? null : Number(amt);
  if (promisedAmount !== null && !Number.isFinite(promisedAmount)) return { error: "Promised amount must be a number." };
  const next = parseDate(i.nextActionDate, "Next action date");
  if ("error" in next) return next;
  const cd = text(i.creditDays);
  const creditDays = cd === null ? null : Number(cd);
  if (creditDays !== null && !(Number.isInteger(creditDays) && creditDays >= 0)) return { error: "Credit days must be a whole number." };
  return {
    data: {
      ledger: i.ledger as LedgerKind,
      accCode,
      vrNo: text(i.vrNo) ?? "",
      owner: text(i.owner),
      contactName: text(i.contactName),
      contactPhone: text(i.contactPhone),
      contactEmail: text(i.contactEmail),
      lastFollowUp: last.value,
      promisedDate: promised.value,
      promisedAmount,
      status: text(i.status),
      remarks: text(i.remarks),
      creditDays,
      clientType: text(i.clientType),
      udyamOnInvoice: text(i.udyamOnInvoice),
      nextActionDate: next.value,
      samadhaanNo: text(i.samadhaanNo),
      samadhaanStatus: text(i.samadhaanStatus),
    },
  };
}

type StoredRow = {
  accCode: string;
  vrNo: string;
  owner?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  lastFollowUp?: string | null;
  promisedDate?: string | null;
  promisedAmount?: string | null;
  status?: string | null;
  remarks?: string | null;
  creditDays?: string | null;
  clientType?: string | null;
  udyamOnInvoice?: string | null;
  nextActionDate?: string | null;
  samadhaanNo?: string | null;
  samadhaanStatus?: string | null;
};

/** Index rows by followUpKey; if two share a key the later one wins. */
export function indexFollowUps(rows: StoredRow[]): Record<string, FollowUp> {
  const out: Record<string, FollowUp> = {};
  for (const r of rows)
    out[followUpKey(r.accCode, r.vrNo)] = {
      owner: r.owner ?? null,
      contactName: r.contactName ?? null,
      contactPhone: r.contactPhone ?? null,
      contactEmail: r.contactEmail ?? null,
      lastFollowUp: r.lastFollowUp ?? null,
      promisedDate: r.promisedDate ?? null,
      promisedAmount: r.promisedAmount ?? null,
      status: r.status ?? null,
      remarks: r.remarks ?? null,
      creditDays: r.creditDays ?? null,
      clientType: r.clientType ?? null,
      udyamOnInvoice: r.udyamOnInvoice ?? null,
      nextActionDate: r.nextActionDate ?? null,
      samadhaanNo: r.samadhaanNo ?? null,
      samadhaanStatus: r.samadhaanStatus ?? null,
    };
  return out;
}
