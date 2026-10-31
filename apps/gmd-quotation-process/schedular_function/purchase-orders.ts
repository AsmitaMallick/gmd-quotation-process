/**
 * Scheduled Purchase Order / GRN sync.
 *
 * Copies the `PURCHASE ORD AND GRN` tab of the GMD EXECUTION TRACKING workbook
 * into `PurchaseOrderLine` (stock DB), which is what the Purchase dashboard and
 * the physical stock page's in-transit column read.
 *
 * All logic is in `lib/purchaseOrderSync.ts`; this file adds the in-flight
 * latch and the shape the route returns.
 */

import { syncPurchaseOrders, type PurchaseSyncResult } from "@/lib/purchaseOrderSync";
import { JobAlreadyRunningError } from "./run-gmd-update";

const JOB = "purchase-orders";

/**
 * One run at a time. The sheet read plus ~13k row diff takes long enough that
 * two overlapping runs would both write, and the later one would win on
 * whichever rows it happened to reach last.
 */
let inFlight = false;

export interface RunPurchaseOrdersOptions {
  dryRun?: boolean;
  limit?: number;
}

export interface ScheduledPurchaseResult {
  success: true;
  job: typeof JOB;
  result: PurchaseSyncResult;
}

export async function runScheduledPurchaseOrders(
  options: RunPurchaseOrdersOptions = {},
): Promise<ScheduledPurchaseResult> {
  if (inFlight) throw new JobAlreadyRunningError(JOB);
  inFlight = true;
  try {
    const result = await syncPurchaseOrders(options);
    console.info(
      `[scheduler-${JOB}] ${result.dryRun ? "dry run" : "wrote"}: ` +
        `${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged, ` +
        `${result.openLines} open (${result.untaggedOpenLines} untagged) in ${result.durationMs}ms`,
    );
    return { success: true, job: JOB, result };
  } finally {
    inFlight = false;
  }
}
