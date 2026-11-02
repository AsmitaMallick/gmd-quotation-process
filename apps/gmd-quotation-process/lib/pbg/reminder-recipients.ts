import {
  extractEmailsFromValue,
  partyKey,
} from "@/lib/enquiryEmailParty";

export type RecipientGroup = {
  /** Stable key: the sorted, lower-cased recipient list. */
  key: string;
  emails: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parses the PBG "Contact Person" column into a clean recipient list. The
 * column holds values like `Name <a@x.com>` or `a@x.com, b@y.com`, so we reuse
 * the app's email extractor and then drop anything that is not an address.
 */
export function parseRecipientEmails(
  contactPerson: string | null | undefined,
): string[] {
  return extractEmailsFromValue(contactPerson ?? "").filter((email) =>
    EMAIL_RE.test(email),
  );
}

/** Builds the grouping key for a recipient list. */
export function recipientKey(emails: string[]): string {
  return emails.map((email) => email.toLowerCase()).sort().join(",");
}

/**
 * Groups rows by the contact emails stored on them. Rows with no email are
 * omitted; the caller reports them separately.
 */
export function groupByRecipient<T>(
  rows: T[],
  getContactPerson: (row: T) => string | null | undefined,
): Map<string, { emails: string[]; rows: T[] }> {
  const groups = new Map<string, { emails: string[]; rows: T[] }>();

  for (const row of rows) {
    const emails = parseRecipientEmails(getContactPerson(row));
    if (emails.length === 0) continue;

    const key = recipientKey(emails);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { emails, rows: [row] });
    }
  }

  return groups;
}

/** Normalises a PO number for grouping and log matching. */
export function normalizePoKey(
  poNumber: string | null | undefined,
): string {
  return String(poNumber ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

const PO_PLACEHOLDERS = new Set([
  "",
  "-",
  "--",
  "—",
  "–",
  "N/A",
  "NA",
  "NULL",
  "NIL",
  ".",
  "0",
]);

/**
 * A PO number is usable only when it is not blank or a placeholder and
 * contains at least one digit. This keeps values like "GANJAM" or "N/A" out
 * of reminder mails.
 */
export function isUsablePoNumber(
  poNumber: string | null | undefined,
): boolean {
  const key = normalizePoKey(poNumber);
  if (PO_PLACEHOLDERS.has(key)) return false;
  if (!/\d/.test(key)) return false;
  if (/^0+$/.test(key)) return false;
  return true;
}

/** Stable key for a PO + recipient group. */
export function poRecipientKey(
  poNumber: string | null | undefined,
  emails: string[],
): string {
  return `${normalizePoKey(poNumber)}|${recipientKey(emails)}`;
}

export function normalizePartyKey(
  partyName: string | null | undefined,
): string {
  return partyKey(partyName);
}

export function partyRecipientKey(
  partyName: string | null | undefined,
  emails: string[],
): string {
  return `${normalizePartyKey(partyName)}|${recipientKey(emails)}`;
}

export type PartyRecipientGroup<T> = {
  key: string;
  partyName: string;
  partyKey: string;
  emails: string[];
  recipientKey: string;
  rows: T[];
};

export function groupByPartyRecipient<T>(
  rows: T[],
  getPartyName: (row: T) => string | null | undefined,
  getContactPerson: (row: T) => string | null | undefined,
): Map<string, PartyRecipientGroup<T>> {
  const groups = new Map<string, PartyRecipientGroup<T>>();

  for (const row of rows) {
    const partyName = String(getPartyName(row) ?? "").trim();
    const pKey = normalizePartyKey(partyName);
    if (!pKey) continue;

    const emails = parseRecipientEmails(getContactPerson(row));
    if (emails.length === 0) continue;

    const rKey = recipientKey(emails);
    const key = `${pKey}|${rKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, {
        key,
        partyName,
        partyKey: pKey,
        emails,
        recipientKey: rKey,
        rows: [row],
      });
    }
  }

  return groups;
}

export type PoRecipientGroup<T> = {
  /** Stable key: normalized PO + sorted recipient list. */
  key: string;
  /** Original PO number (trimmed) for display. */
  poNumber: string;
  poKey: string;
  emails: string[];
  recipientKey: string;
  rows: T[];
};

/**
 * Groups rows by PO number + contact emails. Rows with a blank PO or no email
 * are omitted; the caller reports them separately.
 */
export function groupByPoRecipient<T>(
  rows: T[],
  getPoNumber: (row: T) => string | null | undefined,
  getContactPerson: (row: T) => string | null | undefined,
): Map<string, PoRecipientGroup<T>> {
  const groups = new Map<string, PoRecipientGroup<T>>();

  for (const row of rows) {
    const poNumber = String(getPoNumber(row) ?? "").trim();
    const poKey = normalizePoKey(poNumber);
    if (!poKey) continue;

    const emails = parseRecipientEmails(getContactPerson(row));
    if (emails.length === 0) continue;

    const rKey = recipientKey(emails);
    const key = `${poKey}|${rKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, {
        key,
        poNumber,
        poKey,
        emails,
        recipientKey: rKey,
        rows: [row],
      });
    }
  }

  return groups;
}
