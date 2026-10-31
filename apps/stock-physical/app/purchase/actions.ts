"use server";

import { loadPurchaseView } from "@gmd/purchase/server";
import type { PurchaseView } from "@gmd/purchase/types";
import { getCurrentUser } from "@/lib/auth-helpers";

// Auth is checked here too: proxy.ts does not protect Server Action endpoints.
// The dashboard is read-only, so there is one action.

export async function loadView(view: PurchaseView) {
  if (!(await getCurrentUser())) {
    return { success: false as const, error: "Unauthorized" };
  }
  return loadPurchaseView(view);
}
