/**
 * DEBTORS sheet -> `Debtor` table. Manual CLI; the daily job is
 * `schedular_function/ledger-sync.ts`, which this calls so there is one implementation.
 *
 *   npm run debtors:sync                     # dry run (default): prints the report, writes nothing
 *   npm run debtors:sync:apply               # replaces the table with the sheet's rows
 *   npm run debtors:sync -- --dump-headers   # read-only: the real headers and column map
 *
 * The table has no unique key (opening-balance lines repeat the same
 * accCode + tCode + vrNo), so the sheet is copied as a snapshot: apply deletes
 * every `Debtor` row and inserts the sheet's rows in one transaction. Rows that
 * cannot be mapped (blank ACC_CODE, bad number or date) are skipped and listed.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { readSheetTabByGid } from "@/lib/gmd_lib/bomMastErp";
import { DEBTORS_GID, DEBTORS_HEADERS } from "@/lib/debtorsSync";
import { printLedgerReport, runLedgerSync } from "@/schedular_function/ledger-sync";

const apply = process.argv.includes("--apply");
const dumpHeaders = process.argv.includes("--dump-headers");

async function main() {
  if (dumpHeaders) {
    const spreadsheetId = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("GMD_EXECUTION_TRACKING_SPREADSHEET_ID is not set");
    const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, DEBTORS_GID);
    console.log(`tab "${tabTitle}" (gid ${DEBTORS_GID}): ${rows.length} data rows`);
    console.log(`headers: ${JSON.stringify(headers)}`);
    console.log(`expected: ${JSON.stringify(Object.values(DEBTORS_HEADERS))}`);
    return;
  }

  const report = await runLedgerSync({ dryRun: !apply, only: ["debtors"] });
  printLedgerReport(report, !apply, ["debtors"]);
  if (report.debtors.error) throw new Error(report.debtors.error);
  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to replace the table.");
    return;
  }
  console.log(`\napplied: ${report.debtors.written} rows written, ${report.debtors.inDb} replaced.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
