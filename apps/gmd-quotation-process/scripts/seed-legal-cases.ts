/**
 * Seeds the six litigation cases found in mail (Notion: "Legal status per client", 31 Oct 2026).
 *
 *   npx tsx scripts/seed-legal-cases.ts            # dry run (default): prints what would be written
 *   npx tsx scripts/seed-legal-cases.ts --apply    # writes
 *
 * Parties are matched by accCode, resolved from the Debtor table's accName. A name with no match
 * (or more than one accCode) is reported and skipped, never invented. A party that already has a
 * case row is left alone so Legal's edits are never overwritten.
 * Achme's case number ("likely") and GWSSB's closure ("confirm closed") are NOT confirmed: the
 * status is set, the case number is left blank, and lastUpdate says it awaits Legal.
 */
import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL }) });
const APPLY = process.argv.includes("--apply");

type Seed = { match: string; status: string; forum: string; caseNo: string | null; filingDate?: string; lastUpdate: string };
const SEEDS: Seed[] = [
  {
    match: "achme",
    status: "MSEFC arbitration",
    forum: "WBMSEFC; criminal complaint CC/8617/2025 (BNS 316(2)/61(2)), Bidhannagar Court, filed 23.12.2025",
    caseNo: null, // source says "likely 212/2024"; not confirmed
    lastUpdate: "Arbitration hearing 30.01.2026 (respondent absent); criminal case pending. WBMSEFC case number awaits Legal's confirmation.",
  },
  {
    match: "gharpure",
    status: "MSEFC conciliation",
    forum: "WBMSEFC (MSME ODR e-filing)",
    caseNo: "ED-2025-0002328",
    lastUpdate: "Admitted 07.04.2026; documents submitted 27.04.2026. Dues per mail Rs 85,775; claim amount awaits Legal.",
  },
  {
    match: "vigneshwara",
    status: "MSEFC arbitration",
    forum: "WBMSEFC",
    caseNo: "211/2024",
    lastUpdate: "Conciliation ended, arbitration started (Jul 2025); Council asked for the correct postal address.",
  },
  {
    match: "vprp",
    status: "MSEFC arbitration",
    forum: "WBMSEFC",
    caseNo: "188/KOL/2025",
    lastUpdate: "Conciliation ended; Statement of Claim filed 19.01.2026.",
  },
  {
    match: "veehi",
    status: "MSEFC arbitration",
    forum: "WBMSEFC",
    caseNo: "213/2024",
    filingDate: "2024-08-17",
    lastUpdate: "Respondent absent; petition filed for arbitration. Dues per Laser Legal mail 26 Aug 2026: Rs 5,81,291.",
  },
  {
    match: "gujarat water supply",
    status: "Closed",
    forum: "TS-226/2025, Howrah Court",
    caseNo: null, // closure not confirmed, so the suit number is not seeded as fact either
    lastUpdate: "Resolved (Aug 2025), suit not pursued. Closure awaits Legal's confirmation; reopen the status if it is still live.",
  },
];

async function main() {
  console.log(`\n=== SEED LEGAL CASES [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);
  const debtors = await prisma.debtor.findMany({ distinct: ["accCode"], select: { accCode: true, accName: true } });
  const unmatched: string[] = [];
  for (const s of SEEDS) {
    const hits = debtors.filter((d) => d.accName?.toLowerCase().includes(s.match));
    if (hits.length !== 1) {
      const why = hits.length ? `ambiguous: ${hits.map((h) => `${h.accCode} ${h.accName}`).join(" | ")}` : "no debtor row";
      unmatched.push(`${s.match} (${why})`);
      console.log(`SKIP   "${s.match}": ${why}`);
      continue;
    }
    const { accCode, accName } = hits[0];
    const existing = await prisma.partyLegalCase.findUnique({ where: { ledger_accCode: { ledger: "debtor", accCode } } });
    if (existing) {
      console.log(`EXISTS ${accCode} ${accName}: left unchanged`);
      continue;
    }
    console.log(`${APPLY ? "WRITE " : "WOULD "} ${accCode} ${accName}: ${s.status}, case no ${s.caseNo ?? "<blank>"}`);
    if (!APPLY) continue;
    const row = await prisma.partyLegalCase.create({
      data: { ledger: "debtor", accCode, status: s.status, forum: s.forum, caseNo: s.caseNo, filingDate: s.filingDate ? new Date(`${s.filingDate}T00:00:00.000Z`) : null, lastUpdate: s.lastUpdate },
    });
    await prisma.partyLegalCaseLog.create({ data: { caseId: row.id, field: "seeded", oldValue: null, newValue: s.status, changedById: "seed-legal-cases" } });
  }
  if (unmatched.length) console.log(`\nNOT MATCHED (${unmatched.length}): ${unmatched.join("; ")}`);
  if (!APPLY) console.log("\ndry run: nothing written. Re-run with --apply.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
