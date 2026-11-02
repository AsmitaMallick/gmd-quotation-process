import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  canonicalPbgClientName,
  canonicalProjectName,
} from "../lib/pbg/project-names";

const adapter = new PrismaPg({
  connectionString: process.env.QUOTATION_DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

function show(value: string | null): string {
  if (value === null) return "<null>";
  if (value === "") return "<blank>";
  return value;
}

async function main() {
  console.log(
    `\n=== NORMALISE PBG project/client names [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`,
  );

  const rows = await prisma.pbgData.findMany({
    select: {
      id: true,
      bgNo: true,
      poNumber: true,
      clientName: true,
      project: true,
    },
    orderBy: { id: "asc" },
  });

  type Change = {
    id: bigint;
    bgNo: string | null;
    poNumber: string | null;
    clientFrom: string | null;
    clientTo: string | null;
    projectFrom: string | null;
    projectTo: string | null;
  };

  const changes: Change[] = [];
  for (const row of rows) {
    const clientTo = canonicalPbgClientName(row.clientName);
    const projectTo = canonicalProjectName(row.project, row.poNumber);
    if (clientTo === row.clientName && projectTo === row.project) continue;
    changes.push({
      id: row.id,
      bgNo: row.bgNo,
      poNumber: row.poNumber,
      clientFrom: row.clientName,
      clientTo,
      projectFrom: row.project,
      projectTo,
    });
  }

  console.log("--- PREVIEW (rows that would change) ---");
  for (const change of changes) {
    console.log(
      `[CHANGE] ${change.id.toString().padEnd(6)} | ${show(change.bgNo)} | PO ${show(
        change.poNumber,
      )}`,
    );
    if (change.clientFrom !== change.clientTo) {
      console.log(
        `  client : ${show(change.clientFrom)} -> ${show(change.clientTo)}`,
      );
    }
    if (change.projectFrom !== change.projectTo) {
      console.log(
        `  project: ${show(change.projectFrom)} -> ${show(change.projectTo)}`,
      );
    }
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Total rows:   ${rows.length}`);
  console.log(`Would change: ${changes.length}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.\n");
    return;
  }

  let updated = 0;
  for (const change of changes) {
    await prisma.pbgData.update({
      where: { id: change.id },
      data: {
        clientName: change.clientTo,
        project: change.projectTo,
        updatedAt: new Date(),
      },
    });
    updated += 1;
  }

  console.log(`\nApplied. Updated ${updated} row(s).\n`);
}

main()
  .catch((err) => {
    console.error("Normalise failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
