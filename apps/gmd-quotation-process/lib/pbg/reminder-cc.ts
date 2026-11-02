import { extractEmailsFromValue } from "@/lib/enquiryEmailParty";

/** Internal address that must be copied on every PBG reminder. */
export const DEFAULT_PBG_REMINDER_CC = ["puja.agarwal@laserpowerinfra.com"];

/**
 * Merges the configured CC list with the mandatory internal copy, removing
 * duplicates and empty values.
 */
export function mergeReminderCc(
  raw: string | null | undefined,
): string[] {
  return Array.from(
    new Set([
      ...extractEmailsFromValue(raw ?? ""),
      ...DEFAULT_PBG_REMINDER_CC,
    ]),
  );
}
