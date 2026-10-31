"use server";
import { requireAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { diffLegalCase, legalCaseToView, normaliseLegalCase } from "@/lib/legalStatus";
import type { LegalCaseInput } from "@/lib/legalStatus";

/**
 * Upserts a party's legal case and logs every changed field with the user, in one transaction.
 * shortcut: gated on requireAccess() (admin/developer on a restricted deployment) because there is no Legal role, a `legal` role is the upgrade.
 */
export async function saveLegalCaseAction(input: LegalCaseInput): Promise<{ success: boolean; error?: string }> {
  await requireAccess();
  const r = normaliseLegalCase(input);
  if ("error" in r) return { success: false, error: r.error };
  try {
    let userId: string | null = null;
    try {
      const { auth } = await import("@/auth");
      userId = (await auth())?.user?.id ?? null;
    } catch {
      // open local deployment may have no session; the edit is still valid
    }
    const { ledger, accCode, ...fields } = r.data;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.partyLegalCase.findUnique({ where: { ledger_accCode: { ledger, accCode } } });
      const changes = diffLegalCase(existing ? legalCaseToView(existing) : null, legalCaseToView(fields));
      if (changes.length === 0) return;
      const saved = await tx.partyLegalCase.upsert({
        where: { ledger_accCode: { ledger, accCode } },
        create: { ledger, accCode, ...fields, updatedById: userId },
        update: { ...fields, updatedById: userId },
      });
      await tx.partyLegalCaseLog.createMany({ data: changes.map((c) => ({ ...c, caseId: saved.id, changedById: userId })) });
    });
    return { success: true };
  } catch (e) {
    console.error("saveLegalCaseAction", e);
    return { success: false, error: "Could not save the legal details." };
  }
}
