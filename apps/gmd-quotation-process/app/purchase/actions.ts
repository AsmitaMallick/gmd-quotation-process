"use server";
import { requireAccess } from "@/lib/access";
import { loadPurchaseView } from "@gmd/purchase/server";
import type { PurchaseView } from "@gmd/purchase/types";

// The Purchase dashboard is read-only, so there is one action. Access is
// checked here rather than in the package: the package has no notion of this
// app's sessions.

export async function loadView(view: PurchaseView) {
  await requireAccess();
  return loadPurchaseView(view);
}
