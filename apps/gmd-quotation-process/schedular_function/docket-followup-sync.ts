import { prisma } from "@/lib/prisma";
import {
  PARTY_LOOKUP_TYPE,
  buildPartyMatcher,
  buildPartySearchText,
  hasDocketCreationKeyword,
  isPendingDocketCandidate,
  isPurchaseOrderMail,
} from "@/lib/docketPending";
import {
  isDocketAiEligible,
  runDocketAiValidation,
  type DocketAiThreadInput,
} from "@/lib/docketAiValidationRunner";

export const DOCKET_PATTERNS = [
  /\bGMD\/\d{4}-\d{2}\/\d+\b/i,
  /\bGMD[-\s_]?\d{4,}\b/i,
  /\bENQ[-\s_]?\d{4,}(?:[-\s_]?\d{2}[-\s_]?\d{2})?\b/i,
  /\b(?:docket|docket\s*no|docket\s*number|docket#)\s*[:#\-\s]?\s*([a-zA-Z0-9\/-]{4,})\b/i,
];

/**
 * Extracts attachment names as a combined searchable string (case-insensitive).
 */
export function extractAttachmentNamesText(attachNames: unknown): string {
  if (!attachNames) return "";
  if (Array.isArray(attachNames)) {
    return attachNames.filter((n) => typeof n === "string").join(" ");
  }
  if (typeof attachNames === "string") {
    return attachNames;
  }
  if (typeof attachNames === "object") {
    const val = (attachNames as { value?: unknown }).value;
    if (Array.isArray(val)) return val.join(" ");
    if (typeof val === "string") return val;
    return JSON.stringify(attachNames);
  }
  return "";
}

/**
 * Checks all text sources (column, subject, body, attachment names, ocr_text)
 * for a docket number in a case-insensitive manner.
 */
export function detectDocketNumber(thread: {
  docketNo?: string | null;
  subject?: string | null;
  body?: string | null;
  bodyPreview?: string | null;
  attachNames?: unknown;
  ocrText?: string | null;
}): string | null {
  // 1. Direct DB column check
  if (thread.docketNo && thread.docketNo.trim()) {
    return thread.docketNo.trim();
  }

  const attachText = extractAttachmentNamesText(thread.attachNames);
  const combinedSearchText = [
    thread.subject || "",
    thread.body || "",
    thread.bodyPreview || "",
    attachText,
    thread.ocrText || "",
  ].join("\n");

  for (const pattern of DOCKET_PATTERNS) {
    const match = combinedSearchText.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }

  return null;
}

export type DocketFollowupSyncOptions = {
  /** If true, scans all historical threads. Defaults to false (incremental scan only). */
  fullScan?: boolean;
  /** Optional lookback timestamp for newly received/updated emails */
  since?: Date;
};

export type DocketFollowupSyncResult = {
  scanned: number;
  candidatesCount: number;
  docketsFoundCount: number;
  pendingDocketsCount: number;
  updatedToPendingTrue: number;
  updatedToPendingFalse: number;
  partyNamesUpdated: number;
  aiVerifiedTrue: number;
  aiVerifiedFalse: number;
  aiValidationErrors: number;
  isIncremental: boolean;
  elapsedMs: number;
};

// In-memory record of the last successful sync run timestamp
let lastSyncTimestamp: Date | null = null;

// Single-flight latch: a page load, the hourly interval and the manual button
// must never stack overlapping scans (each one is a multi-thousand-row query).
let inFlightSync: Promise<DocketFollowupSyncResult> | null = null;

/**
 * Single-flight wrapper around the sync. Concurrent callers share the same
 * run instead of starting another heavy scan.
 */
export function runDocketFollowupSync(
  options: DocketFollowupSyncOptions = {}
): Promise<DocketFollowupSyncResult> {
  if (inFlightSync) return inFlightSync;
  inFlightSync = runDocketFollowupSyncInternal(options).finally(() => {
    inFlightSync = null;
  });
  return inFlightSync;
}

/**
 * Runs the docket detection and pending status synchronization incrementally.
 * - Only scans:
 *    1. Pending threads (`pendingDocket = true`)
 *    2. Newly created / updated email threads since last sync
 * - Settled threads (with verified docketNo and pendingDocket = false) are skipped.
 */
async function runDocketFollowupSyncInternal(
  options: DocketFollowupSyncOptions = {}
): Promise<DocketFollowupSyncResult> {
  const startTime = Date.now();
  const { fullScan = false } = options;

  // Lookback threshold: explicit since, last sync, or the past 48 hours. The
  // job runs hourly; 48h covers ingestion lag without touching older backlog.
  const lookbackSince =
    options.since ||
    lastSyncTimestamp ||
    new Date(Date.now() - 48 * 60 * 60 * 1000);

  // 1. Load active PARTY lookup options
  const partyRows = await prisma.lookupOption.findMany({
    where: { type: PARTY_LOOKUP_TYPE, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { value: true },
  });
  const partyNames = partyRows.map((r) => r.value);
  const matchParty = buildPartyMatcher(partyNames);

  // 2. Incremental Where Clause:
  // Only pending threads or threads touched since the last run. Do NOT scan
  // every `docketNo = null` thread: that is ~7k rows / ~37s on this database.
  const whereClause = fullScan
    ? {}
    : {
        OR: [
          { pendingDocket: true },
          { updatedAt: { gte: lookbackSince } },
          { date: { gte: lookbackSince } },
        ],
      };

  // 3. Fetch ONLY candidate/updated threads
  const threads = await prisma.docketQuotationThread.findMany({
    where: whereClause,
    orderBy: { updatedAt: "desc" },
    take: fullScan ? undefined : 1000,
    select: {
      id: true,
      threadId: true,
      subject: true,
      body: true,
      bodyPreview: true,
      ocrText: true,
      sender: true,
      toDetails: true,
      ccDetails: true,
      company: true,
      isGmdClient: true,
      userLabels: true,
      docketNo: true,
      pendingDocket: true,
      aiIsNewDocket: true,
      aiValidationAttempts: true,
      duplicateOfDocket: true,
      partyName: true,
      attachNames: true,
      updatedAt: true,
    },
  });

  let candidatesCount = 0;
  let docketsFoundCount = 0;
  let pendingDocketsCount = 0;
  let updatedToPendingTrue = 0;
  let updatedToPendingFalse = 0;
  let partyNamesUpdated = 0;

  const updates: Array<{
    id: number;
    docketNo?: string | null;
    pendingDocket: boolean;
    partyName?: string | null;
    docketStatus?: string | null;
    aiIsNewDocket?: boolean | null;
  }> = [];
  const aiCandidates: DocketAiThreadInput[] = [];

  for (const t of threads) {
    // Already folded onto an existing docket by the dedupe job. Re-flagging it
    // pending would only make the UI show a mail that is already docketed.
    if (t.duplicateOfDocket) continue;

    const text = `${t.subject || ""} ${t.body || ""} ${t.bodyPreview || ""}`;
    const isCandidate = isPendingDocketCandidate({
      userLabels: t.userLabels,
      isGmdClient: t.isGmdClient,
      company: t.company,
      toDetails: t.toDetails,
      ccDetails: t.ccDetails,
      text,
    });

    if (!isCandidate) continue;

    // Customer PO, not a docket request: clear any earlier flag and skip.
    if (isPurchaseOrderMail(t) && !hasDocketCreationKeyword(text)) {
      if (t.pendingDocket || t.aiIsNewDocket !== false) {
        updates.push({ id: t.id, pendingDocket: false, aiIsNewDocket: false });
      }
      continue;
    }
    candidatesCount++;

    const detectedDocket = detectDocketNumber(t);

    if (detectedDocket) {
      docketsFoundCount++;
      const needsDocketNoUpdate = !t.docketNo && detectedDocket;
      const needsPendingFalse = t.pendingDocket !== false;

      if (needsDocketNoUpdate || needsPendingFalse) {
        updates.push({
          id: t.id,
          docketNo: t.docketNo || detectedDocket,
          pendingDocket: false,
          docketStatus: "RESOLVED",
          aiIsNewDocket: false,
        });
        if (needsPendingFalse) updatedToPendingFalse++;
      }
    } else {
      // Docket NOT found -> Mark pending_docket = true & resolve party_name
      pendingDocketsCount++;
      const needsPendingTrue = t.pendingDocket !== true;

      // One-time AI verification for undecided pending candidates.
      const aiInput: DocketAiThreadInput = {
        id: t.id,
        subject: t.subject,
        body: t.body,
        bodyPreview: t.bodyPreview,
        ocrText: t.ocrText,
        docketNo: t.docketNo,
        duplicateOfDocket: t.duplicateOfDocket,
        aiIsNewDocket: t.aiIsNewDocket,
        aiValidationAttempts: t.aiValidationAttempts,
        userLabels: t.userLabels,
        isGmdClient: t.isGmdClient,
        company: t.company,
        toDetails: t.toDetails,
        ccDetails: t.ccDetails,
      };
      if (isDocketAiEligible(aiInput)) aiCandidates.push(aiInput);

      const attachText = extractAttachmentNamesText(t.attachNames);
      const partySearchText = `${buildPartySearchText(t)}\n${attachText}`;
      const resolvedParty = matchParty(partySearchText);
      const needsPartyUpdate = !!resolvedParty && t.partyName !== resolvedParty;

      if (needsPendingTrue || needsPartyUpdate) {
        updates.push({
          id: t.id,
          pendingDocket: true,
          partyName: resolvedParty || t.partyName,
          docketStatus: "PENDING_DOCKET",
        });
        if (needsPendingTrue) updatedToPendingTrue++;
        if (needsPartyUpdate) partyNamesUpdated++;
      }
    }
  }

  // One-time AI verification for candidates that have never been decided.
  const rawAiLimit = Number(process.env.DOCKET_AI_MAX_PER_RUN);
  const aiLimit =
    Number.isFinite(rawAiLimit) && rawAiLimit > 0 ? Math.floor(rawAiLimit) : 25;
  let aiVerifiedTrue = 0;
  let aiVerifiedFalse = 0;
  let aiValidationErrors = 0;
  try {
    const aiResult = await runDocketAiValidation(aiCandidates, {
      limit: aiLimit,
    });
    aiVerifiedTrue = aiResult.verifiedTrue;
    aiVerifiedFalse = aiResult.verifiedFalse;
    aiValidationErrors = aiResult.errors;
  } catch (err) {
    // Fail open: leave undecided candidates as NULL ("Not verified").
    console.warn("[docket-followup-sync] AI validation failed:", err);
  }

  // 3. Batch apply updates in transactions
  const BATCH_SIZE = 50;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((item) =>
        prisma.docketQuotationThread.update({
          where: { id: item.id },
          data: {
            ...(item.docketNo !== undefined ? { docketNo: item.docketNo } : {}),
            pendingDocket: item.pendingDocket,
            ...(item.partyName !== undefined ? { partyName: item.partyName } : {}),
            ...(item.docketStatus !== undefined ? { docketStatus: item.docketStatus } : {}),
            ...(item.aiIsNewDocket !== undefined
              ? { aiIsNewDocket: item.aiIsNewDocket }
              : {}),
          },
        })
      )
    );
  }

  lastSyncTimestamp = new Date();
  const elapsedMs = Date.now() - startTime;

  return {
    scanned: threads.length,
    candidatesCount,
    docketsFoundCount,
    pendingDocketsCount,
    updatedToPendingTrue,
    updatedToPendingFalse,
    partyNamesUpdated,
    aiVerifiedTrue,
    aiVerifiedFalse,
    aiValidationErrors,
    isIncremental: !fullScan,
    elapsedMs,
  };
}

