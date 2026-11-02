/**
 * Daily PBG reminder job.
 *
 * Selection:
 *   - `mailTrigger = CONTINUE`
 *   - status OPEN / Running / Expired (CLOSED is never eligible)
 *   - `expiryDate` is set
 *
 * Cadence:
 *   - BEFORE_30_DAYS: exactly 30 calendar days before expiry, once (failed
 *     attempts retry on subsequent days while the BG is still unexpired).
 *   - EXPIRED: on the expiry date, then every 7 days until the row is set back
 *     to HOLD or its status becomes CLOSED.
 *
 * Sending is direct SMTP (`lib/services/mailer.ts`); n8n is not involved.
 */

import { prisma } from "@/lib/prisma";
import { isSmtpConfigured, sendPbgMail } from "@/lib/services/mailer";
import { buildReminderEmail } from "@/lib/pbg/reminder-template";
import {
  buildLastExpiredSentByGroup,
  buildPreExpiryLogState,
  planReminderTasks,
  type PlannedTask,
  type PlannedTaskRow,
  type PlannerRow,
} from "@/lib/pbg/reminder-plan";
import {
  isUsablePoNumber,
  normalizePartyKey,
  normalizePoKey,
} from "@/lib/pbg/reminder-recipients";
import { canonicalPbgClientName } from "@/lib/pbg/project-names";
import {
  invoiceNumbersForRow,
  loadInvoiceLookup,
} from "@/lib/pbg/reminder-invoices";
import {
  daysUntilExpiry,
  isEligibleStatus,
  isMailTriggerContinue,
  type ReminderStage,
} from "@/lib/pbg/reminder-rules";
import { mergeReminderCc } from "@/lib/pbg/reminder-cc";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type PbgReminderJobName = "pbg-reminders";

export type PbgReminderTaskRow = PlannedTaskRow;
export type PbgReminderTask = PlannedTask;

export type PbgReminderPlan = {
  scanned: number;
  eligible: number;
  due: number;
  skippedNoEmail: number;
  skippedNoParty: number;
  skippedNoPo: number;
  skippedNoPoBgNos: string[];
  tasks: PbgReminderTask[];
};

export type PbgReminderTaskResult = {
  stage: ReminderStage;
  partyName: string;
  partyKey: string;
  poNumbers: string[];
  recipientKey: string;
  recipients: string[];
  bgNumbers: string[];
  status: "SENT" | "FAILED" | "PLANNED";
  messageId?: string;
  error?: string;
};

export type ScheduledPbgRemindersResult = {
  success: boolean;
  job: PbgReminderJobName;
  startedAt: string;
  elapsedMs: number;
  dryRun: boolean;
  scanned: number;
  eligible: number;
  due: number;
  emailsSent: number;
  emailsFailed: number;
  rowsSent: number;
  rowsFailed: number;
  skippedNoEmail: number;
  skippedNoParty: number;
  skippedNoPo: number;
  skippedNoPoBgNos: string[];
  skippedBatchLimit: number;
  tasks: PbgReminderTaskResult[];
};

export type PbgReminderOptions = {
  now?: Date;
  dryRun?: boolean;
  /** Maximum number of emails to send in this run. */
  limit?: number;
  /** Delay between sends in milliseconds. */
  delayMs?: number;
};

type Candidate = {
  id: bigint;
  idText: string;
  bgNo: string | null;
  bgDate: string | null;
  bgAmtFc: number | null;
  expiryDate: string;
  poNumber: string | null;
  project: string | null;
  clientName: string | null;
  contactPerson: string | null;
  status: string | null;
  mailTrigger: string | null;
  days: number;
};

function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toNumber(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseCc(): string[] {
  return mergeReminderCc(process.env.PBG_REMINDER_CC ?? "");
}

/**
 * Reads the eligible rows and works out which ones are due right now. Pure
 * planning: no mail is sent and no log is written.
 */
export async function planPbgReminders(
  now: Date = new Date(),
): Promise<PbgReminderPlan> {
  const allRows = await prisma.pbgData.findMany({
    where: { expiryDate: { not: null } },
    select: {
      id: true,
      bgNo: true,
      bgDate: true,
      bgAmtFc: true,
      expiryDate: true,
      poNumber: true,
      project: true,
      clientName: true,
      contactPerson: true,
      status: true,
      mailTrigger: true,
    },
    orderBy: { id: "asc" },
  });

  const eligible: Candidate[] = [];
  for (const row of allRows) {
    if (!row.expiryDate) continue;
    if (!isMailTriggerContinue(row.mailTrigger)) continue;
    if (!isEligibleStatus(row.status)) continue;

    const days = daysUntilExpiry(row.expiryDate, now);
    if (days === null) continue;

    eligible.push({
      id: row.id,
      idText: row.id.toString(),
      bgNo: row.bgNo,
      bgDate: toIsoDate(row.bgDate),
      bgAmtFc: toNumber(row.bgAmtFc),
      expiryDate: toIsoDate(row.expiryDate) as string,
      poNumber: row.poNumber,
      project: row.project,
      clientName: canonicalPbgClientName(row.clientName),
      contactPerson: row.contactPerson,
      status: row.status,
      mailTrigger: row.mailTrigger,
      days,
    });
  }

  const withParty = eligible.filter(
    (row) => normalizePartyKey(row.clientName) !== "",
  );
  const noParty = eligible.filter(
    (row) => normalizePartyKey(row.clientName) === "",
  );
  const noPo = withParty.filter((row) => !isUsablePoNumber(row.poNumber));
  const withPo = withParty.filter((row) => isUsablePoNumber(row.poNumber));
  const skippedNoPoBgNos = noPo.map((row) => row.bgNo ?? row.idText);
  const skippedNoParty = noParty.length;

  if (withPo.length === 0) {
    return {
      scanned: allRows.length,
      eligible: eligible.length,
      due: 0,
      skippedNoEmail: 0,
      skippedNoParty,
      skippedNoPo: noPo.length,
      skippedNoPoBgNos,
      tasks: [],
    };
  }

  const pbgIds = withPo.map((row) => row.id);

  const [preLogs, expiredLogs, invoiceLookup] = await Promise.all([
    prisma.pbgReminderLog.findMany({
      where: { stage: "BEFORE_30_DAYS", pbgId: { in: pbgIds } },
      select: {
        pbgId: true,
        stage: true,
        status: true,
        poNumber: true,
        recipientKey: true,
        emails: true,
        sentAt: true,
      },
    }),
    prisma.pbgReminderLog.findMany({
      where: {
        stage: "EXPIRED",
        status: "SENT",
        pbgId: { in: pbgIds },
      },
      select: {
        pbgId: true,
        stage: true,
        status: true,
        poNumber: true,
        recipientKey: true,
        emails: true,
        sentAt: true,
        messageId: true,
        pbg: { select: { clientName: true } },
      },
    }),
    loadInvoiceLookup(withPo),
  ]);

  const preState = buildPreExpiryLogState(
    preLogs.map((log) => ({ ...log, pbgId: log.pbgId.toString() })),
  );
  const expiredPlannerLogs = expiredLogs.map((log) => ({
    pbgId: log.pbgId.toString(),
    stage: log.stage,
    status: log.status,
    poNumber: log.poNumber,
    recipientKey: log.recipientKey,
    emails: log.emails,
    sentAt: log.sentAt,
    messageId: log.messageId,
    pbgClientName: canonicalPbgClientName(log.pbg.clientName),
  }));
  const lastExpiredSent = buildLastExpiredSentByGroup(expiredPlannerLogs);

  const plannerRows: PlannerRow[] = withPo.map((row) => ({
    id: row.idText,
    bgNo: row.bgNo,
    bgDate: row.bgDate,
    bgAmtFc: row.bgAmtFc,
    expiryDate: row.expiryDate,
    poNumber: row.poNumber,
    project: row.project,
    clientName: row.clientName,
    invoiceNos: invoiceNumbersForRow(row, invoiceLookup),
    daysUntilExpiry: row.days,
    contactPerson: row.contactPerson,
  }));

  const result = planReminderTasks({
    rows: plannerRows,
    preSent: preState.sent,
    preFailed: preState.failed,
    lastExpiredSent,
    expiredLogs: expiredPlannerLogs,
    now,
  });

  return {
    scanned: allRows.length,
    eligible: eligible.length,
    due: result.dueRows,
    skippedNoEmail: result.skippedNoEmail,
    skippedNoParty,
    skippedNoPo: noPo.length,
    skippedNoPoBgNos,
    tasks: result.tasks,
  };
}

async function writeLogs(
  task: PbgReminderTask,
  status: "SENT" | "FAILED",
  messageId: string | undefined,
  error: string | undefined,
): Promise<void> {
  const preExpiryIds = new Set(task.preExpiryLogIds);
  const entries = [
    ...task.expiredRows.map((row) => ({
      row,
      stage: "EXPIRED" as const,
    })),
    ...task.upcomingRows
      .filter((row) => preExpiryIds.has(row.id))
      .map((row) => ({
        row,
        stage: "BEFORE_30_DAYS" as const,
      })),
  ];

  if (entries.length === 0) return;

  await prisma.pbgReminderLog.createMany({
    data: entries.map(({ row, stage }) => ({
      pbgId: BigInt(row.id),
      stage,
      poNumber: normalizePoKey(row.poNumber),
      recipientKey: task.recipientKey,
      emails: task.emails.join(", "),
      status,
      messageId: messageId ?? null,
      error: error ?? null,
    })),
  });
}

const inFlight = new Set<PbgReminderJobName>();

/**
 * Runs the reminder pass. With `dryRun` it only plans and renders, never
 * sending or writing logs.
 */
export async function runScheduledPbgReminders(
  options: PbgReminderOptions = {},
): Promise<ScheduledPbgRemindersResult> {
  const job: PbgReminderJobName = "pbg-reminders";
  if (inFlight.has(job)) throw new JobAlreadyRunningError(job);
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? positiveInt(process.env.PBG_REMINDER_BATCH_SIZE, 25);
  const delayMs =
    options.delayMs ?? positiveInt(process.env.PBG_REMINDER_DELAY_MS, 1_000);

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);
    const plan = await planPbgReminders(now);

    if (!dryRun && plan.tasks.length > 0 && !isSmtpConfigured()) {
      throw new Error(
        "SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS before enabling PBG reminders.",
      );
    }

    const tasks = plan.tasks.slice(0, limit);
    const skippedBatchLimit = plan.tasks
      .slice(limit)
      .reduce((sum, task) => sum + task.rows.length, 0);

    const results: PbgReminderTaskResult[] = [];
    let emailsSent = 0;
    let emailsFailed = 0;
    let rowsSent = 0;
    let rowsFailed = 0;

    const cc = parseCc();
    const udyamNo = process.env.PBG_UDYAM_NO?.trim() || undefined;
    if (!udyamNo && tasks.some((task) => task.expiredRows.length > 0)) {
      console.warn(
        "[pbg-reminders] PBG_UDYAM_NO is not set; expired mails will show the placeholder.",
      );
    }

    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const email = buildReminderEmail({
        stage: task.stage,
        rows: task.rows,
        expiredRows: task.expiredRows,
        upcomingRows: task.upcomingRows,
        onExpiryDate: task.onExpiryDate,
        partyName: task.partyName,
        reminderNumber: task.reminderNumber,
        earlierMailDates: task.earlierMailDates,
        udyamNo,
      });
      const bgNumbers = task.rows
        .map((row) => row.bgNo)
        .filter((bgNo): bgNo is string => Boolean(bgNo));

      if (dryRun) {
        results.push({
          stage: task.stage,
          partyName: task.partyName,
          partyKey: task.partyKey,
          poNumbers: task.poNumbers,
          recipientKey: task.recipientKey,
          recipients: task.emails,
          bgNumbers,
          status: "PLANNED",
        });
        continue;
      }

      const send = await sendPbgMail({
        to: task.emails,
        cc: cc.length > 0 ? cc : undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      if (send.ok) {
        await writeLogs(task, "SENT", send.messageId, undefined);
        emailsSent += 1;
        rowsSent += task.rows.length;
        results.push({
          stage: task.stage,
          partyName: task.partyName,
          partyKey: task.partyKey,
          poNumbers: task.poNumbers,
          recipientKey: task.recipientKey,
          recipients: task.emails,
          bgNumbers,
          status: "SENT",
          messageId: send.messageId,
        });
        console.log(
          `[pbg-reminders] sent ${task.stage} to ${task.emails.join(", ")} (${task.rows.length} BG)`,
        );
      } else {
        await writeLogs(task, "FAILED", undefined, send.error);
        emailsFailed += 1;
        rowsFailed += task.rows.length;
        results.push({
          stage: task.stage,
          partyName: task.partyName,
          partyKey: task.partyKey,
          poNumbers: task.poNumbers,
          recipientKey: task.recipientKey,
          recipients: task.emails,
          bgNumbers,
          status: "FAILED",
          error: send.error,
        });
        console.warn(
          `[pbg-reminders] failed ${task.stage} to ${task.emails.join(", ")}: ${send.error}`,
        );
      }

      if (index < tasks.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const elapsedMs = Date.now() - startedAtMs;
    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — eligible=${plan.eligible} due=${plan.due} ` +
        `sent=${emailsSent} failed=${emailsFailed} skippedNoEmail=${plan.skippedNoEmail} ` +
        `skippedNoParty=${plan.skippedNoParty} skippedNoPo=${plan.skippedNoPo} ` +
        `skippedBatch=${skippedBatchLimit}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return {
      success: emailsFailed === 0,
      job,
      startedAt,
      elapsedMs,
      dryRun,
      scanned: plan.scanned,
      eligible: plan.eligible,
      due: plan.due,
      emailsSent,
      emailsFailed,
      rowsSent,
      rowsFailed,
      skippedNoEmail: plan.skippedNoEmail,
      skippedNoParty: plan.skippedNoParty,
      skippedNoPo: plan.skippedNoPo,
      skippedNoPoBgNos: plan.skippedNoPoBgNos,
      skippedBatchLimit,
      tasks: results,
    };
  } finally {
    inFlight.delete(job);
  }
}
