"use server";

import {
  createPhysicalStock,
  listPhysicalStock,
  updatePhysicalStockField,
} from "@gmd/physical-stock/server";
import { inTransitForItems } from "@gmd/purchase/server";
import { editableFieldsFor } from "@gmd/physical-stock/flags";
import type { NewItemInput } from "@gmd/physical-stock/types";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import { getCurrentUser } from "@/lib/auth-helpers";

// Auth is checked here too: proxy.ts does not protect Server Action endpoints.
// Flags are evaluated again inside every action: the UI hiding a control is
// cosmetic, these checks protect the data. No BOM ID picker here: its options
// need the quotation DB.

async function unauthorized() {
  return (await getCurrentUser()) ? null : { success: false as const, error: "Unauthorized" };
}

export async function load() {
  const denied = await unauthorized();
  if (denied) return denied;
  try {
    const items = await listPhysicalStock();
    // Ordered but not yet received, by ERP code. A failure here must not take
    // the stock page down with it: the column falls back to blank (unknown).
    let inTransit = new Map<string, number>();
    try {
      inTransit = await inTransitForItems(items.map((i) => (i.erp_code ?? "").trim()));
    } catch (err) {
      console.error("[physical-stock] in-transit lookup failed", err);
    }
    return {
      success: true as const,
      data: {
        items: items.map((item) => ({
          ...item,
          in_transit: inTransit.get((item.erp_code ?? "").trim()) ?? null,
        })),
      },
    };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateField(id: string, field: string, value: string | null) {
  const denied = await unauthorized();
  if (denied) return denied;
  return updatePhysicalStockField(id, field, value, editableFieldsFor(await getPhysicalStockFlags()));
}

export async function create(input: NewItemInput) {
  const denied = await unauthorized();
  if (denied) return denied;
  if (!(await getPhysicalStockFlags()).newItem) {
    return { success: false as const, error: "Not allowed in this app." };
  }
  return createPhysicalStock(input);
}
