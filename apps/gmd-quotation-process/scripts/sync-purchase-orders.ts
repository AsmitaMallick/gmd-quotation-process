/**
 * Purchase Order / GRN sync, from the command line.
 *
 *   pnpm --filter gmd-quotation-process po:sync            # dry run, reports only
 *   pnpm --filter gmd-quotation-process po:sync -- --limit 500
 *   pnpm --filter gmd-quotation-process po:sync:apply      # writes
 *
 * Dry run is the default on purpose: the first thing to check on a new tab is
 * whether the column map found everything, not whether the writes worked.
 */

import "dotenv/config";
import { syncPurchaseOrders } from "@/lib/purchaseOrderSync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rawLimit = Number(arg("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

  const result = await syncPurchaseOrders({ dryRun: !apply, limit });

  console.log(`\nTab           : ${result.tabTitle}`);
  console.log(`Mode          : ${result.dryRun ? "DRY RUN (nothing written)" : "APPLY"}`);
  console.log(`Sheet rows    : ${result.sheetRows}`);
  console.log(`  skipped     : ${result.skippedRows} (blank VRNO or repeated header)`);
  console.log(`  duplicates  : ${result.duplicateRows} (same VRNO + SLNO as an earlier row)`);
  console.log(`Inserted      : ${result.inserted}`);
  console.log(`Updated       : ${result.updated}`);
  console.log(`Unchanged     : ${result.unchanged}`);
  console.log(`Open lines    : ${result.openLines} (material still to come)`);
  console.log(`  untagged    : ${result.untaggedOpenLines} (no SALES_CONT, cannot be tied to an order)`);
  console.log(`Took          : ${result.durationMs}ms\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
