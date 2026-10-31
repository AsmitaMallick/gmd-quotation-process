/**
 * Ofelia entry point for the Purchase Order / GRN sync.
 *
 * Copies the `PURCHASE_ORD_GRN_GID` tab of
 * `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` into `PurchaseOrderLine`.
 *
 * Manual checks: `?dryRun=1` reports without writing, `?limit=200` reads only
 * the first rows. The POST body accepts the same two fields.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`.
 */

// Must be Node: `lib/googleAuth.ts` uses the Node-only Google OAuth client.
export const runtime = "nodejs";

// One tab read (~13k rows) plus the writes.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledPurchaseOrders,
} from "@/schedular_function";

type Options = { dryRun: boolean; limit?: number };

async function readOptions(request: Request): Promise<Options> {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as {
    dryRun?: unknown;
    limit?: unknown;
  };

  const dryRun =
    body.dryRun === true ||
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dryRun") === "true";

  const rawLimit = typeof body.limit === "number" ? body.limit : Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

  return { dryRun, limit };
}

export async function POST(request: Request) {
  // 503 if GMD_SYNC_API_KEY is unset on the server, 401 if the key is wrong.
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const options = await readOptions(request);
    return NextResponse.json(await runScheduledPurchaseOrders(options));
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-purchase-orders] fatal: ${message}`, err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Credential probe: authenticates without running the sync.
export async function GET(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  return NextResponse.json({
    success: true,
    job: "purchase-orders",
    auth: "ok",
    note: "POST to run the job; add ?dryRun=1 to report without writing, ?limit=200 for a smoke test.",
  });
}
