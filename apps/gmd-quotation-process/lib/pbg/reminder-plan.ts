import { extractEmailsFromValue } from "@/lib/enquiryEmailParty";
import {
  groupByPartyRecipient,
  normalizePartyKey,
  normalizePoKey,
  parseRecipientEmails,
  recipientKey,
  type PartyRecipientGroup,
} from "@/lib/pbg/reminder-recipients";
import {
  isPostExpiryDue,
  isPreExpiryDue,
  POST_EXPIRY_INTERVAL_DAYS,
  PRE_EXPIRY_DAYS,
  type ReminderStage,
} from "@/lib/pbg/reminder-rules";
import type { ReminderEmailRow } from "@/lib/pbg/reminder-template";

export type PlannerRow = ReminderEmailRow & {
  id: string;
  daysUntilExpiry: number;
  contactPerson: string | null;
};

export type PlannerLog = {
  pbgId: string;
  stage: string;
  status: string;
  poNumber: string | null;
  recipientKey: string | null;
  emails: string;
  sentAt: Date;
  messageId?: string | null;
  pbgClientName?: string | null;
};

export type ExpiredReminderContext = {
  reminderNumber: number;
  earlierMailDates: string[];
};

export type PlannedTaskRow = ReminderEmailRow & {
  id: string;
  daysUntilExpiry: number;
};

export type PlannedTask = {
  stage: ReminderStage;
  partyName: string;
  partyKey: string;
  poNumbers: string[];
  recipientKey: string;
  emails: string[];
  onExpiryDate: boolean;
  lastSentAt: Date | null;
  nextDueAt: Date | null;
  reminderNumber?: number | null;
  earlierMailDates?: string[];
  /** Section A rows (expired, return requested). */
  expiredRows: PlannedTaskRow[];
  /** Section B rows (expiring within 30 days, for information). */
  upcomingRows: PlannedTaskRow[];
  /** Upcoming rows that still need a BEFORE_30_DAYS log entry. */
  preExpiryLogIds: string[];
  /** All rows in this mail, for result counters and backwards compatibility. */
  rows: PlannedTaskRow[];
};

export type ReminderPlanResult = {
  tasks: PlannedTask[];
  skippedNoEmail: number;
  dueRows: number;
};

const DAY_MS = 86_400_000;

/** Per-BG state used by the one-time 30-day reminder. */
export function buildPreExpiryLogState(logs: PlannerLog[]): {
  sent: Set<string>;
  failed: Set<string>;
} {
  const sent = new Set<string>();
  const failed = new Set<string>();

  for (const log of logs) {
    if (log.stage !== "BEFORE_30_DAYS") continue;
    if (log.status === "SENT") sent.add(log.pbgId);
    else if (log.status === "FAILED") failed.add(log.pbgId);
  }

  return { sent, failed };
}

function logGroupKey(log: PlannerLog): string | null {
  const party = normalizePartyKey(log.pbgClientName);
  const prefix = party || normalizePoKey(log.poNumber);
  if (!prefix) return null;

  const rKey =
    log.recipientKey?.trim() ||
    recipientKey(extractEmailsFromValue(log.emails ?? ""));
  if (!rKey) return null;

  return `${prefix}|${rKey}`;
}

/** Latest successful EXPIRED send per party + recipient group. */
export function buildLastExpiredSentByGroup(
  logs: PlannerLog[],
): Map<string, Date> {
  const lastSent = new Map<string, Date>();

  for (const log of logs) {
    if (log.stage !== "EXPIRED" || log.status !== "SENT") continue;
    const key = logGroupKey(log);
    if (!key) continue;

    const current = lastSent.get(key);
    if (!current || log.sentAt > current) lastSent.set(key, log.sentAt);
  }

  return lastSent;
}

/**
 * Reminder number for the mail about to be sent. The expiry-day mail is
 * reminder 1, so the number is simply the count of earlier successful cycles
 * plus one. Failed attempts are not counted and therefore retry the same
 * number.
 */
export function buildExpiredReminderContext(
  logs: PlannerLog[],
  partyName: string,
  emails: string[],
): ExpiredReminderContext {
  const party = normalizePartyKey(partyName);
  const recipients = recipientKey(emails);
  const groups = new Map<string, Date>();

  for (const log of logs) {
    if (log.stage !== "EXPIRED" || log.status !== "SENT") continue;
    if (normalizePartyKey(log.pbgClientName) !== party) continue;

    const logRecipients =
      log.recipientKey?.trim() ||
      recipientKey(extractEmailsFromValue(log.emails ?? ""));
    if (logRecipients !== recipients) continue;

    const key =
      String(log.messageId ?? "").trim() ||
      log.sentAt.toISOString().slice(0, 10);
    const current = groups.get(key);
    if (!current || log.sentAt < current) groups.set(key, log.sentAt);
  }

  const dates = Array.from(groups.values()).sort(
    (a, b) => a.getTime() - b.getTime(),
  );

  return {
    reminderNumber: dates.length + 1,
    earlierMailDates: dates.map((date) => date.toISOString().slice(0, 10)),
  };
}

function toPlannedRow(row: PlannerRow): PlannedTaskRow {
  return {
    id: row.id,
    bgNo: row.bgNo,
    bgDate: row.bgDate,
    bgAmtFc: row.bgAmtFc,
    expiryDate: row.expiryDate,
    poNumber: row.poNumber,
    project: row.project,
    clientName: row.clientName,
    invoiceNos: row.invoiceNos,
    daysUntilExpiry: row.daysUntilExpiry,
  };
}

function compareRowsByExpiry(a: PlannerRow, b: PlannerRow): number {
  const expiryA = String(a.expiryDate ?? "").slice(0, 10);
  const expiryB = String(b.expiryDate ?? "").slice(0, 10);
  if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
  return String(a.bgNo ?? "").localeCompare(String(b.bgNo ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildTask(input: {
  stage: ReminderStage;
  group: PartyRecipientGroup<PlannerRow>;
  lastSentAt: Date | null;
  context?: ExpiredReminderContext | null;
  expiredRows: PlannerRow[];
  upcomingRows: PlannerRow[];
  preExpiryLogIds: string[];
}): PlannedTask {
  const allRows = [...input.expiredRows, ...input.upcomingRows];
  const poNumbers = Array.from(
    new Set(
      allRows
        .map((row) => String(row.poNumber ?? "").trim())
        .filter((value) => value !== ""),
    ),
  ).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  const expiredRows = input.expiredRows.map(toPlannedRow);
  const upcomingRows = input.upcomingRows.map(toPlannedRow);

  return {
    stage: input.stage,
    partyName: input.group.partyName,
    partyKey: input.group.partyKey,
    poNumbers,
    recipientKey: input.group.recipientKey,
    emails: input.group.emails,
    onExpiryDate:
      expiredRows.length > 0 &&
      expiredRows.every((row) => row.daysUntilExpiry === 0),
    lastSentAt: input.lastSentAt,
    nextDueAt: input.lastSentAt
      ? new Date(input.lastSentAt.getTime() + POST_EXPIRY_INTERVAL_DAYS * DAY_MS)
      : null,
    reminderNumber: input.context?.reminderNumber ?? null,
    earlierMailDates: input.context?.earlierMailDates ?? [],
    expiredRows,
    upcomingRows,
    preExpiryLogIds: input.preExpiryLogIds,
    rows: [...expiredRows, ...upcomingRows],
  };
}

function countNoEmail(rows: PlannerRow[]): number {
  return rows.filter(
    (row) => parseRecipientEmails(row.contactPerson).length === 0,
  ).length;
}

export function planReminderTasks(input: {
  rows: PlannerRow[];
  preSent: Set<string>;
  preFailed: Set<string>;
  lastExpiredSent: Map<string, Date>;
  expiredLogs?: PlannerLog[];
  now: Date;
}): ReminderPlanResult {
  const groups = groupByPartyRecipient(
    input.rows,
    (row) => row.clientName,
    (row) => row.contactPerson,
  );

  const tasks: PlannedTask[] = [];

  for (const group of groups.values()) {
    const expiredRows = group.rows
      .filter((row) => row.daysUntilExpiry <= 0)
      .sort(compareRowsByExpiry);
    const upcomingRows = group.rows
      .filter(
        (row) =>
          row.daysUntilExpiry > 0 &&
          row.daysUntilExpiry <= PRE_EXPIRY_DAYS,
      )
      .sort(compareRowsByExpiry);

    if (expiredRows.length === 0 && upcomingRows.length === 0) continue;

    const lastSent = input.lastExpiredSent.get(group.key) ?? null;
    const expiredDue =
      expiredRows.length > 0 &&
      isPostExpiryDue(lastSent, input.now, POST_EXPIRY_INTERVAL_DAYS);

    const preDueRows = upcomingRows.filter((row) =>
      isPreExpiryDue({
        days: row.daysUntilExpiry,
        hasSent: input.preSent.has(row.id),
        hasFailed: input.preFailed.has(row.id),
      }),
    );

    // If the party has expired BGs, Section B rides along on the next Section A
    // cycle. A B-only mail is sent only when there are no expired BGs at all.
    const sendBOnly = expiredRows.length === 0 && preDueRows.length > 0;
    if (!expiredDue && !sendBOnly) continue;

    const includeExpired = expiredDue;
    const context = includeExpired
      ? buildExpiredReminderContext(
          input.expiredLogs ?? [],
          group.partyName,
          group.emails,
        )
      : null;
    const preExpiryLogIds = upcomingRows
      .filter((row) => !input.preSent.has(row.id))
      .map((row) => row.id);

    tasks.push(
      buildTask({
        stage: includeExpired ? "EXPIRED" : "BEFORE_30_DAYS",
        group,
        lastSentAt: lastSent,
        context,
        expiredRows: includeExpired ? expiredRows : [],
        upcomingRows,
        preExpiryLogIds,
      }),
    );
  }

  return {
    tasks,
    skippedNoEmail: countNoEmail(input.rows),
    dueRows: tasks.reduce((total, task) => total + task.rows.length, 0),
  };
}
