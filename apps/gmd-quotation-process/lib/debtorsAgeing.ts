/** Pure outstanding / ageing maths shared by the Debtors and Creditors dashboards. */
import type { DebtorRow } from "./debtors";

export const BUCKETS = ["Not due", "0-30", "31-60", "61-90", "91-180", "180+"] as const;
export type Bucket = (typeof BUCKETS)[number];

const DAY = 86_400_000;

export type LedgerSide = "debtor" | "creditor";
export type LedgerRow = Pick<DebtorRow, "accCode" | "accName" | "dueDate" | "vrDate" | "unAllocDr" | "unAllocCr">;

// creditor balance is credit minus debit, so advances come out negative
export const outstanding = (r: Pick<DebtorRow, "unAllocDr" | "unAllocCr">, side: LedgerSide = "debtor") =>
  side === "creditor"
    ? (r.unAllocCr ?? 0) - (r.unAllocDr ?? 0)
    : (r.unAllocDr ?? 0) - (r.unAllocCr ?? 0);

/** Bills without a due date age from the voucher date. */
export const effectiveDueDate = (dueDate: string | null, vrDate: string | null) => dueDate || vrDate || null;

/** today - due date in whole UTC days; negative = not yet due; null when no due date. */
export function daysOverdue(dueDate: string | null, today: Date): number | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((t - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / DAY);
}

export function bucketOf(days: number | null): Bucket {
  if (days === null || days <= 0) return "Not due"; // shortcut: no due date and no voucher date counts as not due, upgrade if such rows appear
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  if (days <= 180) return "91-180";
  return "180+";
}

export type PartyAgeing = {
  accCode: string;
  accName: string;
  totalDues: number; // sum of positive balances
  overdue: number;
  over90: number;
  credits: number; // unadjusted credits as a positive number
  net: number; // dues - credits
  buckets: Record<Bucket, number>;
};

export type AgeingSummary = {
  parties: PartyAgeing[]; // sorted by overdue desc
  buckets: Record<Bucket, number>;
  totalDues: number;
  overdue: number;
  over90: number;
  credits: number;
  net: number;
};

const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;

export function summarise(rows: LedgerRow[], today: Date, opts: { side?: LedgerSide } = {}): AgeingSummary {
  const map = new Map<string, PartyAgeing>();
  const buckets = emptyBuckets();
  for (const r of rows) {
    const bal = outstanding(r, opts.side);
    if (bal === 0) continue;
    let p = map.get(r.accCode);
    if (!p) {
      p = { accCode: r.accCode, accName: r.accName ?? r.accCode, totalDues: 0, overdue: 0, over90: 0, credits: 0, net: 0, buckets: emptyBuckets() };
      map.set(r.accCode, p);
    }
    if (bal < 0) {
      p.credits -= bal;
      continue;
    }
    const days = daysOverdue(effectiveDueDate(r.dueDate, r.vrDate), today);
    const b = bucketOf(days);
    p.totalDues += bal;
    p.buckets[b] += bal;
    buckets[b] += bal;
    if (b !== "Not due") p.overdue += bal;
    if (b === "91-180" || b === "180+") p.over90 += bal;
  }
  const parties = [...map.values()].sort((a, b) => b.overdue - a.overdue || b.totalDues - a.totalDues || a.accCode.localeCompare(b.accCode));
  const sum = (f: (p: PartyAgeing) => number) => parties.reduce((s, p) => s + f(p), 0);
  for (const p of parties) p.net = p.totalDues - p.credits;
  const totalDues = sum((p) => p.totalDues);
  const credits = sum((p) => p.credits);
  return { parties, buckets, totalDues, overdue: sum((p) => p.overdue), over90: sum((p) => p.over90), credits, net: totalDues - credits };
}

/** Lakh format: 1234567 -> "₹12.35 L"; crores above 1e7. */
export function formatLakh(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  return `${s}₹${(a / 1e5).toFixed(2)} L`;
}
