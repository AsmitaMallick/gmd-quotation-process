import { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import { fetchSheetRows } from "@/lib/pbg/google";
import { mapRows } from "@/lib/pbg/pbg";
import {
  parseFlexibleDate,
  normalizePo,
  normalizeBg,
  isSrInvoice,
} from "@/lib/pbg/supply-history";
import { computeExtendedValidity } from "@/lib/pbg/validity";
import { splitCsvLinks } from "@/lib/gmd_lib/contract-order-links";
import {
  canonicalPbgClientName,
  canonicalProjectName,
} from "@/lib/pbg/project-names";
import type { CellValue } from "@/lib/pbg/pbg-cell";
import type { ColumnKey } from "@/lib/pbg/pbg-columns";

/** Records whose status is "Closed" are hidden unless explicitly requested. */
const EXCLUDE_CLOSED_WHERE = {
  AND: [
    {
      OR: [
        { status: null },
        { status: { not: "closed", mode: "insensitive" as const } },
      ],
    },
    {
      OR: [
        { status: null },
        { status: { not: "close", mode: "insensitive" as const } },
      ],
    },
  ],
};

/** A manually uploaded Bank Guarantee document stored on a PBG row. */
export type PbgFile = {
  name: string;
  url: string;
  fileId: string;
};

export type PbgRecord = {
  id: string;
  clientName: string | null;
  project: string | null;
  poNumber: string | null;
  poDate: string | null;
  bgNo: string | null;
  bgDate: string | null;
  bgAmtFc: number | null;
  expiryDate: string | null;
  claimDate: string | null;
  marginPct: number | null;
  marginAmount: number | null;
  contactPerson: string | null;
  contactNumber: string | null;
  remark: string | null;
  status: string | null;
  /** HOLD (or null) blocks reminders; CONTINUE allows the daily job to mail. */
  mailTrigger: string | null;
  bankGuarantee: PbgFile[] | null;
  /** Order-list attachment links from the matched supply-history row. */
  orderList: string[] | null;
  /** User-set contract validity duration (e.g. "5y", "18m"). */
  validityOn: string | null;
  /** Derived: latest SupplyHistoryItem.date for this row (by BG no. or PO). */
  lastSupplyDate: string | null;
  /** Derived: lastSupplyDate + validityOn duration. */
  extendedValidity: string | null;
  syncedAt: string | null;
  updatedAt: string | null;
};

/** Coerces the stored JSON array into typed Bank Guarantee files. */
export function parsePbgFiles(value: unknown): PbgFile[] | null {
  if (!Array.isArray(value)) return null;
  const files: PbgFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : null;
    if (!url) continue;
    files.push({
      name: typeof record.name === "string" ? record.name : "file",
      url,
      fileId: typeof record.fileId === "string" ? record.fileId : "",
    });
  }
  return files.length > 0 ? files : null;
}

function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toNum(value: { toString(): string } | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads PBG rows from the database for the dashboard.
 *
 * Closed records are excluded by default so hidden rows never leave the
 * database. Pass `includeClosed: true` to load the full set.
 * Uncached: the calling component is wrapped in <Suspense> so it streams
 * at request time and always reflects the latest data.
 */
export async function getPbgData(
  options: { includeClosed?: boolean } = {},
): Promise<PbgRecord[]> {
  const includeClosed = options.includeClosed ?? false;

  const rows = await prisma.pbgData.findMany({
    where: includeClosed ? undefined : EXCLUDE_CLOSED_WHERE,
    orderBy: { id: "asc" },
  });

  const { byPo, byBg } = await loadSupplyMatches(rows);

  return rows.map((row) => {
    const candidates = [
      byBg.get(normalizeBg(row.bgNo)),
      byPo.get(normalizePo(row.poNumber ?? "")),
    ].filter((value): value is SupplyMatch => value !== undefined);

    let match: SupplyMatch | undefined;
    for (const candidate of candidates) {
      if (!match || candidate.date > match.date) match = candidate;
    }

    const lastSupplyDate = match ? toDateOnly(match.date) : null;
    const matchPoDate = match ? parseFlexibleDate(match.poDate) : null;
    const orderList = match && match.orderList.length > 0 ? match.orderList : null;

    return {
      id: row.id.toString(),
      clientName: canonicalPbgClientName(row.clientName),
      project: canonicalProjectName(row.project, row.poNumber),
      poNumber: match?.poNumber ?? row.poNumber,
      poDate: toDateOnly(matchPoDate) ?? toDateOnly(row.poDate),
      bgNo: row.bgNo,
      bgDate: toDateOnly(row.bgDate),
      bgAmtFc: toNum(row.bgAmtFc),
      expiryDate: toDateOnly(row.expiryDate),
      claimDate: toDateOnly(row.claimDate),
      marginPct: toNum(row.marginPct),
      marginAmount: toNum(row.marginAmount),
      contactPerson: row.contactPerson,
      contactNumber: row.contactNumber,
      remark: row.remark,
      status: row.status,
      mailTrigger: row.mailTrigger,
      bankGuarantee: parsePbgFiles(row.bankGuarantee),
      orderList,
      validityOn: row.validityOn,
      lastSupplyDate,
      extendedValidity: computeExtendedValidity(row.validityOn, lastSupplyDate),
      syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  });
}

/** The supply-history row chosen for a PBG row (latest non-SR date). */
type SupplyMatch = {
  date: Date;
  poNumber: string | null;
  poDate: string | null;
  orderList: string[];
};

/**
 * One bounded query: for the given PBG rows, loads supply-history rows matching
 * by BG number OR PO number (case-insensitive) and keeps, per key, the row with
 * the latest non-SR parsed date.
 */
async function loadSupplyMatches(
  rows: Array<{ poNumber: string | null; bgNo: string | null }>,
): Promise<{ byPo: Map<string, SupplyMatch>; byBg: Map<string, SupplyMatch> }> {
  const byPo = new Map<string, SupplyMatch>();
  const byBg = new Map<string, SupplyMatch>();

  const poValues = Array.from(
    new Set(rows.map((row) => row.poNumber).filter(isNonBlank)),
  );
  const bgValues = Array.from(
    new Set(rows.map((row) => row.bgNo).filter(isNonBlank)),
  );
  if (poValues.length === 0 && bgValues.length === 0) return { byPo, byBg };

  const or: Prisma.SupplyHistoryItemWhereInput[] = [];
  if (poValues.length > 0) {
    or.push({ partyOrderNo: { in: poValues, mode: "insensitive" } });
  }
  if (bgValues.length > 0) {
    or.push({ bgNo: { in: bgValues, mode: "insensitive" } });
  }

  const history = await prisma.supplyHistoryItem.findMany({
    where: { OR: or },
    select: {
      partyOrderNo: true,
      bgNo: true,
      date: true,
      invoiceNo: true,
      partyDate: true,
      orderList: true,
    },
  });

  for (const item of history) {
    // Skip "SR" series invoices so the previous non-SR supply wins.
    if (isSrInvoice(item.invoiceNo)) continue;
    const date = parseFlexibleDate(item.date);
    if (!date) continue;

    const match: SupplyMatch = {
      date,
      poNumber: item.partyOrderNo,
      poDate: item.partyDate,
      orderList: splitCsvLinks(item.orderList),
    };

    const poKey = normalizePo(item.partyOrderNo ?? "");
    if (poKey) consider(byPo, poKey, match);
    const bgKey = normalizeBg(item.bgNo ?? "");
    if (bgKey) consider(byBg, bgKey, match);
  }

  return { byPo, byBg };
}

function consider(
  map: Map<string, SupplyMatch>,
  key: string,
  match: SupplyMatch,
): void {
  const current = map.get(key);
  if (!current || match.date > current.date) map.set(key, match);
}

function isNonBlank(value: string | null): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Updates a single cell by row id. Used by the inline editor.
 */
export async function updatePbgCell(
  id: string,
  key: ColumnKey,
  value: CellValue,
): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: new Date(), [key]: value };
  await prisma.pbgData.update({
    where: { id: BigInt(id) },
    data: data as unknown as Prisma.PbgDataUpdateInput,
  });
}

export type PbgSyncResult = {
  totalInSheet: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skippedBlankBgNo: number;
  duplicateInSheet: number;
  elapsedMs: number;
};

/** Sheet-owned columns (plus the BG_NO key). Nothing else is written. */
const SYNC_STRING_FIELDS = ["clientName", "status"] as const;
const SYNC_NUMBER_FIELDS = ["bgAmtFc", "marginPct", "marginAmount"] as const;

/**
 * Preserving sync: reads the sheet and upserts ONLY `BG_NO`, `BG_AMT`,
 * `CANCELLED_STATUS`, `MARGIN %`, `MARGIN_AMT` and `BENEFICIARY_NAME`, keyed on
 * the BG number. Existing rows are updated only where the sheet value is
 * non-blank and differs; new BG numbers are inserted. Nothing is ever deleted,
 * and every other column (PO no., PO date, bankGuarantee, validityOn, …) is
 * left untouched.
 */
export async function syncPbgData(): Promise<PbgSyncResult> {
  const startedAt = Date.now();
  const sheetRows = await fetchSheetRows();
  const { data } = mapRows(sheetRows);

  for (const row of data) {
    row.clientName = canonicalPbgClientName(row.clientName);
  }

  const seen = new Set<string>();
  const candidates: typeof data = [];
  let skippedBlankBgNo = 0;
  let duplicateInSheet = 0;

  for (const row of data) {
    const key = normalizeBg(row.bgNo);
    if (!key) {
      skippedBlankBgNo += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicateInSheet += 1;
      continue;
    }
    seen.add(key);
    candidates.push(row);
  }

  const existingRows = await prisma.pbgData.findMany({
    select: {
      id: true,
      bgNo: true,
      clientName: true,
      bgAmtFc: true,
      marginPct: true,
      marginAmount: true,
      status: true,
    },
  });

  const byBg = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    const key = normalizeBg(row.bgNo);
    if (key && !byBg.has(key)) byBg.set(key, row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const now = new Date();

  for (const row of candidates) {
    const key = normalizeBg(row.bgNo) as string;
    const existing = byBg.get(key);

    if (!existing) {
      await prisma.pbgData.create({
        data: {
          bgNo: row.bgNo,
          clientName: row.clientName,
          bgAmtFc: row.bgAmtFc,
          marginPct: row.marginPct,
          marginAmount: row.marginAmount,
          status: row.status,
          syncedAt: now,
          updatedAt: now,
        },
      });
      inserted += 1;
      continue;
    }

    const patch: Prisma.PbgDataUpdateInput = {};
    if (row.clientName !== null && row.clientName !== existing.clientName) {
      patch.clientName = row.clientName;
    }
    for (const field of SYNC_NUMBER_FIELDS) {
      const value = row[field];
      if (value !== null && value !== toNum(existing[field])) {
        patch[field] = value;
      }
    }
    for (const field of SYNC_STRING_FIELDS) {
      const value = row[field];
      if (value !== null && value !== existing[field]) {
        patch[field] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      unchanged += 1;
      continue;
    }

    patch.syncedAt = now;
    patch.updatedAt = now;
    await prisma.pbgData.update({ where: { id: existing.id }, data: patch });
    updated += 1;
  }

  return {
    totalInSheet: data.length,
    inserted,
    updated,
    unchanged,
    skippedBlankBgNo,
    duplicateInSheet,
    elapsedMs: Date.now() - startedAt,
  };
}
