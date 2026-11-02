/** MSMED Act due dates, interest and the follow-up stage ladder. Pure: no Prisma import. */
import { daysOverdue } from "./debtorsAgeing";

export type MsmeSettings = { bankRatePct: number; defaultCreditDays: number; creditDaysNoAgreement: number };
export const DEFAULT_MSME_SETTINGS: MsmeSettings = { bankRatePct: 5.75, defaultCreditDays: 45, creditDaysNoAgreement: 15 };
export const MSME_SETTING_TYPES = { bankRatePct: "msme.bankRatePct", defaultCreditDays: "msme.defaultCreditDays", creditDaysNoAgreement: "msme.creditDaysNoAgreement" } as const;

/** LookupOption rows to settings; a missing or non-numeric row keeps the documented default. */
export function parseMsmeSettings(rows: { type: string; value: string }[]): MsmeSettings {
  const out = { ...DEFAULT_MSME_SETTINGS };
  for (const k of Object.keys(MSME_SETTING_TYPES) as (keyof MsmeSettings)[]) {
    const raw = rows.find((r) => r.type === MSME_SETTING_TYPES[k])?.value?.trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

const MAX_CREDIT_DAYS = 45; // the Act's ceiling even where a longer period is agreed

/** Missing credit days means no written agreement: the no-agreement period (15), never the 45-day default. */
export function msmeDueDate(billDate: Date, creditDays: number | null, noAgreementDays = DEFAULT_MSME_SETTINGS.creditDaysNoAgreement): Date {
  const days = Math.min(creditDays ?? noAgreementDays, MAX_CREDIT_DAYS);
  return new Date(billDate.getTime() + days * 86_400_000);
}

/** 3 x bank rate, compounded monthly, whole months elapsed. */
export function msmeInterest(principal: number, from: Date, to: Date, bankRatePct: number): number {
  const months = Math.max(0, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() - (to.getUTCDate() < from.getUTCDate() ? 1 : 0));
  const r = (3 * bankRatePct) / 100;
  return principal * ((1 + r / 12) ** months - 1);
}

export type FollowUpStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** Days past the MSME due date to stage. Under litigation: null, so no reminder is ever sent. */
export function followUpStage(daysPastMsmeDue: number, promiseMissed: boolean, underLitigation = false): FollowUpStage | null {
  if (underLitigation) return null;
  const d = daysPastMsmeDue;
  const s: FollowUpStage = d >= 60 ? 6 : d >= 45 ? 5 : d >= 30 ? 4 : d >= 15 ? 3 : d >= 7 ? 2 : d >= 0 ? 1 : 0; // -7 and below stay at 0 (reminder window)
  return promiseMissed ? 3 : s;
}

export type PartyMsme = { daysPastDue: number | null; interest: number; claimable: number; stage: FollowUpStage | null };

/** One party, all its open positive bills. creditDays is the party-level agreed period. */
export function partyMsme(
  bills: { bal: number; vrDate: string | null }[],
  creditDays: number | null,
  s: MsmeSettings,
  today: Date,
  o: { promiseMissed: boolean; underLitigation: boolean },
): PartyMsme {
  let daysPastDue: number | null = null;
  let principal = 0;
  let interest = 0;
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  for (const b of bills) {
    if (b.bal <= 0 || !b.vrDate) continue;
    const due = msmeDueDate(new Date(b.vrDate), creditDays, s.creditDaysNoAgreement);
    const days = daysOverdue(due.toISOString(), today);
    if (days === null) continue;
    principal += b.bal;
    if (daysPastDue === null || days > daysPastDue) daysPastDue = days;
    if (days > 0) interest += msmeInterest(b.bal, due, end, s.bankRatePct);
  }
  return { daysPastDue, interest, claimable: principal + interest, stage: daysPastDue === null ? null : followUpStage(daysPastDue, o.promiseMissed, o.underLitigation) };
}

/** Due-today list: next action date reached, or a promise date passed with money still overdue. */
export function dueToday(p: { nextActionDate: string | null; promisedDate: string | null; overdue: number; underLitigation: boolean }, today: Date): boolean {
  if (p.underLitigation) return false; // never remind a party we are in arbitration or court with
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const act = p.nextActionDate?.slice(0, 10);
  const prom = p.promisedDate?.slice(0, 10);
  return (!!act && act <= iso) || (!!prom && prom < iso && p.overdue > 0);
}
