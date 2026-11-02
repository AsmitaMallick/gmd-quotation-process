import { denyIfNoAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildPartyMatcher,
  buildPartySearchText,
  extractEmailsFromValue,
  hasDocketCreationKeyword,
  isGenuineGmdClientThread,
  isPendingDocketCandidate,
  isPurchaseOrderMail,
} from "@/lib/docketPending";
import {
  enqueueDocketAiValidation,
  getDocketAiMaxAttempts,
  isDocketAiEligible,
  type DocketAiThreadInput,
} from "@/lib/docketAiValidationRunner";
import { isDocketAiValidationEnabled } from "@/lib/docketAiValidator";
import {
  getPendingDocketsCache,
  setPendingDocketsCache,
} from "@/lib/pendingDocketsCache";

export const dynamic = "force-dynamic";

interface ParsedMessage {
  num: number;
  senderName: string;
  senderEmail: string | null;
  fullSender: string;
  body: string;
}

const INTERNAL_PREFIXES = [
  "info@gmdalui.co.in",
  "admin@gmdalui.co.in",
  "accounts@gmdalui.co.in",
  "designer@gmdalui.co.in",
  "execution@gmdalui.co.in",
  "tridip@gmdalui.co.in",
  "payel.santra@gmdalui.co.in",
  "puja.agarwal@laserpowerinfra.com",
  "asmita.mallick@laserpowerinfra.com",
  "dipankar@laserpowerinfra.com",
  "manishpoddar@laserpowerinfra.com",
  "logistics@laserpowerinfra.com",
  "laserentry.four@gmail.com",
  "laserentry.one@gmail.com",
  "laserentry.two@gmail.com",
  "enquiry5.laserpowerinfra@gmail.com",
  "lasertender.four@gmail.com",
  "tech.laserpower@gmail.com",
];

function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  if (INTERNAL_PREFIXES.some((p) => clean.includes(p))) return true;
  if (clean.includes("@gmdalui.co.in") || clean.includes("@laserpowerinfra.com")) return true;
  if (/laserentry/i.test(clean) || /lasertender/i.test(clean)) return true;
  return false;
}

function parseThreadMessages(bodyText: string | null | undefined): ParsedMessage[] {
  if (!bodyText) return [];
  const pattern = /---\s*Message\s*(\d+)\s*From:\s*([^\n\r-]+?)(?:\s*<([^>]+)>)?\s*---/gi;
  const matches = Array.from(bodyText.matchAll(pattern));
  if (matches.length === 0) {
    return [
      {
        num: 1,
        senderName: "",
        senderEmail: null,
        fullSender: "",
        body: bodyText.trim(),
      },
    ];
  }

  const messages: ParsedMessage[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const num = parseInt(match[1], 10);
    const senderName = (match[2] || "").trim();
    let senderEmail = match[3] ? match[3].trim() : null;
    const startPos = match.index + match[0].length;
    const endPos = i + 1 < matches.length ? matches[i + 1].index : bodyText.length;
    const rawBody = bodyText.slice(startPos, endPos).trim();

    if (!senderEmail) {
      const fromHeaderMatch = rawBody.match(/From:\s*[^<\n\r]*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/i);
      if (fromHeaderMatch) {
        senderEmail = fromHeaderMatch[1].trim();
      } else {
        const anyEmailMatch = rawBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (anyEmailMatch) {
          senderEmail = anyEmailMatch[0].trim();
        }
      }
    }

    const cleanLines: string[] = [];
    for (const line of rawBody.split("\n")) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith(">") ||
        trimmed.startsWith("---------- Forwarded") ||
        (trimmed.startsWith("On ") && (trimmed.includes("wrote:") || trimmed.includes("@") || /at\s+\d{1,2}:\d{2}/i.test(trimmed))) ||
        /^From:\s*/i.test(trimmed)
      ) {
        break;
      }
      cleanLines.push(line);
    }
    const cleanBody = cleanLines.join("\n").trim();

    messages.push({
      num,
      senderName,
      senderEmail,
      fullSender: senderEmail ? `${senderName} <${senderEmail}>` : senderName,
      body: cleanBody || rawBody,
    });
  }
  return messages;
}

interface PendingRowInternal {
  row: Record<string, unknown>;
  aiIsNewDocket: boolean | null;
  aiAttempts: number;
  aiLastError: string | null;
  hasDocket: boolean;
}

export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const aiEnabled = isDocketAiValidationEnabled();
    const maxAttempts = getDocketAiMaxAttempts();
    const rawPerRequest = Number(process.env.DOCKET_AI_MAX_PER_REQUEST);
    const perRequestLimit =
      Number.isFinite(rawPerRequest) && rawPerRequest > 0
        ? Math.floor(rawPerRequest)
        : 25;

    // Fast path: reuse the last computed response, but still kick the
    // background queue so newly eligible rows keep progressing.
    const cached = getPendingDocketsCache();
    if (cached) {
      if (aiEnabled) enqueueDocketAiValidation(cached.candidates, perRequestLimit);
      return NextResponse.json(cached.response);
    }

    // Narrow query: only the precomputed pending/attempted/verified set, never
    // the whole 10k thread table.
    const threads = await prisma.docketQuotationThread.findMany({
      where: {
        docketNo: null,
        duplicateOfDocket: null,
        OR: [
          { pendingDocket: true },
          { aiIsNewDocket: true },
          { aiValidationAttempts: { gt: 0 } },
        ],
      },
      orderBy: { date: "desc" },
      take: 10000,
      select: {
        id: true,
        threadId: true,
        mailType: true,
        docketNo: true,
        docketStatus: true,
        subject: true,
        sender: true,
        senderDetails: true,
        toDetails: true,
        ccDetails: true,
        date: true,
        body: true,
        bodyPreview: true,
        attachNames: true,
        attachLinks: true,
        isGmdClient: true,
        userLabels: true,
        actionTag: true,
        msgCount: true,
        company: true,
        ocrText: true,
        pendingDocket: true,
        aiIsNewDocket: true,
        aiValidationAttempts: true,
        aiValidationLastError: true,
        duplicateOfDocket: true,
        partyName: true,
      },
    });

    const laserentryEmail = "laserentry.four@gmail.com";

    const partyRows = await prisma.lookupOption.findMany({
      where: { type: "PARTY", isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { value: true },
    });
    const matchPartyName = buildPartyMatcher(partyRows.map((r) => r.value));
    const pendingDocketWriteIds: number[] = [];
    const aiCandidates: DocketAiThreadInput[] = [];
    const partyNameWrites: { id: number; partyName: string }[] = [];

    const pendingRows: PendingRowInternal[] = [];

    for (const t of threads) {
      const aiVerdict = t.aiIsNewDocket ?? null;
      // AI-rejected rows are hidden permanently.
      if (aiVerdict === false) continue;

      const text = `${t.subject || ""} ${t.body || ""} ${t.bodyPreview || ""}`;

      const hasCreationKeyword = hasDocketCreationKeyword(text);
      // Customer POs are not docket requests; hides rows flagged earlier.
      if (isPurchaseOrderMail(t) && !hasCreationKeyword) continue;

      const toEmails = extractEmailsFromValue(t.toDetails);
      const ccEmails = extractEmailsFromValue(t.ccDetails);

      const isSenderInternal = isInternalEmail(t.sender);

      // Verified true rows remain visible even if the candidate rules change
      // later. Undecided rows must still pass the current rule:
      // genuine GMD client AND forwarded to Laser Entry AND docket context.
      if (aiVerdict !== true) {
        if (!isGenuineGmdClientThread(t)) continue;
        const isCandidate = isPendingDocketCandidate({
          userLabels: t.userLabels,
          isGmdClient: t.isGmdClient,
          company: t.company,
          toDetails: t.toDetails,
          ccDetails: t.ccDetails,
          text,
        });
        if (!isCandidate) continue;
      }

      // Check if laserentry.four@gmail.com sent a reply on this thread
      const sender = (t.sender || "").toLowerCase();
      const bodyText = t.body || t.bodyPreview || "";

      let hasLaserReply = sender.includes(laserentryEmail);
      let laserReplySnippet = "";

      const parsedMsgs = parseThreadMessages(bodyText);
      for (const m of parsedMsgs) {
        const hSender = `${m.senderName} ${m.senderEmail || ""}`.toLowerCase();
        if (hSender.includes(laserentryEmail) || hSender.includes("laserentry")) {
          hasLaserReply = true;
          laserReplySnippet = m.body;
          break;
        }
      }

      if (!hasLaserReply) {
        const fromLineMatch = bodyText.match(/From:\s*[^<\n\r]*<?([a-zA-Z0-9._%+-]*laserentry[a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+)>?([\s\S]{0,300})/i);
        if (fromLineMatch) {
          hasLaserReply = true;
          laserReplySnippet = fromLineMatch[2] || "";
        }
      }

      // Determine Requester
      let requesterName = "";
      let requesterEmail = "";
      const rawSender = (t.sender || "").trim();
      const sMatch = rawSender.match(/^([^<]+)?(?:<([^>]+)>)?/);
      if (sMatch) {
        requesterName = (sMatch[1] || "").replace(/"/g, "").trim();
        requesterEmail = (sMatch[2] || "").trim();
      }
      if (!requesterEmail && rawSender.includes("@")) {
        const anyE = rawSender.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (anyE) requesterEmail = anyE[0];
      }
      if (!requesterName) requesterName = requesterEmail || "Unknown";

      // Identify tender / GeM bid tokens in subject
      const tenderMatch = (t.subject || "").match(/GEM[\/\-_ ]\d{4}[\/\-_ ][A-Z][\/\-_ ]\d+|\b(?:gem|bidding)[\-_ ]*(\d{5,})\b|TID\s*[:#\-]?\s*(\d+)/i);
      const tenderTag = tenderMatch ? tenderMatch[0] : null;

      // Attachments & links
      const attachNames: string[] = [];
      const attachLinks: Record<string, string> = {};
      if (Array.isArray(t.attachNames)) {
        const rawNames = t.attachNames as string[];
        const rawLinks = Array.isArray(t.attachLinks) ? (t.attachLinks as string[]) : [];
        rawNames.forEach((n, idx) => {
          if (n && typeof n === "string") {
            const cleanN = n.trim();
            if (cleanN && cleanN !== "[No Attachments]" && !cleanN.startsWith("[")) {
              attachNames.push(cleanN);
              const link = rawLinks[idx] ? String(rawLinks[idx]).trim() : "";
              if (link && link !== "[No Links]") {
                attachLinks[cleanN] = link;
              }
            }
          }
        });
      }

      const firstMsg = parsedMsgs.length > 0 ? parsedMsgs[0] : null;
      const requestSnippet = (firstMsg?.body || t.bodyPreview || "").slice(0, 400).trim();

      const hasDocketInDb = !!t.docketNo || !!t.duplicateOfDocket;
      const linkedDocketNo = t.docketNo || t.duplicateOfDocket || null;
      const pendingStatus = hasDocketInDb ? "DOCKET_STAMPED" : "PENDING_DOCKET";

      const aiAttempts = t.aiValidationAttempts ?? 0;
      const aiInput: DocketAiThreadInput = {
        id: t.id,
        subject: t.subject,
        body: t.body,
        bodyPreview: t.bodyPreview,
        ocrText: t.ocrText,
        docketNo: t.docketNo,
        duplicateOfDocket: t.duplicateOfDocket,
        aiIsNewDocket: t.aiIsNewDocket,
        aiValidationAttempts: aiAttempts,
        userLabels: t.userLabels,
        isGmdClient: t.isGmdClient,
        company: t.company,
        toDetails: t.toDetails,
        ccDetails: t.ccDetails,
      };
      if (!hasDocketInDb && isDocketAiEligible(aiInput)) {
        aiCandidates.push(aiInput);
      }

      if (!hasDocketInDb && t.pendingDocket !== true) {
        pendingDocketWriteIds.push(t.id);
      }

      const matchedParty = matchPartyName(
        buildPartySearchText({
          subject: t.subject,
          body: t.body,
          bodyPreview: t.bodyPreview,
          ocrText: t.ocrText,
        })
      );
      if (matchedParty && !t.partyName) {
        partyNameWrites.push({ id: t.id, partyName: matchedParty });
      }

      pendingRows.push({
        row: {
          id: t.id,
          threadId: t.threadId,
          date: t.date ? t.date.toISOString() : null,
          subject: t.subject || "No Subject",
          tenderTag,
          requester: {
            name: requesterName,
            email: requesterEmail,
            isInternal: isSenderInternal,
          },
          mailType: t.mailType || "DOCKET",
          docketNo: linkedDocketNo,
          docketStatus: t.docketStatus || null,
          msgCount: t.msgCount || parsedMsgs.length || 1,
          hasLaserReply,
          laserReplySnippet: laserReplySnippet || null,
          pendingStatus,
          requestSnippet,
          attachNames,
          attachLinks,
          toRecipients: toEmails,
          ccRecipients: ccEmails,
          messages: parsedMsgs.map((m) => ({
            num: m.num,
            sender: m.fullSender || m.senderName,
            body: m.body,
          })),
        },
        aiIsNewDocket: t.aiIsNewDocket ?? null,
        aiAttempts,
        aiLastError: t.aiValidationLastError ?? null,
        hasDocket: hasDocketInDb,
      });
    }

    // Show verified (true) and undecided (null); hide rejected (false) and
    // already-docketed rows.
    const visible = pendingRows.filter(
      (p) => p.aiIsNewDocket !== false && !p.hasDocket
    );

    const rows: Array<
      Record<string, unknown> & {
        aiVerification: "verified" | "unverified";
        aiAttempts: number;
        aiExhausted: boolean;
        aiLastError: string | null;
      }
    > = visible.map((p) => ({
      ...p.row,
      aiVerification: p.aiIsNewDocket === true ? "verified" : "unverified",
      aiAttempts: p.aiAttempts,
      aiExhausted:
        p.aiIsNewDocket == null && p.aiAttempts >= maxAttempts,
      aiLastError: p.aiLastError,
    }));

    const aiVerifiedCount = rows.filter((r) => r.aiVerification === "verified").length;
    const aiUnverifiedCount = rows.length - aiVerifiedCount;
    const aiPendingCount = visible.filter(
      (p) => p.aiIsNewDocket == null && p.aiAttempts < maxAttempts
    ).length;
    const aiRejectedCount = threads.filter(
      (t) => t.aiIsNewDocket === false
    ).length;
    const noDocketAssignedCount = rows.filter(
      (r) => r.pendingStatus === "PENDING_DOCKET"
    ).length;
    const unrepliedRequestsCount = rows.filter((r) => !r.hasLaserReply).length;

    // Persist enrichment only; never block the response on AI.
    try {
      for (let i = 0; i < pendingDocketWriteIds.length; i += 500) {
        const chunk = pendingDocketWriteIds.slice(i, i + 500);
        await prisma.docketQuotationThread.updateMany({
          where: { id: { in: chunk } },
          data: { pendingDocket: true },
        });
      }
      for (const row of partyNameWrites) {
        await prisma.docketQuotationThread.update({
          where: { id: row.id },
          data: { partyName: row.partyName },
        });
      }
    } catch (err) {
      console.warn("Pending dockets: enrichment write-back failed:", err);
    }

    const response = {
      summary: {
        totalPending: rows.length,
        unrepliedRequestsCount,
        noDocketAssignedCount,
        docketAssignedLaterCount: 0,
        aiValidationEnabled: aiEnabled,
        aiVerifiedCount,
        aiUnverifiedCount,
        aiPendingCount,
        aiRejectedCount,
        aiMaxAttempts: maxAttempts,
      },
      rows,
    };

    setPendingDocketsCache(response, aiCandidates);

    // Background, one-by-one, candidate-only. Never awaited.
    if (aiEnabled) enqueueDocketAiValidation(aiCandidates, perRequestLimit);

    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("Error in GET /api/docket-follow-up/pending-dockets:", error);
    return NextResponse.json(
      {
        error:
          (error instanceof Error ? error.message : "") ||
          "Failed to fetch pending dockets data",
      },
      { status: 500 }
    );
  }
}
