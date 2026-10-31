/**
 * CREDITORS + ADVANCE TO CREDITORS sheet tabs -> `Creditor` / `CreditorAdvance` tables. Manual CLI.
 *
 *   npm run creditors:sync                     # dry run (default): prints the report, writes nothing
 *   npm run creditors:sync:apply               # replaces both tables with the sheet's rows
 *   npm run creditors:sync -- --dump-headers   # read-only: the real headers vs expected
 *
 * Snapshot copy (no unique key): apply deletes every row of both tables and
 * inserts the sheet's rows in ONE transaction. Rows that cannot be mapped
 * (blank ACC_CODE, bad number or date) are skipped and listed. A missing tab or
 * renamed column aborts before anything is written.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { readSheetTabByTitleIfPresent } from "@/lib/gmd_lib/bomMastErp";
import {
  ADVANCES_TAB,
  ADVANCE_HEADERS,
  CREDITORS_TAB,
  CREDITOR_HEADERS,
  mapAdvanceRow,
  mapCreditorRow,
  resolveAdvanceColumns,
  resolveCreditorColumns,
  type RowResult,
} from "@/lib/creditorsSync";

const CHUNK = 500;

const apply = process.argv.includes("--apply");
const dumpHeaders = process.argv.includes("--dump-headers");

async function readTab(spreadsheetId: string, title: string) {
  const tab = await readSheetTabByTitleIfPresent(spreadsheetId, title);
  if (!tab) throw new Error(`tab "${title}" not found in the execution-tracking workbook`);
  return tab;
}

function mapAll<T>(rows: string[][], map: (row: string[]) => RowResult<T>) {
  const records: T[] = [];
  const skipped: { line: number; error: string }[] = [];
  rows.forEach((row, i) => {
    const result = map(row);
    if (result.ok) records.push(result.record);
    else skipped.push({ line: i + 2, error: result.error }); // +2: header row, 1-based
  });
  return { records, skipped };
}

function report(label: string, mappable: number, skipped: { line: number; error: string }[], inDb: number) {
  console.log(`\n${label}`);
  console.log(`  mappable : ${mappable}`);
  console.log(`  skipped  : ${skipped.length}`);
  for (const s of skipped.slice(0, 15)) console.log(`    line ${s.line}: ${s.error}`);
  if (skipped.length > 15) console.log(`    ...and ${skipped.length - 15} more`);
  console.log(`  in DB now: ${inDb} (will be replaced by ${mappable})`);
}

async function main() {
  const spreadsheetId = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("GMD_EXECUTION_TRACKING_SPREADSHEET_ID is not set");

  const cred = await readTab(spreadsheetId, CREDITORS_TAB);
  const adv = await readTab(spreadsheetId, ADVANCES_TAB);
  console.log(`tab "${CREDITORS_TAB}": ${cred.rows.length} data rows`);
  console.log(`tab "${ADVANCES_TAB}": ${adv.rows.length} data rows`);

  if (dumpHeaders) {
    console.log(`${CREDITORS_TAB} headers: ${JSON.stringify(cred.headers)}`);
    console.log(`${CREDITORS_TAB} expected: ${JSON.stringify(Object.values(CREDITOR_HEADERS))}`);
    console.log(`${ADVANCES_TAB} headers: ${JSON.stringify(adv.headers)}`);
    console.log(`${ADVANCES_TAB} expected: ${JSON.stringify(Object.values(ADVANCE_HEADERS))}`);
    return;
  }

  const cIdx = resolveCreditorColumns(cred.headers, CREDITORS_TAB);
  const aIdx = resolveAdvanceColumns(adv.headers, ADVANCES_TAB);
  const creditors = mapAll(cred.rows, (r) => mapCreditorRow(r, cIdx));
  const advances = mapAll(adv.rows, (r) => mapAdvanceRow(r, aIdx));

  const [creditorsInDb, advancesInDb] = await Promise.all([
    prisma.creditor.count(),
    prisma.creditorAdvance.count(),
  ]);

  const billTotal = creditors.records.reduce((n, r) => n + (r.unAllocCr ?? 0), 0);
  const advTotal = advances.records.reduce((n, r) => n + (r.unAllocDr ?? 0), 0);
  report(CREDITORS_TAB, creditors.records.length, creditors.skipped, creditorsInDb);
  console.log(`  total UN_ALLOC_CR: ${billTotal.toFixed(2)}`);
  report(ADVANCES_TAB, advances.records.length, advances.skipped, advancesInDb);
  console.log(`  total UN_ALLOC_DR: ${advTotal.toFixed(2)}`);

  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to replace both tables.");
    return;
  }

  const ops = [prisma.creditor.deleteMany(), prisma.creditorAdvance.deleteMany()];
  for (let i = 0; i < creditors.records.length; i += CHUNK) {
    ops.push(prisma.creditor.createMany({ data: creditors.records.slice(i, i + CHUNK) }) as never);
  }
  for (let i = 0; i < advances.records.length; i += CHUNK) {
    ops.push(prisma.creditorAdvance.createMany({ data: advances.records.slice(i, i + CHUNK) }) as never);
  }
  await prisma.$transaction(ops);
  console.log(`\napplied: ${creditors.records.length} bills + ${advances.records.length} advances written.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
