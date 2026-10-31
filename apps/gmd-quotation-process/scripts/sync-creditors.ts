/**
 * CREDITORS + ADVANCE TO CREDITORS sheet tabs -> `Creditor` / `CreditorAdvance` tables. Manual CLI;
 * the daily job is `schedular_function/ledger-sync.ts`, which this calls.
 *
 *   npm run creditors:sync                     # dry run (default): prints the report, writes nothing
 *   npm run creditors:sync:apply               # replaces both tables with the sheet's rows
 *   npm run creditors:sync -- --dump-headers   # read-only: the real headers vs expected
 *
 * Snapshot copy (no unique key): apply deletes every row of a table and inserts
 * the sheet's rows, one transaction per table. Rows that cannot be mapped
 * (blank ACC_CODE, bad number or date) are skipped and listed. A missing tab or
 * renamed column fails that table before anything is written to it.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { readSheetTabByTitleIfPresent } from "@/lib/gmd_lib/bomMastErp";
import {
  ADVANCES_TAB,
  ADVANCE_HEADERS,
  CREDITORS_TAB,
  CREDITOR_HEADERS,
} from "@/lib/creditorsSync";
import { printLedgerReport, runLedgerSync } from "@/schedular_function/ledger-sync";

const apply = process.argv.includes("--apply");
const dumpHeaders = process.argv.includes("--dump-headers");
const parts = ["creditors", "advances"] as const;

async function main() {
  if (dumpHeaders) {
    const spreadsheetId = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("GMD_EXECUTION_TRACKING_SPREADSHEET_ID is not set");
    for (const [title, expected] of [
      [CREDITORS_TAB, CREDITOR_HEADERS],
      [ADVANCES_TAB, ADVANCE_HEADERS],
    ] as const) {
      const tab = await readSheetTabByTitleIfPresent(spreadsheetId, title);
      if (!tab) throw new Error(`tab "${title}" not found in the execution-tracking workbook`);
      console.log(`tab "${title}": ${tab.rows.length} data rows`);
      console.log(`${title} headers: ${JSON.stringify(tab.headers)}`);
      console.log(`${title} expected: ${JSON.stringify(Object.values(expected))}`);
    }
    return;
  }

  const report = await runLedgerSync({ dryRun: !apply, only: [...parts] });
  printLedgerReport(report, !apply, [...parts]);
  const failed = parts.filter((k) => report[k].error);
  if (failed.length) throw new Error(`failed: ${failed.join(", ")}`);
  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to replace both tables.");
    return;
  }
  console.log(`\napplied: ${report.creditors.written} bills + ${report.advances.written} advances written.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
