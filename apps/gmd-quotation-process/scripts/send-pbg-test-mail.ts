import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  buildReminderEmail,
  type ReminderEmailRow,
} from "../lib/pbg/reminder-template";
import {
  daysUntilExpiry,
  isEligibleStatus,
} from "../lib/pbg/reminder-rules";
import { isUsablePoNumber } from "../lib/pbg/reminder-recipients";
import { canonicalPbgClientName } from "../lib/pbg/project-names";
import {
  invoiceNumbersForRow,
  loadInvoiceLookup,
} from "../lib/pbg/reminder-invoices";
import {
  closeMailer,
  isSmtpConfigured,
  sendPbgMail,
} from "../lib/services/mailer";
import { mergeReminderCc } from "../lib/pbg/reminder-cc";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toNumber(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

async function main() {
  const to = (argValue("to") ?? process.env.MAIL_FROM ?? "").trim();
  const cc = mergeReminderCc(argValue("cc") ?? process.env.PBG_REMINDER_CC ?? "");
  const party = argValue("party")?.trim();
  const po = argValue("po")?.trim();
  const bgsArg = argValue("bgs")?.trim();
  const template = (argValue("template") ?? "expired").trim().toLowerCase();
  const dryRun = hasFlag("dry");
  const includeAll = hasFlag("all");
  const reminderNumber = Number(argValue("reminder-no") ?? "1");
  const earlierMailDates = (argValue("earlier-dates") ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const udyamNo =
    argValue("udyam")?.trim() || process.env.PBG_UDYAM_NO?.trim() || "";

  if (!to) {
    throw new Error("Missing --to=<email> and MAIL_FROM is empty.");
  }
  if (!party && !po && !bgsArg) {
    throw new Error("Pass --party=<partyName>, --po=<poNumber> or --bgs=<bg1,bg2>.");
  }
  if (!["expired", "before", "consolidated"].includes(template)) {
    throw new Error("--template must be 'expired', 'before' or 'consolidated'.");
  }

  const bgs = bgsArg
    ? bgsArg
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const where = bgs.length > 0
    ? {
        OR: bgs.map((bgNo) => ({
          bgNo: { equals: bgNo, mode: "insensitive" as const },
        })),
      }
    : party
      ? { clientName: { contains: party, mode: "insensitive" as const } }
      : { poNumber: { contains: po as string, mode: "insensitive" as const } };

  const rows = await prisma.pbgData.findMany({
    where,
    select: {
      id: true,
      bgNo: true,
      bgDate: true,
      bgAmtFc: true,
      expiryDate: true,
      poNumber: true,
      project: true,
      clientName: true,
      status: true,
      mailTrigger: true,
    },
    orderBy: { bgNo: "asc" },
  });

  const eligibleRows = includeAll
    ? rows
    : rows.filter((row) => isEligibleStatus(row.status));

  const selected = eligibleRows.filter((row) => {
    if (!isUsablePoNumber(row.poNumber)) return false;
    if (includeAll) return true;
    if (!row.expiryDate) return false;
    const days = daysUntilExpiry(row.expiryDate);
    if (days === null) return false;
    if (template === "expired") return days <= 0;
    if (template === "before") return days >= 0 && days <= 30;
    return days <= 30;
  });

  if (selected.length === 0) {
    throw new Error(
      `No ${template === "consolidated" ? "expired or 30-day" : template === "expired" ? "expired" : "30-day"} BGs matched the given selection.`,
    );
  }

  const invoiceLookup = await loadInvoiceLookup(selected);
  const emailRows: ReminderEmailRow[] = selected.map((row) => ({
    bgNo: row.bgNo,
    bgDate: isoDate(row.bgDate),
    bgAmtFc: toNumber(row.bgAmtFc),
    expiryDate: isoDate(row.expiryDate),
    poNumber: row.poNumber,
    project: row.project,
    clientName: canonicalPbgClientName(row.clientName),
    invoiceNos: invoiceNumbersForRow(row, invoiceLookup),
    daysUntilExpiry: row.expiryDate
      ? daysUntilExpiry(row.expiryDate)
      : null,
  }));

  const expiredEmailRows = emailRows.filter(
    (row) => (row.daysUntilExpiry ?? 0) <= 0,
  );
  const upcomingEmailRows = emailRows.filter(
    (row) =>
      typeof row.daysUntilExpiry === "number" &&
      row.daysUntilExpiry > 0 &&
      row.daysUntilExpiry <= 30,
  );

  const partyName =
    party ??
    emailRows.find((row) => String(row.clientName ?? "").trim() !== "")
      ?.clientName ??
    null;
  const poNumbers = Array.from(
    new Set(
      emailRows
        .map((row) => String(row.poNumber ?? "").trim())
        .filter(Boolean),
    ),
  ).sort();

  const onExpiryDate =
    expiredEmailRows.length > 0 &&
    expiredEmailRows.every((row) => row.daysUntilExpiry === 0);

  const email = buildReminderEmail({
    stage: expiredEmailRows.length > 0 ? "EXPIRED" : "BEFORE_30_DAYS",
    rows: emailRows,
    expiredRows: template === "before" ? [] : expiredEmailRows,
    upcomingRows: template === "expired" ? [] : upcomingEmailRows,
    onExpiryDate,
    partyName,
    reminderNumber: Number.isFinite(reminderNumber) ? reminderNumber : 1,
    earlierMailDates,
    udyamNo,
  });

  console.log("TEST MAIL");
  console.log("  to:      ", to);
  console.log("  cc:      ", cc.join(", ") || "(none)");
  console.log("  party:   ", partyName ?? "(by BG list)");
  console.log("  POs:     ", poNumbers.join(", ") || "(none)");
  console.log("  template:", template);
  console.log("  on expiry day:", onExpiryDate ? "yes" : "no");
  console.log("  reminder no.:", reminderNumber);
  console.log("  earlier dates:", earlierMailDates.join(", ") || "(none)");
  console.log("  udyam:", udyamNo || "(placeholder)");
  console.log("  subject: ", email.subject);
  console.log(
    "  bgs:     ",
    selected.map((row) => row.bgNo).join(", "),
  );
  console.log(
    "  invoices:",
    emailRows
      .map((row) => `${row.bgNo}: ${(row.invoiceNos ?? []).join(", ") || "—"}`)
      .join(" | "),
  );
  console.log("  rows:    ", selected.length);
  console.log(
    "  smtp:    ",
    isSmtpConfigured() ? "configured" : "NOT configured",
  );

  if (dryRun) {
    console.log("\nDRY RUN — no mail sent.\n");
    console.log(email.text);
    return;
  }

  if (!isSmtpConfigured()) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM.",
    );
  }

  const result = await sendPbgMail({
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  console.log("RESULT", JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(
      "TEST MAIL FAILED:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMailer();
    await prisma.$disconnect();
  });
