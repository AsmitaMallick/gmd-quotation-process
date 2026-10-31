/** Pure joins/helpers for the Debtors dashboard: bill info, BG exposure, follow-ups, CSV. */
import { followUpKey } from "./ledgerFollowUp";

export type BillInfo = {
  orderNo: string | null; // SALE BILL ORDER_VRNO
  poRef: string | null; // SALE BILL PARTYREFNO
  items: string | null;
  orderCopy: string | null;
  invoice: string | null;
  inspectionReport: string | null;
  driveLink: string | null;
};
export type BgRow = { beneficiaryName: string | null; bgAmt: number | null; cancelledStatus: string | null };
export type FollowUp = {
  owner: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  lastFollowUp: string | null; // yyyy-mm-dd
  promisedDate: string | null; // yyyy-mm-dd
  promisedAmount: string | null;
  status: string | null;
  remarks: string | null;
  creditDays: string | null; // agreed days, blank = no written agreement
  clientType: string | null;
  udyamOnInvoice: string | null;
  nextActionDate: string | null; // yyyy-mm-dd
  samadhaanNo: string | null;
  samadhaanStatus: string | null;
};
export const EMPTY_FOLLOW_UP: FollowUp = { owner: null, contactName: null, contactPhone: null, contactEmail: null, lastFollowUp: null, promisedDate: null, promisedAmount: null, status: null, remarks: null, creditDays: null, clientType: null, udyamOnInvoice: null, nextActionDate: null, samadhaanNo: null, samadhaanStatus: null };

type SaleBillIn = { vrNo: string; orderVrNo: string | null; partyRefNo: string | null; itemCode: string | null };
type SaleRegIn = { invoiceNo: string; itemName: string | null; orderCopy: string | null; invoice: string | null; inspectionReport: string | null; driveLink: string | null };

const key = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/** One entry per VRNO / INVOICE NO. A sale bill can span several item rows: items are joined, first non-blank link wins. */
export function buildBillInfo(bills: SaleBillIn[], regs: SaleRegIn[]): Record<string, BillInfo> {
  const out: Record<string, BillInfo> = {};
  const get = (k: string) =>
    (out[k] ??= { orderNo: null, poRef: null, items: null, orderCopy: null, invoice: null, inspectionReport: null, driveLink: null });
  const addItem = (i: BillInfo, v: string | null) => {
    if (v && !(i.items ?? "").split(", ").includes(v)) i.items = i.items ? `${i.items}, ${v}` : v;
  };
  for (const b of bills) {
    const i = get(key(b.vrNo));
    i.orderNo ??= b.orderVrNo;
    i.poRef ??= b.partyRefNo;
    addItem(i, b.itemCode);
  }
  for (const r of regs) {
    const i = get(key(r.invoiceNo));
    i.orderCopy ||= r.orderCopy;
    i.invoice ||= r.invoice;
    i.inspectionReport ||= r.inspectionReport;
    i.driveLink ||= r.driveLink;
    addItem(i, r.itemName);
  }
  return out;
}
export const billInfoFor = (m: Record<string, BillInfo>, vrNo: string | null) => m[key(vrNo)];

/** Open (not CLOSED/CANCELLED) BG amount per party name.
 * shortcut: beneficiary matched to party by exact upper-cased, whitespace-collapsed name; 13 of 19 match today, upgrade to an alias table for the rest. */
export function bgExposureByName(bgs: BgRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bgs) {
    if (/CLOSED|CANCEL/.test(key(b.cancelledStatus))) continue;
    const k = key(b.beneficiaryName);
    if (k) m.set(k, (m.get(k) ?? 0) + (b.bgAmt ?? 0));
  }
  return m;
}
export const bgFor = (m: Map<string, number>, partyName: string) => m.get(key(partyName)) ?? 0;

export const followUpFor = (m: Record<string, FollowUp>, accCode: string, vrNo?: string | null) => m[followUpKey(accCode, vrNo)];

/**
 * A credit / sales-return row is TCODE "P" with PARTICULAR "Sales against Order/Bill No-<VRNO>"; returns that VRNO, else null.
 * shortcut: matches this one wording (2 of 269 rows today), upgrade if Accounts book credit notes with another format.
 */
export function creditNoteRefOf(particular: string | null | undefined, tCode: string | null | undefined): string | null {
  if (tCode?.trim().toUpperCase() !== "P") return null;
  return /Order\/Bill\s*No\s*-\s*([A-Za-z0-9][A-Za-z0-9/-]*)/i.exec(particular ?? "")?.[1] ?? null;
}

/** Bill VRNO (normalised) to the credit-note voucher numbers that knock it off. */
export function creditNotesByBill(rows: { vrNo: string | null; tCode: string | null; particular: string | null }[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const ref = creditNoteRefOf(r.particular, r.tCode);
    if (ref && r.vrNo) m.set(key(ref), [...(m.get(key(ref)) ?? []), r.vrNo]);
  }
  return m;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
