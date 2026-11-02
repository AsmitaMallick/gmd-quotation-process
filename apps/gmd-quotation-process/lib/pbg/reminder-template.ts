import { formatAmount, formatDate } from "@/lib/pbg/format";
import { canonicalProjectName } from "@/lib/pbg/project-names";
import type { ReminderStage } from "@/lib/pbg/reminder-rules";

export type ReminderEmailRow = {
  bgNo: string | null;
  bgDate: string | null;
  bgAmtFc: number | null;
  expiryDate: string | null;
  poNumber: string | null;
  project: string | null;
  clientName: string | null;
  invoiceNos?: string[] | null;
  /** Negative means the BG has expired; 0 means it expires today. */
  daysUntilExpiry?: number | null;
};

export type ReminderEmailInput = {
  /** Kept for callers that still describe the trigger, e.g. scripts. */
  stage?: ReminderStage;
  /** All rows in the mail. Used to derive sections when not passed explicitly. */
  rows: ReminderEmailRow[];
  expiredRows?: ReminderEmailRow[];
  upcomingRows?: ReminderEmailRow[];
  onExpiryDate?: boolean;
  partyName?: string | null;
  reminderNumber?: number | null;
  earlierMailDates?: string[] | null;
  udyamNo?: string | null;
};

export type ReminderEmail = {
  subject: string;
  html: string;
  text: string;
};

const COMPANY = "G.M. Dalui & Sons Pvt. Ltd.";
const ADDRESS_LINES = [
  "19th Floor, North Wing",
  "Salt Lake, Adventz Infinity",
  "Sector V, Kolkata",
  "West Bengal – 700091",
];
const PHONE_LINES = ["+91 88200 44755", "(+91) 9147176248"];
const EMAIL_LINES = [
  "puja.agarwal@laserpowerinfra.com",
  "info@gmdalui.co.in",
];
const UDYAM_PLACEHOLDER = "[UDYAM-XX-00-0000000]";
const PRE_EXPIRY_DAYS = 30;

const PROVISIONS_BASE = [
  "Rule 171 of the General Financial Rules (GFR), 2017 – performance security is to remain valid only up to 60 days beyond the date of completion of all contractual obligations of the supplier, including warranty obligations. Our obligations are complete and this period is over, so the security is due to be returned.",
  "Micro, Small and Medium Enterprises Development (MSMED) Act, 2006 – Sections 15 & 16 – amounts due to a registered Micro/Small enterprise are to be released within the agreed period, not exceeding 45 days; delay attracts compound interest with monthly rests at three times the bank rate notified by RBI.",
];

const PROVISION_MSEFC =
  "Section 18 of the MSMED Act, 2006 – the MSE supplier may refer the matter to the Micro and Small Enterprises Facilitation Council (MSEFC), including through the MSME Samadhaan portal (samadhaan.msme.gov.in). Section 24 gives these provisions overriding effect.";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function display(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text === "" ? "—" : text;
}

function formatInvoiceList(values: string[] | null | undefined): string {
  const cleaned = Array.from(
    new Set(
      (values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  );
  return cleaned.length > 0 ? cleaned.join(", ") : "—";
}

function clientLabel(rows: ReminderEmailRow[]): string {
  const names = Array.from(
    new Set(
      rows
        .map((row) => String(row.clientName ?? "").trim())
        .filter((name) => name !== ""),
    ),
  );
  if (names.length === 1) return names[0];
  if (names.length > 1) return "PBG Portfolio";
  return "PBG Portfolio";
}

function partyLabel(input: ReminderEmailInput, rows: ReminderEmailRow[]): string {
  const explicit = String(input.partyName ?? "").trim();
  return explicit !== "" ? explicit : clientLabel(rows);
}

function isUpcomingRow(
  row: ReminderEmailRow,
  stage: ReminderStage | undefined,
): boolean {
  if (typeof row.daysUntilExpiry === "number") {
    return (
      row.daysUntilExpiry > 0 && row.daysUntilExpiry <= PRE_EXPIRY_DAYS
    );
  }
  return stage === "BEFORE_30_DAYS";
}

function isExpiredRow(
  row: ReminderEmailRow,
  stage: ReminderStage | undefined,
): boolean {
  if (typeof row.daysUntilExpiry === "number") return row.daysUntilExpiry <= 0;
  return stage !== "BEFORE_30_DAYS";
}

function sortByExpiry(rows: ReminderEmailRow[]): ReminderEmailRow[] {
  return [...rows].sort((a, b) => {
    const expiryA = String(a.expiryDate ?? "").slice(0, 10);
    const expiryB = String(b.expiryDate ?? "").slice(0, 10);
    if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);
    return String(a.bgNo ?? "").localeCompare(String(b.bgNo ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function resolveSections(input: ReminderEmailInput): {
  expiredRows: ReminderEmailRow[];
  upcomingRows: ReminderEmailRow[];
} {
  if (input.expiredRows || input.upcomingRows) {
    const expiredRows = sortByExpiry(input.expiredRows ?? []);
    const upcomingRows = sortByExpiry(input.upcomingRows ?? []);
    return { expiredRows, upcomingRows };
  }

  const expiredRows: ReminderEmailRow[] = [];
  const upcomingRows: ReminderEmailRow[] = [];
  for (const row of input.rows) {
    if (isExpiredRow(row, input.stage)) expiredRows.push(row);
    else if (isUpcomingRow(row, input.stage)) upcomingRows.push(row);
  }
  return {
    expiredRows: sortByExpiry(expiredRows),
    upcomingRows: sortByExpiry(upcomingRows),
  };
}

type PoSection = {
  poNumber: string | null;
  rows: ReminderEmailRow[];
};

/** Preserves the order rows arrive in, which is already oldest-first. */
function groupRowsByPo(rows: ReminderEmailRow[]): PoSection[] {
  const groups = new Map<string, PoSection>();
  for (const row of rows) {
    const key = String(row.poNumber ?? "").trim();
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { poNumber: row.poNumber, rows: [row] });
    }
  }
  return Array.from(groups.values());
}

function sumAmount(rows: ReminderEmailRow[]): number | null {
  let total = 0;
  let found = false;
  for (const row of rows) {
    if (row.bgAmtFc !== null && row.bgAmtFc !== undefined) {
      total += row.bgAmtFc;
      found = true;
    }
  }
  return found ? total : null;
}

function uniqueExpiryDates(rows: ReminderEmailRow[]): string[] {
  return Array.from(
    new Set(rows.map((row) => String(row.expiryDate ?? "").trim()).filter(Boolean)),
  );
}

function expiryReference(rows: ReminderEmailRow[]): string {
  const dates = uniqueExpiryDates(rows);
  return dates.length === 1
    ? formatDate(dates[0])
    : "the respective dates shown in the table above";
}

function isPlural(rows: ReminderEmailRow[]): boolean {
  return rows.length > 1;
}

function poCount(rows: ReminderEmailRow[]): number {
  return new Set(rows.map((row) => String(row.poNumber ?? "").trim())).size;
}

function reminderNumberValue(input: ReminderEmailInput): number {
  return input.reminderNumber && input.reminderNumber > 0
    ? Math.floor(input.reminderNumber)
    : 1;
}

function includeMsefc(input: ReminderEmailInput): boolean {
  return reminderNumberValue(input) >= 2;
}

function reminderLine(input: ReminderEmailInput): string {
  const reminderNumber = reminderNumberValue(input);
  const earlierDates = (input.earlierMailDates ?? [])
    .map((value) => formatDate(String(value ?? "").trim()))
    .filter((value) => value !== "—");
  const reference =
    earlierDates.length > 0
      ? ` with reference to our letters dated ${earlierDates.join(", ")}`
      : reminderNumber > 1
        ? " with reference to our earlier letters"
        : "";
  return `This is reminder no. ${reminderNumber}${reference}.`;
}

function onExpiryDay(
  input: ReminderEmailInput,
  expiredRows: ReminderEmailRow[],
): boolean {
  if (input.onExpiryDate !== undefined) return input.onExpiryDate;
  return (
    expiredRows.length > 0 &&
    expiredRows.every((row) => row.daysUntilExpiry === 0)
  );
}

function sectionAIntro(
  input: ReminderEmailInput,
  expiredRows: ReminderEmailRow[],
): string {
  const plural = isPlural(expiredRows);
  const guarantee = plural
    ? "Performance Bank Guarantees"
    : "Performance Bank Guarantee";
  const orderWord = poCount(expiredRows) > 1 ? "orders" : "order";

  if (onExpiryDay(input, expiredRows)) {
    const dates = uniqueExpiryDates(expiredRows);
    const hasExpired = plural ? "have expired" : "has expired";
    const confirmation =
      dates.length === 1
        ? `This is to confirm that the above ${guarantee} ${hasExpired} today, ${formatDate(
            dates[0],
          )}.`
        : `This is to confirm that the above ${guarantee} ${hasExpired} today; the individual expiry dates are shown in the table above.`;
    const closed = plural
      ? "The said bank guarantees are considered as closed."
      : "The said bank guarantee is considered as closed.";
    return `${reminderLine(
      input,
    )} ${confirmation} With this, the performance period against the supplied material is complete and all our liabilities under the above ${orderWord} stand over. ${closed}`;
  }

  const original = plural
    ? "original BGs / discharge letters"
    : "original BG / discharge letter";
  return `${reminderLine(
    input,
  )} The above ${guarantee} expired on ${expiryReference(
    expiredRows,
  )} and all our liabilities against the supplied material are over. However, the ${original} ${
    plural ? "have" : "has"
  } not been received back by us till date.`;
}

function msmeLine(input: ReminderEmailInput): string {
  const udyamNo = String(input.udyamNo ?? "").trim() || UDYAM_PLACEHOLDER;
  return `As we are a registered MSME (Udyam Registration No. ${udyamNo}) following are the Applicable provisions:`;
}

function sectionAClosing(
  input: ReminderEmailInput,
  expiredRows: ReminderEmailRow[],
): string {
  const original = isPlural(expiredRows)
    ? "original BGs / discharge letters"
    : "original BG / discharge letter";
  if (includeMsefc(input)) {
    return `We therefore request you to return the ${original} to the issuing bank within 7 days of this letter. In the absence of a response, we may be constrained to take up the matter with the MSEFC through the MSME Samadhaan portal, along with the bank charges incurred, without further reference to you. We look forward to your early action.`;
  }
  return `We therefore request you to return the ${original} to the issuing bank within 7 days of this letter. We look forward to your early action.`;
}

function activeProvisions(input: ReminderEmailInput): string[] {
  return includeMsefc(input)
    ? [...PROVISIONS_BASE, PROVISION_MSEFC]
    : PROVISIONS_BASE;
}

function sectionABodyHtml(
  input: ReminderEmailInput,
  expiredRows: ReminderEmailRow[],
): string {
  const items = activeProvisions(input)
    .map(
      (provision) =>
        `<li style="margin:0 0 6px;">${escapeHtml(provision)}</li>`,
    )
    .join("");
  return `<p style="margin:0 0 12px;">${escapeHtml(
    sectionAIntro(input, expiredRows),
  )}</p>
    <p style="margin:0 0 6px;">${escapeHtml(msmeLine(input))}</p>
    <ol style="margin:0 0 12px 20px;padding:0;">${items}</ol>
    <p style="margin:0;">${escapeHtml(
      sectionAClosing(input, expiredRows),
    )}</p>`;
}

function sectionABodyText(
  input: ReminderEmailInput,
  expiredRows: ReminderEmailRow[],
): string {
  const provisions = activeProvisions(input)
    .map((provision, index) => `${index + 1}. ${provision}`)
    .join("\n");
  return `${sectionAIntro(input, expiredRows)}\n\n${msmeLine(
    input,
  )}\n${provisions}\n\n${sectionAClosing(input, expiredRows)}`;
}

function sectionBInfo(upcomingRows: ReminderEmailRow[]): string {
  const plural = isPlural(upcomingRows);
  const guarantee = plural
    ? "Performance Bank Guarantees"
    : "Performance Bank Guarantee";
  return `For your information, the following ${guarantee} ${
    plural ? "are" : "is"
  } due to expire within the next 30 days. No action is requested at this stage; this is only to help you plan the return.`;
}

function buildSubject(
  input: ReminderEmailInput,
  expiredRows: ReminderEmailRow[],
  upcomingRows: ReminderEmailRow[],
): string {
  const party = partyLabel(input, [...expiredRows, ...upcomingRows]);
  const partyPart = party ? ` – ${party}` : "";

  if (expiredRows.length > 0) {
    if (onExpiryDay(input, expiredRows) && upcomingRows.length === 0) {
      return `Reminder: PBG expiring today${partyPart} | ${COMPANY}`;
    }
    return `Reminder: Expired PBG return request${partyPart} | ${COMPANY}`;
  }

  return `Information: PBG expiring within 30 days${partyPart} | ${COMPANY}`;
}

const SECTION_HEADING_STYLE =
  "margin:24px 0 10px;font-size:15px;font-weight:700;color:#7a0c0c;";
const TH_STYLE =
  "padding:10px 12px;border:1px solid #cbd5e1;background:#0f172a;color:#ffffff;text-align:left;font-size:12px;font-weight:700;letter-spacing:0.02em;";
const TD_STYLE =
  "padding:9px 12px;border:1px solid #e2e8f0;color:#1f2937;font-size:12px;vertical-align:top;";
const TD_RIGHT_STYLE = `${TD_STYLE}text-align:right;white-space:nowrap;`;
const TD_NOWRAP_STYLE = `${TD_STYLE}white-space:nowrap;`;

function formatDaysSinceExpiry(row: ReminderEmailRow): string {
  if (typeof row.daysUntilExpiry !== "number") return "—";
  return String(Math.max(0, -row.daysUntilExpiry));
}

function buildHtmlTable(section: PoSection, showDays: boolean): string {
  const total = sumAmount(section.rows);
  const columnCount = showDays ? 7 : 6;
  const rows = section.rows
    .map(
      (row) => `<tr>
        <td style="${TD_STYLE}">${escapeHtml(
          display(canonicalProjectName(row.project, row.poNumber)),
        )}</td>
        <td style="${TD_NOWRAP_STYLE}">${escapeHtml(display(row.bgNo))}</td>
        <td style="${TD_NOWRAP_STYLE}">${escapeHtml(formatDate(row.bgDate))}</td>
        <td style="${TD_RIGHT_STYLE}">${escapeHtml(formatAmount(row.bgAmtFc))}</td>
        <td style="${TD_NOWRAP_STYLE}">${escapeHtml(formatDate(row.expiryDate))}</td>
        ${
          showDays
            ? `<td style="${TD_NOWRAP_STYLE}">${escapeHtml(
                formatDaysSinceExpiry(row),
              )}</td>`
            : ""
        }
        <td style="${TD_STYLE}">${escapeHtml(formatInvoiceList(row.invoiceNos))}</td>
      </tr>`,
    )
    .join("");

  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:14px 0;font-family:Arial,Helvetica,sans-serif;">
    <thead>
      <tr>
        <th colspan="${columnCount}" style="${TH_STYLE}">PO No: ${escapeHtml(
          display(section.poNumber),
        )}</th>
      </tr>
      <tr>
        <th style="${TH_STYLE}">Project</th>
        <th style="${TH_STYLE}">BG No</th>
        <th style="${TH_STYLE}">BG Date</th>
        <th style="${TH_STYLE}text-align:right;">BG Amt (₹)</th>
        <th style="${TH_STYLE}">Expiry Date</th>
        ${
          showDays
            ? `<th style="${TH_STYLE}">Days since expiry</th>`
            : ""
        }
        <th style="${TH_STYLE}">Invoice No</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td colspan="3" style="${TD_STYLE}text-align:right;font-weight:700;">Total BG Amount</td>
        <td style="${TD_RIGHT_STYLE}font-weight:700;">${escapeHtml(
          formatAmount(total),
        )}</td>
        <td colspan="${showDays ? 3 : 2}" style="${TD_STYLE}"></td>
      </tr>
    </tbody>
  </table>`;
}

function sectionAHtml(
  input: ReminderEmailInput,
  expiredRows: ReminderEmailRow[],
): string {
  const tables = groupRowsByPo(expiredRows)
    .map((section) => buildHtmlTable(section, true))
    .join("");
  const grandTotal =
    poCount(expiredRows) > 1
      ? `<p style="margin:0 0 12px;text-align:right;"><strong>Total BG Amount Pending Return: ${escapeHtml(
          formatAmount(sumAmount(expiredRows)),
        )}</strong></p>`
      : "";
  return `<p style="${SECTION_HEADING_STYLE}">A. Expired (Return Requested)</p>
    ${tables}
    ${grandTotal}
    ${sectionABodyHtml(input, expiredRows)}`;
}

function sectionBHtml(upcomingRows: ReminderEmailRow[]): string {
  const tables = groupRowsByPo(upcomingRows)
    .map((section) => buildHtmlTable(section, false))
    .join("");
  return `<p style="${SECTION_HEADING_STYLE}">B. Expiring in Next 30 Days (For Information)</p>
    <p style="margin:0 0 12px;">${escapeHtml(sectionBInfo(upcomingRows))}</p>
    ${tables}`;
}

function buildHtml(input: ReminderEmailInput): string {
  const { expiredRows, upcomingRows } = resolveSections(input);
  const party = partyLabel(input, [...expiredRows, ...upcomingRows]);
  const address = ADDRESS_LINES.map((line) => escapeHtml(line)).join("<br/>");
  const sectionA = expiredRows.length > 0 ? sectionAHtml(input, expiredRows) : "";
  const sectionB =
    upcomingRows.length > 0 ? sectionBHtml(upcomingRows) : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:14px;line-height:1.55;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;">
      <tr>
        <td style="padding:0 0 14px;border-bottom:2px solid #7a0c0c;">
          <img src="cid:gmd-logo" alt="G.M. Dalui &amp; Sons Pvt. Ltd." width="160" style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;" />
        </td>
      </tr>
    </table>
    <p style="margin:0 0 2px;">Dear Sir/Madam,</p>
    <p style="margin:0 0 14px;font-weight:700;">${escapeHtml(party)}</p>
    ${sectionA}
    ${sectionB}
    <p style="margin:24px 0 4px;">Thanks &amp; Regards,</p>
    <p style="margin:0;"><strong>Ms. Puja Agarwal</strong><br/>Director<br/><strong>${COMPANY}</strong></p>
    <p style="margin:8px 0 0;">${address}<br/>Phone: ${escapeHtml(
      PHONE_LINES.join(" | "),
    )}<br/>Email: ${escapeHtml(EMAIL_LINES.join(" | "))}</p>
  </div>`;
}

function buildText(input: ReminderEmailInput): string {
  const { expiredRows, upcomingRows } = resolveSections(input);
  const party = partyLabel(input, [...expiredRows, ...upcomingRows]);
  const lines: string[] = ["Dear Sir/Madam,", party, ""];

  if (expiredRows.length > 0) {
    lines.push("A. Expired (Return Requested)");
    for (const section of groupRowsByPo(expiredRows)) {
      lines.push(`PO No: ${display(section.poNumber)}`);
      for (const row of section.rows) {
        lines.push(
          `- Project: ${display(
            canonicalProjectName(row.project, row.poNumber),
          )} | BG No: ${display(
            row.bgNo,
          )} | BG Date: ${formatDate(row.bgDate)} | Amount: ${formatAmount(
            row.bgAmtFc,
          )} | Expiry: ${formatDate(
            row.expiryDate,
          )} | Days since expiry: ${formatDaysSinceExpiry(
            row,
          )} | Invoice No: ${formatInvoiceList(row.invoiceNos)}`,
        );
      }
      lines.push(
        `Total BG Amount: ${formatAmount(sumAmount(section.rows))}`,
        "",
      );
    }
    if (poCount(expiredRows) > 1) {
      lines.push(
        `Total BG Amount Pending Return: ${formatAmount(
          sumAmount(expiredRows),
        )}`,
        "",
      );
    }
    lines.push(sectionABodyText(input, expiredRows), "");
  }

  if (upcomingRows.length > 0) {
    lines.push("B. Expiring in Next 30 Days (For Information)");
    lines.push(sectionBInfo(upcomingRows), "");
    for (const section of groupRowsByPo(upcomingRows)) {
      lines.push(`PO No: ${display(section.poNumber)}`);
      for (const row of section.rows) {
        lines.push(
          `- Project: ${display(
            canonicalProjectName(row.project, row.poNumber),
          )} | BG No: ${display(
            row.bgNo,
          )} | BG Date: ${formatDate(row.bgDate)} | Amount: ${formatAmount(
            row.bgAmtFc,
          )} | Expiry: ${formatDate(
            row.expiryDate,
          )} | Invoice No: ${formatInvoiceList(row.invoiceNos)}`,
        );
      }
      lines.push(
        `Total BG Amount: ${formatAmount(sumAmount(section.rows))}`,
        "",
      );
    }
  }

  lines.push(
    "Thanks & Regards,",
    "Ms. Puja Agarwal",
    "Director",
    COMPANY,
    ...ADDRESS_LINES,
    `Phone: ${PHONE_LINES.join(" | ")}`,
    `Email: ${EMAIL_LINES.join(" | ")}`,
  );

  return lines.join("\n");
}

export function buildReminderEmail(input: ReminderEmailInput): ReminderEmail {
  const { expiredRows, upcomingRows } = resolveSections(input);
  if (expiredRows.length === 0 && upcomingRows.length === 0) {
    throw new Error("Cannot build a PBG reminder email with no rows.");
  }
  return {
    subject: buildSubject(input, expiredRows, upcomingRows),
    html: buildHtml(input),
    text: buildText(input),
  };
}
