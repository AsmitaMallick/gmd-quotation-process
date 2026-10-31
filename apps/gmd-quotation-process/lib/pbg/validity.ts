/**
 * Validity duration parsing + date math for the PBG "Validity On for Contract"
 * column and its derived "Extended Validity" column.
 *
 * Accepted values are number+unit pairs, e.g. "5y", "18m", "90d", or a
 * combination like "8y 18m". A bare number is treated as years.
 */

export type Duration = { months: number; days: number };

/** Dropdown options for the Validity On column. */
export const VALIDITY_OPTIONS: string[] = [
  "5 Year",
  "3 Year",
  "1 Year",
  "18 Month",
];

const UNIT_RE =
  /(\d+(?:[.,]\d+)?)\s*(years?|yrs?|months?|mos?|days?|y|m|d)(?![a-z])/g;

function toNumber(value: string): number {
  return Number(value.replace(",", "."));
}

/**
 * Parses a validity string into months + days. Returns null when nothing
 * usable is found or the value resolves to zero.
 */
export function parseDuration(input: string | null | undefined): Duration | null {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;

  let months = 0;
  let days = 0;
  let matched = false;
  UNIT_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = UNIT_RE.exec(raw)) !== null) {
    matched = true;
    const value = toNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    const unit = m[2][0];
    if (unit === "y") months += value * 12;
    else if (unit === "m") months += value;
    else days += value;
  }

  if (!matched) {
    const bare = toNumber(raw);
    if (!Number.isFinite(bare)) return null;
    months = bare * 12;
  }

  months = Math.round(months);
  days = Math.round(days);
  if (months === 0 && days === 0) return null;
  return { months, days };
}

/**
 * Canonical readable label for a validity duration, e.g. "5y" -> "5 Year",
 * "1y 6m" -> "18 Month", "90d" -> "90 Day". Whole years render as "N Year",
 * otherwise the total months render as "N Month"; days are appended when
 * present. Returns null when the value cannot be parsed.
 *
 * Idempotent: a value already in canonical form maps to itself, so this is
 * safe to run on every save and in a backfill.
 */
export function formatValidityLabel(
  input: string | null | undefined,
): string | null {
  const duration = parseDuration(input);
  if (!duration) return null;

  const { months, days } = duration;
  const parts: string[] = [];
  if (months > 0 && months % 12 === 0) {
    parts.push(`${months / 12} Year`);
  } else if (months > 0) {
    parts.push(`${months} Month`);
  }
  if (days > 0) parts.push(`${days} Day`);

  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Adds a duration to an ISO (yyyy-mm-dd) date, clamping the day to the target
 * month's length (e.g. 2024-01-31 + 1m -> 2024-02-29).
 */
export function addDuration(isoDate: string, duration: Duration): string | null {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const totalMonths = month + duration.months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);

  const result = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  result.setUTCDate(result.getUTCDate() + duration.days);
  return result.toISOString().slice(0, 10);
}

/**
 * Extended Validity = Last Supply Date + Validity On duration. Null when either
 * input is missing or the duration cannot be parsed.
 */
export function computeExtendedValidity(
  validityOn: string | null | undefined,
  lastSupplyDate: string | null | undefined,
): string | null {
  if (!lastSupplyDate) return null;
  const duration = parseDuration(validityOn);
  if (!duration) return null;
  return addDuration(lastSupplyDate, duration);
}

/** How close to expiry counts as "expiring soon". */
export const EXPIRY_WARNING_DAYS = 30;

export type ValidityStatus = "expired" | "expiring" | "ok";

/**
 * Where a PBG sits against its contract validity date, for the row highlight.
 *
 * `null` when there is no usable date: a bank guarantee with no computed
 * validity is unknown, not safe, so it is left untinted rather than coloured
 * green-by-default.
 *
 * Both dates are compared as plain UTC days, so a guarantee expiring today
 * reads as "expiring" (0 days left) rather than flipping to "expired" partway
 * through the day depending on the viewer's clock.
 */
export function validityStatus(
  extendedValidity: string | null | undefined,
  today: Date = new Date(),
): ValidityStatus | null {
  const iso = String(extendedValidity ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;

  const end = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;

  const startOfToday = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const daysLeft = Math.floor((end.getTime() - startOfToday) / 86_400_000);

  if (daysLeft < 0) return "expired";
  if (daysLeft <= EXPIRY_WARNING_DAYS) return "expiring";
  return "ok";
}
