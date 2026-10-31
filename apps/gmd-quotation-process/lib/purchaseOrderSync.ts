/**
 * `PURCHASE ORD AND GRN` -> `PurchaseOrderLine` (stock DB).
 *
 * Source: the `PURCHASE_ORD_GRN_GID` tab of
 * `GMD_EXECUTION_TRACKING_SPREADSHEET_ID`. The tab is the ERP's purchase ledger
 * at line level and already carries the GRN progress, so this sync copies
 * rather than computes — see `docs/purchase-in-transit.md`.
 *
 * ── Matching ──
 *
 * `(VRNO, SLNO)` — the order number and the line within it. Unique on the tab,
 * and the table's unique key. A second row with the same pair is counted as
 * `duplicateRows` and skipped: the two cannot both be right, and overwriting
 * one with the other would make the result depend on sheet order.
 *
 * The tab repeats its header as the first data row on the live sheet, so a row
 * whose `VRNO` reads `VRNO` is dropped (`isRepeatedHeaderRow`).
 *
 * ── Write policy, the same as `executionTrackingSync` ──
 *
 *   - a blank cell — including the `-` `--` `—` `–` sentinels — never clears a
 *     stored value;
 *   - `poNo` and `poLineNo` are never rewritten (they are the key);
 *   - nothing is ever deleted: a line that leaves the sheet keeps its last
 *     known state, because the ERP drops closed orders from the export and
 *     losing the history would be worse than holding a stale closed line;
 *   - `inTransit` and `lineValue` are derived on every write from the cells
 *     that landed, so the stored number always matches the stored strings.
 */

import { stockPrisma } from "@gmd/db-stock";
import { cell, findColumn, readSheetTabByGid, requireColumns } from "@/lib/gmd_lib/bomMastErp";
import { executionTrackingSpreadsheetId } from "@/lib/gmd_lib/execution-tracking-columns";
import {
  COLUMN_MAP,
  KEY_HEADERS,
  isBlankSheetValue,
  isRepeatedHeaderRow,
  normalizeKey,
  rowKey,
  type PurchaseField,
} from "@gmd/purchase/columns";
import { inTransitQty, parseQty } from "@gmd/purchase/in-transit";

/** Rows per write chunk. Matches `executionTrackingSync`. */
const WRITE_CHUNK = 200;

export interface PurchaseSyncOptions {
  /** Report without writing. */
  dryRun?: boolean;
  /** Stop after this many sheet rows, for a smoke test. */
  limit?: number;
}

export interface PurchaseSyncResult {
  dryRun: boolean;
  tabTitle: string;
  sheetRows: number;
  /** Rows dropped because `VRNO` was blank or the row repeated the header. */
  skippedRows: number;
  /** Rows sharing a `(VRNO, SLNO)` with an earlier row. */
  duplicateRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Of the rows now stored, how many have material still to come. */
  openLines: number;
  /** Open lines carrying no `SALES_CONT`, so not attributable to an order. */
  untaggedOpenLines: number;
  durationMs: number;
}

/** `PURCHASE_ORD_GRN_GID`, with the live gid as the fallback. */
export function purchaseOrdGrnGid(): number {
  const raw = process.env.PURCHASE_ORD_GRN_GID;
  const gid = Number(raw);
  // 1895689370 is the tab on the live workbook, confirmed 2026-10-31. The env
  // var exists so a copied workbook can point elsewhere without a deploy.
  return raw && Number.isInteger(gid) ? gid : 1895689370;
}

type FieldValues = Partial<Record<PurchaseField, string>>;

/** The derived columns, from whatever strings the row ended up with. */
function derive(values: {
  balanceQty?: string | null;
  netQtyOrder?: string | null;
  qtyExecuted?: string | null;
  basicAmount?: string | null;
}): { inTransit: number; lineValue: number | null } {
  return {
    inTransit: inTransitQty({
      balanceQty: values.balanceQty ?? null,
      netQtyOrder: values.netQtyOrder ?? null,
      qtyExecuted: values.qtyExecuted ?? null,
    }),
    lineValue: parseQty(values.basicAmount ?? null),
  };
}

export async function syncPurchaseOrders(
  options: PurchaseSyncOptions = {},
): Promise<PurchaseSyncResult> {
  const started = Date.now();
  const dryRun = options.dryRun === true;

  const spreadsheetId = executionTrackingSpreadsheetId();
  const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, purchaseOrdGrnGid());

  // The key columns must exist; a missing one means the tab changed shape and
  // guessing would write junk over real rows.
  requireColumns(headers, [KEY_HEADERS.poNo, KEY_HEADERS.poLineNo], tabTitle);

  const indexOf = new Map<string, number>();
  for (const { sheet } of COLUMN_MAP) {
    const idx = findColumn(headers, sheet);
    if (idx >= 0) indexOf.set(sheet, idx);
  }
  const poNoIdx = findColumn(headers, KEY_HEADERS.poNo);
  const poLineIdx = findColumn(headers, KEY_HEADERS.poLineNo);

  const limited = options.limit ? rows.slice(0, options.limit) : rows;

  let skippedRows = 0;
  let duplicateRows = 0;
  const parsed = new Map<string, { poNo: string; poLineNo: string; values: FieldValues }>();

  for (const row of limited) {
    const get = (header: string): string => {
      const idx = indexOf.get(header);
      return idx === undefined ? "" : cell(row, idx);
    };
    const poNo = cell(row, poNoIdx).trim();
    if (isRepeatedHeaderRow(poNo) || !poNo) {
      skippedRows += 1;
      continue;
    }
    const poLineNo = cell(row, poLineIdx).trim();
    const key = rowKey(poNo, poLineNo);
    if (parsed.has(key)) {
      duplicateRows += 1;
      continue;
    }

    const values: FieldValues = {};
    for (const { sheet, db } of COLUMN_MAP) {
      const raw = get(sheet);
      if (!isBlankSheetValue(raw)) values[db] = raw.trim();
    }
    parsed.set(key, { poNo, poLineNo, values });
  }

  // One read of what is stored, so the diff is in memory rather than 13k queries.
  const existing = await stockPrisma.purchaseOrderLine.findMany();
  const byKey = new Map(existing.map((e) => [rowKey(e.poNo, e.poLineNo), e]));

  const inserts: (FieldValues & { poNo: string; poLineNo: string; inTransit: number; lineValue: number | null })[] =
    [];
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  let unchanged = 0;

  for (const [key, { poNo, poLineNo, values }] of parsed) {
    const current = byKey.get(key);

    if (!current) {
      const derived = derive(values);
      inserts.push({ poNo, poLineNo, ...values, ...derived } as never);
      continue;
    }

    // Blank sheet cells were dropped above, so anything here is a real value.
    const changes: Record<string, unknown> = {};
    for (const { db } of COLUMN_MAP) {
      const next = values[db];
      if (next === undefined) continue;
      if ((current as Record<string, unknown>)[db] !== next) changes[db] = next;
    }

    const merged = {
      balanceQty: values.balanceQty ?? current.balanceQty,
      netQtyOrder: values.netQtyOrder ?? current.netQtyOrder,
      qtyExecuted: values.qtyExecuted ?? current.qtyExecuted,
      basicAmount: values.basicAmount ?? current.basicAmount,
    };
    const derived = derive(merged);
    if (current.inTransit !== derived.inTransit) changes.inTransit = derived.inTransit;
    if (current.lineValue !== derived.lineValue) changes.lineValue = derived.lineValue;

    if (Object.keys(changes).length === 0) {
      unchanged += 1;
      continue;
    }
    changes.syncedAt = new Date();
    updates.push({ id: current.id, data: changes });
  }

  if (!dryRun) {
    for (let i = 0; i < inserts.length; i += WRITE_CHUNK) {
      await stockPrisma.purchaseOrderLine.createMany({
        data: inserts.slice(i, i + WRITE_CHUNK) as never,
        skipDuplicates: true,
      });
    }
    for (const { id, data } of updates) {
      await stockPrisma.purchaseOrderLine.update({ where: { id }, data: data as never });
    }
  }

  // Counted from what the sync just decided, so a dry run reports the same
  // numbers a real run would produce.
  let openLines = 0;
  let untaggedOpenLines = 0;
  for (const [key, { values }] of parsed) {
    const current = byKey.get(key);
    const merged = {
      balanceQty: values.balanceQty ?? current?.balanceQty ?? null,
      netQtyOrder: values.netQtyOrder ?? current?.netQtyOrder ?? null,
      qtyExecuted: values.qtyExecuted ?? current?.qtyExecuted ?? null,
    };
    if (inTransitQty(merged) > 0) {
      openLines += 1;
      const contract = values.salesContract ?? current?.salesContract ?? "";
      if (!normalizeKey(contract)) untaggedOpenLines += 1;
    }
  }

  return {
    dryRun,
    tabTitle,
    sheetRows: limited.length,
    skippedRows,
    duplicateRows,
    inserted: inserts.length,
    updated: updates.length,
    unchanged,
    openLines,
    untaggedOpenLines,
    durationMs: Date.now() - started,
  };
}
