/** Canonical spellings used by the PBG dashboard and reminder mails. */
export const MASORA_PROJECT_NAME = "Masora Sindhwaha Water Supply";
export const KALPATARU_CLIENT_NAME =
  "KALPATARU PROJECTS INTERNATIONAL LIMITED";

const MASORA_PO = "3000179463";

/**
 * Normalises the project-name variants that have crept into the PBG sheet.
 * `Orissa` is the old state name; `Odisha` is the current one.
 */
export function canonicalProjectName(
  value: string | null | undefined,
  poNumber?: string | null,
): string | null {
  const raw = String(value ?? "").trim();

  if (raw === "") {
    return String(poNumber ?? "").trim() === MASORA_PO
      ? MASORA_PROJECT_NAME
      : (value ?? null);
  }

  let project = raw.replace(/\s+/g, " ");

  if (/^masora\s+sind\w*ha\s+water\s+supply$/i.test(project)) {
    return MASORA_PROJECT_NAME;
  }

  if (/orissa/i.test(project)) {
    project = project
      .replace(/\s*,\s*/g, ", ")
      .replace(/\borissa\b/gi, "Odisha");
  }

  return project;
}

/**
 * JMC Projects merged into Kalpataru Power Transmission (now Kalpataru
 * Projects International) effective 04 Jan 2023. The PBG sheet can still carry
 * the old name, so normalise it wherever the party is read or written.
 */
export function canonicalPbgClientName(
  value: string | null | undefined,
): string | null {
  const raw = String(value ?? "").trim();
  if (/^JMC PROJECTS/i.test(raw)) return KALPATARU_CLIENT_NAME;
  return value ?? null;
}
