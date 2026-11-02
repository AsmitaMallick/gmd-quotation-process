/**
 * Scheduled job: DEBTORS, CREDITORS and ADVANCE TO CREDITORS tabs -> `Debtor`,
 * `Creditor`, `CreditorAdvance`. Also the single implementation behind
 * `scripts/sync-debtors.ts` and `scripts/sync-creditors.ts`.
 *
 * Each ledger is read, mapped and replaced in its OWN transaction, so a renamed
 * tab or column on one ledger leaves its table untouched and cannot empty the
 * others. A failure is reported on that ledger's `error`, never thrown.
 * No `@/app/actions` import.
 */

import { JobAlreadyRunningError } from "./run-gmd-update";
import {
  DEBTORS_GID,
  mapDebtorRow,
  resolveDebtorColumns,
  type DebtorRecord,
} from "@/lib/debtorsSync";
import {
  ADVANCES_TAB,
  CREDITORS_TAB,
  mapAdvanceRow,
  mapCreditorRow,
  resolveAdvanceColumns,
  resolveCreditorColumns,
  type CreditorAdvanceRecord,
  type CreditorRecord,
  type RowResult,
} from "@/lib/creditorsSync";

type Tab = { tabTitle?: string; headers: string[]; rows: string[][] };

export type LedgerPartReport = {
  read: number;
  mapped: number;
  skipped: number;
  /** First skipped rows, 1-based sheet line numbers. */
  skippedRows: { line: number; error: string }[];
  written: number;
  /** Rows in the table before this run. */
  inDb: number;
  error?: string;
};

export type LedgerSyncReport = {
  debtors: LedgerPartReport;
  creditors: LedgerPartReport;
  advances: LedgerPartReport;
};

export type LedgerWriter<T> = {
  count(): Promise<number>;
  /** Delete everything and insert `records`, atomically. */
  replace(records: T[]): Promise<void>;
};

export type LedgerSyncDeps = {
  readByGid(gid: number): Promise<Tab>;
  readByTitle(title: string): Promise<Tab | null>;
  debtors: LedgerWriter<DebtorRecord>;
  creditors: LedgerWriter<CreditorRecord>;
  advances: LedgerWriter<CreditorAdvanceRecord>;
};

export type LedgerSyncOptions = {
  /** Read and count, write nothing. */
  dryRun?: boolean;
  /** Sync only these ledgers (the per-ledger CLI scripts); default all. */
  only?: (keyof LedgerSyncReport)[];
  /** Injected in tests; defaults to the real sheet and DB. */
  deps?: LedgerSyncDeps;
};

const CHUNK = 500;
const SKIP_SAMPLE = 15;

function sheetId(): string {
  const id = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
  if (!id) throw new Error("GMD_EXECUTION_TRACKING_SPREADSHEET_ID is not set");
  return id;
}

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) =>
    rows.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/** Real sheet + DB, imported lazily so tests that inject deps never load them. */
async function defaultDeps(): Promise<LedgerSyncDeps> {
  const { prisma } = await import("@/lib/prisma");
  const { readSheetTabByGid, readSheetTabByTitleIfPresent } = await import(
    "@/lib/gmd_lib/bomMastErp"
  );
  // Delegates differ per table, so each writer is spelled out. Delete runs
  // first inside the transaction, so a failed insert leaves the table as it was.
  return {
    readByGid: (gid) => readSheetTabByGid(sheetId(), gid),
    readByTitle: (title) => readSheetTabByTitleIfPresent(sheetId(), title),
    debtors: {
      count: () => prisma.debtor.count(),
      replace: async (rows) => {
        await prisma.$transaction([
          prisma.debtor.deleteMany(),
          ...chunks(rows).map((data) => prisma.debtor.createMany({ data })),
        ]);
      },
    },
    creditors: {
      count: () => prisma.creditor.count(),
      replace: async (rows) => {
        await prisma.$transaction([
          prisma.creditor.deleteMany(),
          ...chunks(rows).map((data) => prisma.creditor.createMany({ data })),
        ]);
      },
    },
    advances: {
      count: () => prisma.creditorAdvance.count(),
      replace: async (rows) => {
        await prisma.$transaction([
          prisma.creditorAdvance.deleteMany(),
          ...chunks(rows).map((data) => prisma.creditorAdvance.createMany({ data })),
        ]);
      },
    },
  };
}

async function syncOne<T>(
  dryRun: boolean,
  readTab: () => Promise<Tab>,
  mapperFor: (tab: Tab) => (row: string[]) => RowResult<T>,
  writer: LedgerWriter<T>,
): Promise<LedgerPartReport> {
  const part: LedgerPartReport = {
    read: 0, mapped: 0, skipped: 0, skippedRows: [], written: 0, inDb: 0,
  };
  try {
    const tab = await readTab();
    const map = mapperFor(tab); // throws on a renamed column, before any write
    const records: T[] = [];
    tab.rows.forEach((row, i) => {
      const r = map(row);
      if (r.ok) records.push(r.record);
      else {
        part.skipped++;
        if (part.skippedRows.length < SKIP_SAMPLE) {
          part.skippedRows.push({ line: i + 2, error: r.error }); // +2: header row, 1-based
        }
      }
    });
    part.read = tab.rows.length;
    part.mapped = records.length;
    part.inDb = await writer.count();
    if (!dryRun) {
      await writer.replace(records);
      part.written = records.length;
    }
  } catch (err) {
    part.error = err instanceof Error ? err.message : String(err);
  }
  return part;
}

export async function runLedgerSync(opts: LedgerSyncOptions = {}): Promise<LedgerSyncReport> {
  const dryRun = opts.dryRun ?? false;
  const d = opts.deps ?? (await defaultDeps());

  const skip = (k: keyof LedgerSyncReport) => opts.only !== undefined && !opts.only.includes(k);
  const idle = (): LedgerPartReport => ({
    read: 0, mapped: 0, skipped: 0, skippedRows: [], written: 0, inDb: 0,
  });

  const byTitle = (title: string) => async () => {
    const tab = await d.readByTitle(title);
    if (!tab) throw new Error(`tab "${title}" not found in the execution-tracking workbook`);
    return tab;
  };

  // Sequential on purpose: independent ledgers, and one Sheets quota hit
  // should not fail three reads at once.
  const debtors = skip("debtors") ? idle() : await syncOne(
    dryRun,
    () => d.readByGid(DEBTORS_GID),
    (t) => {
      const idx = resolveDebtorColumns(t.headers, t.tabTitle ?? "DEBTORS");
      return (row) => mapDebtorRow(row, idx);
    },
    d.debtors,
  );
  const creditors = skip("creditors") ? idle() : await syncOne(
    dryRun,
    byTitle(CREDITORS_TAB),
    (t) => {
      const idx = resolveCreditorColumns(t.headers, CREDITORS_TAB);
      return (row) => mapCreditorRow(row, idx);
    },
    d.creditors,
  );
  const advances = skip("advances") ? idle() : await syncOne(
    dryRun,
    byTitle(ADVANCES_TAB),
    (t) => {
      const idx = resolveAdvanceColumns(t.headers, ADVANCES_TAB);
      return (row) => mapAdvanceRow(row, idx);
    },
    d.advances,
  );
  return { debtors, creditors, advances };
}

/** Print a report the way the two CLI scripts always have. */
export function printLedgerReport(
  r: LedgerSyncReport,
  dryRun: boolean,
  parts: (keyof LedgerSyncReport)[] = ["debtors", "creditors", "advances"],
): void {
  for (const key of parts) {
    const p = r[key];
    console.log(`\n${key}`);
    if (p.error) {
      console.log(`  ERROR: ${p.error}`);
      continue;
    }
    console.log(`  read     : ${p.read}`);
    console.log(`  mappable : ${p.mapped}`);
    console.log(`  skipped  : ${p.skipped}`);
    for (const s of p.skippedRows) console.log(`    line ${s.line}: ${s.error}`);
    if (p.skipped > p.skippedRows.length) {
      console.log(`    ...and ${p.skipped - p.skippedRows.length} more`);
    }
    console.log(`  in DB now: ${p.inDb} (${dryRun ? "would be" : "replaced by"} ${p.mapped})`);
  }
}

export type ScheduledLedgerSyncResult = {
  success: boolean;
  job: "ledger";
  startedAt: string;
  elapsedMs: number;
  report: LedgerSyncReport;
};

// shortcut: in-process latch only, blind to a second app replica; ofelia no-overlap covers the schedule, move to a DB advisory lock if the app is ever scaled out.
let inFlight = false;

/** Route entry. `success` is false when any ledger failed; healthy ledgers are still written. */
export async function runScheduledLedgerSync(
  options: { dryRun?: boolean } = {},
): Promise<ScheduledLedgerSyncResult> {
  if (inFlight) throw new JobAlreadyRunningError("ledger");
  inFlight = true;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  try {
    console.log(`\n########## [SCHEDULER] ledger start ${startedAt} ##########`);
    const report = await runLedgerSync({ dryRun: options.dryRun ?? false });
    const elapsedMs = Date.now() - startedAtMs;
    const success = Object.values(report).every((p) => !p.error);
    for (const [k, p] of Object.entries(report)) {
      console.log(
        `[scheduler] ledger ${k}: mapped=${p.mapped} written=${p.written} skipped=${p.skipped}` +
          (p.error ? ` ERROR=${p.error}` : ""),
      );
    }
    console.log(`########## [SCHEDULER] ledger done in ${elapsedMs}ms ##########\n`);
    return { success, job: "ledger", startedAt, elapsedMs, report };
  } finally {
    inFlight = false;
  }
}
