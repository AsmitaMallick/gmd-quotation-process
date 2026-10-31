import "dotenv/config";
import { stockPrisma } from "@/lib/stockPrisma";
import {
  addQty,
  computeAvailableQty,
  computeItemWiseValue,
  isGeneratedErpCode,
  itemKey,
} from "@gmd/physical-stock/columns";

/**
 * One-time cleanup: PhysicalStock rows with a generated ERP code (3 letters +
 * 6 digits) that share location + L2/Dia/L7/L4/L5/L6/L8 are duplicates. The
 * oldest row is kept, received/dispatch qty of the group are summed into it
 * (available_qty and item_wise_value recomputed) and the rest are deleted.
 * Sheet-synced rows with real ERP codes are never touched.
 *
 *   npm run physical:dedupe          # dry run
 *   npm run physical:dedupe:apply    # write (back up the stock DB first)
 */

const apply = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== Physical Stock dedupe ${apply ? "(APPLY - writes)" : "(DRY RUN)"} ===\n`);

  const rows = await stockPrisma.physicalStock.findMany({ orderBy: { created_at: "asc" } });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!isGeneratedErpCode(r.erp_code)) continue;
    const key = itemKey(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const dupes = [...groups.values()].filter((g) => g.length > 1);
  let deleted = 0;
  for (const [keep, ...rest] of dupes) {
    let received = keep.received_qty;
    let dispatch = keep.dispatch_qty;
    for (const r of rest) {
      received = addQty(received, r.received_qty);
      dispatch = addQty(dispatch, r.dispatch_qty);
    }
    const data: Record<string, string | null> = { received_qty: received, dispatch_qty: dispatch };
    const available = computeAvailableQty(received, dispatch);
    if (available !== null) {
      data.available_qty = available;
      data.item_wise_value = computeItemWiseValue(keep.cost, available);
    }

    console.log(
      `keep ${keep.erp_code} <- delete ${rest.map((r) => r.erp_code).join(",")} | received=${received} dispatch=${dispatch} available=${data.available_qty ?? keep.available_qty}`,
    );
    if (!apply) continue;
    // No transaction (P2028 on this connection): update first so qty is never lost.
    await stockPrisma.physicalStock.update({ where: { id: keep.id }, data });
    await stockPrisma.physicalStock.deleteMany({ where: { id: { in: rest.map((r) => r.id) } } });
    deleted += rest.length;
  }

  console.log(`\nDuplicate groups: ${dupes.length}, rows to delete: ${dupes.reduce((n, g) => n + g.length - 1, 0)}`);
  console.log(apply ? `Applied: deleted=${deleted}\n` : `Dry run only. Re-run with --apply to write.\n`);
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stockPrisma.$disconnect();
  });
