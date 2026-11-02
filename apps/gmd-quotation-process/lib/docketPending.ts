export const PARTY_LOOKUP_TYPE = "PARTY";

export const LASER_ENTRY_EMAILS = [
  "laserentry.four@gmail.com",
  "enquiry5.laserpowerinfra@gmail.com",
];

export const LASER_ENTRY_TEXT_EMAIL = "laserentry.four@gmail.com";

export const DOCKET_CREATION_PATTERNS = [
  /create\s+(?:a\s+|the\s+)?docket/i,
  /docket\s+creation/i,
  /request\s+(?:for|to)\s+(?:create\s+)?(?:a\s+)?docket/i,
  /generate\s+(?:a\s+|the\s+)?docket/i,
  /make\s+(?:a\s+|the\s+)?docket/i,
  /docket\s+request/i,
  /open\s+(?:a\s+|the\s+)?docket/i,
  /pls\s+create\s+docket/i,
  /plz\s+create\s+docket/i,
  /kindly\s+create\s+docket/i,
  /please\s+create\s+docket/i,
  /request\s+for\s+create\s+a\s+docket/i,
  /request\s+to\s+create\s+a\s+docket/i,
  /requesting\s+for\s+docket\s+creation/i,
];

/**
 * Context that suggests the mail is about a new docket / enquiry. Used with the
 * GMD-client and Laser-Entry checks; the AI is the final filter, so this list is
 * intentionally broad.
 */
export const DOCKET_CONTEXT_PATTERNS = [
  /\bdocket\b/i,
  /\brfq\b/i,
  /\benquir(?:y|ies)\b/i,
  /\binquir(?:y|ies)\b/i,
  /\brate\s+required\b/i,
  /\bbudgetary\b/i,
  /\bquotation\b/i,
  /\bquote\b/i,
  /\btender\b/i,
  /\boffer\b/i,
  /\bspares?\b/i,
  /\bpurchase\s+order\b/i,
];

export function hasDocketCreationKeyword(text: string): boolean {
  if (!text) return false;
  return DOCKET_CREATION_PATTERNS.some((p) => p.test(text));
}

export function hasDocketContext(text: string): boolean {
  if (!text) return false;
  return DOCKET_CONTEXT_PATTERNS.some((p) => p.test(text));
}

const PO_NEGATIVE = [
  /\bP\.?\s?O\.?\s*box\b/i,
  /\bpost\s+office\b/i,
  /\brfq\b/i,
  /\brequest\s+for\s+(?:quotation|quote|proposal)\b/i,
  /\b(?:enquiry|inquiry)\b/i,
  /\bquotation\s+(?:for|request)\b/i,
];
const PO_POSITIVE = [
  /\bpurchase[\s_-]+orders?\b/i,
  // [_-] separators and a non-letter lookbehind so filenames like "PO_114.pdf" match
  /(?<![a-z])P\.?\s?O\.?[\s_-]*(?:no\.?|number|#)?[\s_:.#-]*[A-Z0-9\/-]*\d[A-Z0-9\/-]{2,}/i,
  /(?<![a-z])P\.?O\.?[\s_]+(?:copy|attached|issued|released)\b/i,
  /\bwork\s+order\b/i,
  /\bsupply\s+order\b/i,
  /\bletter\s+of\s+(?:award|acceptance|intent)\b/i,
];

// Subject + attachment names only: bodies quote old POs in genuine docket requests.
export function isPurchaseOrderMail(t: { subject?: string | null; attachNames?: unknown }): boolean {
  const names = Array.isArray(t.attachNames) ? t.attachNames.join(" ") : JSON.stringify(t.attachNames ?? "");
  const head = `${t.subject || ""}\n${names}`;
  if (PO_NEGATIVE.some((p) => p.test(head))) return false;
  return PO_POSITIVE.some((p) => p.test(head));
}

export function extractEmailsFromValue(val: unknown): string[] {
  if (!val) return [];
  let str = "";
  if (typeof val === "string") {
    str = val;
  } else if (typeof val === "object") {
    const value = (val as { value?: unknown }).value;
    if (typeof value === "string") {
      str = value;
    } else {
      str = JSON.stringify(val);
    }
  }
  const matches = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (!matches) return [];
  const unique = Array.from(new Set(matches.map((e) => e.toLowerCase())));
  return unique.filter(
    (e) => !e.includes("mailer-daemon") && !e.includes("postmaster") && !e.includes("googlemail.com")
  );
}

export function isSentToLaserEntry(
  toDetails: unknown,
  ccDetails: unknown,
  text: string
): boolean {
  const lowerText = (text || "").toLowerCase();
  const toEmails = extractEmailsFromValue(toDetails);
  const ccEmails = extractEmailsFromValue(ccDetails);
  if (toEmails.includes(LASER_ENTRY_TEXT_EMAIL) || ccEmails.includes(LASER_ENTRY_TEXT_EMAIL))
    return true;
  if (toEmails.includes(LASER_ENTRY_EMAILS[1]) || ccEmails.includes(LASER_ENTRY_EMAILS[1]))
    return true;
  return lowerText.includes(LASER_ENTRY_TEXT_EMAIL);
}

export function isGenuineGmdClientThread(input: {
  userLabels?: unknown;
  isGmdClient?: boolean | null;
  company?: string | null;
}): boolean {
  const labelsStr = JSON.stringify(input.userLabels || "").toUpperCase();
  const hasGmdClientsLabel =
    labelsStr.includes("GMD CLIENTS") ||
    labelsStr.includes("GMD-CLIENTS") ||
    labelsStr.includes("GMD_CLIENTS");

  const isNonGmdLabel =
    labelsStr.includes("E-TENDERS") ||
    labelsStr.includes("TENDERS") ||
    labelsStr.includes("LOGISTICS") ||
    labelsStr.includes("ACCOUNTS") ||
    labelsStr.includes("ERP");

  return (
    hasGmdClientsLabel ||
    (input.isGmdClient === true &&
      !isNonGmdLabel &&
      (input.company === "GMD" || labelsStr.includes("GMD") || !input.company))
  );
}

export function isPendingDocketCandidate(input: {
  userLabels?: unknown;
  isGmdClient?: boolean | null;
  company?: string | null;
  toDetails?: unknown;
  ccDetails?: unknown;
  text: string;
}): boolean {
  if (!isGenuineGmdClientThread(input)) return false;
  if (!isSentToLaserEntry(input.toDetails, input.ccDetails, input.text)) return false;
  return hasDocketContext(input.text);
}

export function buildPartySearchText(input: {
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  ocrText?: string | null;
}): string {
  return `${input.subject || ""}\n${input.body || ""}\n${input.bodyPreview || ""}\n${input.ocrText || ""}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPartyMatcher(partyNames: string[]): (text: string) => string | null {
  const usable = Array.from(
    new Set(
      partyNames
        .map((n) => (n || "").trim())
        .filter((n) => n.length >= 4)
    )
  ).sort((a, b) => b.length - a.length);

  if (usable.length === 0) return () => null;

  const pattern = usable
    .map((name) => `(?:^|[^a-zA-Z0-9])${escapeRegExp(name)}(?![a-zA-Z0-9])`)
    .join("|");
  const regex = new RegExp(pattern, "i");

  return (text: string) => {
    if (!text) return null;
    const m = regex.exec(text);
    if (!m) return null;
    const hit = m[0].replace(/^[^a-zA-Z0-9]+/, "").trim();
    if (!hit) return null;
    const exact = usable.find((name) => name.toLowerCase() === hit.toLowerCase());
    return exact || hit;
  };
}

/**
 * IST calendar day, as a half-open UTC window.
 *
 * The container runs UTC (no `TZ` is set anywhere in the Dockerfile or
 * compose file), so a plain local-midnight boundary would roll over at 05:30
 * IST and silently drop every mail received between 00:00 and 05:29 IST.
 * Mails are IST, so the window is computed in IST and returned as UTC instants.
 *
 * `backlogDays` extends the window backwards by that many IST days, so a job
 * that must also drain late-ingested mail asks for today plus the backlog.
 */
export function istDayWindow(now: Date, backlogDays = 0): { start: Date; end: Date } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const startMs =
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) -
    IST_OFFSET_MS -
    backlogDays * 24 * 60 * 60 * 1000;
  return {
    start: new Date(startMs),
    end: new Date(startMs + (backlogDays + 1) * 24 * 60 * 60 * 1000),
  };
}
