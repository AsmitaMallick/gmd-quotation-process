"use server";
import { requireAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { normaliseFollowUp } from "@/lib/ledgerFollowUp";
import type { LedgerFollowUpInput } from "@/lib/ledgerFollowUp";

/** Upserts one follow-up row (party-level when vrNo is blank). Last write wins. */
export async function saveLedgerFollowUpAction(input: LedgerFollowUpInput): Promise<{ success: boolean; error?: string }> {
  await requireAccess();
  const r = normaliseFollowUp(input);
  if ("error" in r) return { success: false, error: r.error };
  try {
    let updatedById: string | null = null;
    try {
      const { auth } = await import("@/auth");
      updatedById = (await auth())?.user?.id ?? null;
    } catch {
      // open local deployment may have no session; the edit is still valid
    }
    const { ledger, accCode, vrNo, ...rest } = r.data;
    await prisma.ledgerFollowUp.upsert({
      where: { ledger_accCode_vrNo: { ledger, accCode, vrNo } },
      create: { ledger, accCode, vrNo, ...rest, updatedById },
      update: { ...rest, updatedById },
    });
    return { success: true };
  } catch (e) {
    console.error("saveLedgerFollowUpAction", e);
    return { success: false, error: "Could not save the follow-up." };
  }
}
