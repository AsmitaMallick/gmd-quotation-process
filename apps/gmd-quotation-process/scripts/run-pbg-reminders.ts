import "dotenv/config";
import {
  planPbgReminders,
  runScheduledPbgReminders,
} from "../schedular_function/pbg-reminders";
import { buildReminderEmail } from "../lib/pbg/reminder-template";
import { formatAmount, formatDate } from "../lib/pbg/format";
import {
  closeMailer,
  isSmtpConfigured,
  verifySmtp,
} from "../lib/services/mailer";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const send = hasFlag("send");
  const verify = hasFlag("verify");
  const showHtml = hasFlag("show-html");
  const limitArg = argValue("limit");
  const nowArg = argValue("now");
  const limit = limitArg ? Number(limitArg) : undefined;
  const now = nowArg ? new Date(`${nowArg}T09:00:00+05:30`) : new Date();

  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid --now value: ${nowArg}`);
  }

  console.log(
    `\n=== PBG REMINDERS [${send ? "SEND" : "DRY RUN"}] ${now.toISOString()} ===\n`,
  );
  console.log(
    `SMTP configured: ${isSmtpConfigured() ? "yes" : "no"}${
      send && !isSmtpConfigured() ? " (--send will fail)" : ""
    }\n`,
  );

  if (verify) {
    await verifySmtp();
    console.log("SMTP verification OK.\n");
  }

  if (send) {
    const result = await runScheduledPbgReminders({ now, limit });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const plan = await planPbgReminders(now);
  console.log(`Scanned:          ${plan.scanned}`);
  console.log(`Eligible:         ${plan.eligible}`);
  console.log(`Due rows:         ${plan.due}`);
  console.log(`Skipped no email: ${plan.skippedNoEmail}`);
  console.log(`Skipped no party: ${plan.skippedNoParty}`);
  console.log(`Skipped no PO:    ${plan.skippedNoPo}`);
  if (plan.skippedNoPoBgNos.length > 0) {
    console.log(`  no-PO BGs:      ${plan.skippedNoPoBgNos.join(", ")}`);
  }
  console.log(`Emails to send:   ${plan.tasks.length}\n`);

  const fmt = (value: Date | null) =>
    value ? value.toISOString().slice(0, 10) : "never";

  let index = 0;
  for (const task of plan.tasks) {
    index += 1;
    const email = buildReminderEmail({
      stage: task.stage,
      rows: task.rows,
      expiredRows: task.expiredRows,
      upcomingRows: task.upcomingRows,
      onExpiryDate: task.onExpiryDate,
      partyName: task.partyName,
      reminderNumber: task.reminderNumber,
      earlierMailDates: task.earlierMailDates,
      udyamNo: process.env.PBG_UDYAM_NO?.trim() || undefined,
    });
    console.log(
      `--- ${index}. ${task.stage} | ${task.partyName} | POs: ${task.poNumbers.join(
        ", ",
      )} -> ${task.emails.join(", ")} ---`,
    );
    console.log(
      `Last sent: ${fmt(task.lastSentAt)} | Next due: ${fmt(task.nextDueAt)}`,
    );
    console.log(`Subject: ${email.subject}`);
    for (const row of task.rows) {
      console.log(
        `  ${row.bgNo ?? "—"} | ${formatDate(row.bgDate)} | ${formatAmount(
          row.bgAmtFc,
        )} | ${formatDate(row.expiryDate)} | ${row.poNumber ?? "—"} | ${
          row.project ?? "—"
        } | Invoice: ${(row.invoiceNos ?? []).join(", ") || "—"} (${
          row.daysUntilExpiry
        } days)`,
      );
    }
    console.log("");
    if (showHtml) {
      console.log(email.html);
      console.log("");
    }
  }

  if (plan.tasks.length === 0) {
    console.log("Nothing due.\n");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await closeMailer();
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  });
