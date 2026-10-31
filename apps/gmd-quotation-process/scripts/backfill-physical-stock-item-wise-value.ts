import "dotenv/config";
import { stockPrisma } from "@/lib/stockPrisma";
import { computeItemWiseValue } from "@gmd/physical-stock/columns";

/**
 * One-time backfill: set `PhysicalStock.item_wise_value` to
 * `cost * available qty` (2 decimals) on the stock DB table.
 *
 * Missing operands count as 0, so every row gets a value. Only changed rows are
 * written; safe to re-run.
 *
 *   npm run physical:item-wise          # dry run
 *   npm run physical:item-wise:apply    # write
 */

const apply = process.argv.includes("--apply");

async function main() {
  console.log(
    `\n=== Physical Stock item_wise_value backfill ${apply ? "(APPLY - writes)" : "(DRY RUN)"} ===\n`,
  );

  const rows = await stockPrisma.physicalStock.findMany({
    select: {
      id: true,
      erp_code: true,
      cost: true,
      available_qty: true,
      item_wise_value: true,
    },
  });

  let changed = 0;
  const writes: { id: string; item_wise_value: string }[] = [];
  const preview: {
    erp_code: string;
    cost: string;
    available_qty: string;
    from: string;
    to: string;
  }[] = [];

  for (const row of rows) {
    const next = computeItemWiseValue(row.cost, row.available_qty);
    if (next === row.item_wise_value) continue;
    changed++;
    writes.push({ id: row.id, item_wise_value: next });
    if (preview.length < 25) {
      preview.push({
        erp_code: row.erp_code ?? "",
        cost: row.cost ?? "",
        available_qty: row.available_qty ?? "",
        from: row.item_wise_value ?? "",
        to: next,
      });
    }
  }

  console.log(`Rows scanned : ${rows.length}`);
  console.log(`Rows to change: ${changed}`);
  console.table(preview);

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to write.\n`);
    return;
  }

  const chunkSize = 200;
  let updated = 0;
  for (let i = 0; i < writes.length; i += chunkSize) {
    await stockPrisma.$transaction(
      writes
        .slice(i, i + chunkSize)
        .map((w) =>
          stockPrisma.physicalStock.update({
            where: { id: w.id },
            data: { item_wise_value: w.item_wise_value },
          }),
        ),
      { timeout: 120_000, maxWait: 30_000 },
    );
    updated += Math.min(chunkSize, writes.length - i);
  }

  console.log(`\nApplied: updated=${updated}\n`);
}

main()
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stockPrisma.$disconnect();
  });
