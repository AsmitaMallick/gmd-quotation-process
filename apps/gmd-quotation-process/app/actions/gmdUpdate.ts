"use server";
import { requireAccess } from "@/lib/access";
import { sendOpenItemsAction } from "./misc";
import { ERP_CLOSED_STATUSES } from "@/lib/erpItemStatus";
import { columnAccess } from "@gmd/contract-review/flags";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prisma } from "@/lib/prisma";
import { normalizeActuatorPart } from "@/lib/verifyBomLookup";
import { buildDerivedItemName } from "@/lib/gmd_lib/derived-item-name";
import { getUsdInrRate } from "@/lib/gmd_lib/exchangeRate";
import { planSupplierRateUpload, vendorReferenceOf, type SupplierRate } from "@/lib/supplierRateUpload";
import { withHardcodedL7Options } from "@/lib/gmd_lib/sheet-columns";
import { uploadToS3, deleteFromS3, validateAttachment, buildAttachmentKey } from "@/lib/s3";

export async function setGMDUpdateTransferredAction(
  ids: string[],
  transferred: boolean,
) {
  "use server";
  await requireAccess();
  try {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { success: true, data: { count: 0 } };
    }
    const res = await prisma.rawMaterial.updateMany({
      where: { id: { in: uniqueIds } },
      data: { transferred },
    });
    return { success: true, data: { count: res.count } };
  } catch (error: any) {
    console.error("Error updating GMD transfer status:", error);
    return {
      success: false,
      error: error.message || "Failed to update transfer status.",
    };
  }
}

export async function addTransferredBlankItemsAction(codes: string[]) {
  "use server";
  await requireAccess();
  try {
    const VALID_ERP_CODE = /^[A-Z]{3}[0-9]{6}$/;
    const uniqueCodes = [
      ...new Set(codes.map((c) => c.trim()).filter(Boolean)),
    ];
    const invalid: string[] = [];
    const toCreate: string[] = [];
    for (const code of uniqueCodes) {
      if (!VALID_ERP_CODE.test(code)) {
        invalid.push(code);
        continue;
      }
      const existing = await prisma.rawMaterial.findFirst({
        where: { erpItemCode: code, transferred: true },
        select: { id: true },
      });
      if (existing) continue;
      toCreate.push(code);
    }
    const created: { code: string; id: string }[] = [];
    for (const code of toCreate) {
      const row = await prisma.rawMaterial.create({
        data: { erpItemCode: code, transferred: true },
        select: { id: true },
      });
      created.push({ code, id: row.id });
    }
    return { success: true, data: { created, invalid } };
  } catch (error: any) {
    console.error("Error adding transferred blank items:", error);
    return {
      success: false,
      error: error.message || "Failed to add items.",
    };
  }
}

export async function transferFilteredByCodeAction(code: string) {
  "use server";
  await requireAccess();
  try {
    const trimmed = (code ?? "").trim();
    if (!trimmed) return { success: true, data: { id: null } };
    const target = await prisma.rawMaterial.findFirst({
      where: {
        erpItemCode: trimmed,
        transferred: false,
        newItemStatus: { not: null },
        NOT: [{ newItemStatus: "-" }, { newItemStatus: "Updated" }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!target) return { success: true, data: { id: null } };
    await prisma.rawMaterial.update({
      where: { id: target.id },
      data: { transferred: true },
    });
    return { success: true, data: { id: target.id } };
  } catch (error: any) {
    console.error("Error transferring filtered item by code:", error);
    return {
      success: false,
      error: error.message || "Failed to transfer item.",
    };
  }
}

export async function importTransferredExcelAction(
  rows: { erpItemCode: string; values: Record<string, string> }[],
) {
  "use server";
  await requireAccess();
  try {
    const updated: { id: string; code: string }[] = [];
    let skipped = 0;
    for (const row of rows) {
      const code = (row.erpItemCode ?? "").trim();
      if (!code) {
        skipped++;
        continue;
      }
      const values: Record<string, string> = {};
      for (const [field, v] of Object.entries(row.values ?? {})) {
        const s = String(v ?? "").trim();
        if (s !== "") values[field] = s;
      }
      const existing = await prisma.rawMaterial.findFirst({
        where: { erpItemCode: code, transferred: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!existing) {
        skipped++;
        continue;
      }
      await prisma.rawMaterial.update({
        where: { id: existing.id },
        data: { ...values, transferred: true },
      });
      updated.push({ id: existing.id, code });
    }
    return { success: true, data: { updated, skipped } };
  } catch (error: any) {
    console.error("Error importing transferred Excel:", error);
    return {
      success: false,
      error: error.message || "Failed to import Excel.",
    };
  }
}

export async function uploadGMDUpdateAttachmentAction(
  id: string,
  file: File,
) {
  "use server";
  await requireAccess();
  try {
    if (!id) {
      return { success: false, error: "Missing item id." };
    }
    validateAttachment(file);
    const existing = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { erpItemCode: true, attachmentUrl: true },
    });
    if (!existing) {
      return { success: false, error: "Item not found." };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const key = buildAttachmentKey(id, existing.erpItemCode, file.name);
    const attachmentUrl = await uploadToS3({
      key,
      body: bytes,
      contentType: file.type,
    });
    if (existing.attachmentUrl) {
      await deleteFromS3(existing.attachmentUrl);
    }
    await prisma.rawMaterial.update({
      where: { id },
      data: { attachmentUrl },
    });
    return { success: true, data: { id, attachmentUrl } };
  } catch (error: any) {
    console.error("Error uploading GMD attachment:", error);
    return {
      success: false,
      error: error.message || "Failed to upload attachment.",
    };
  }
}

export async function clearGMDUpdateAttachmentAction(id: string) {
  "use server";
  await requireAccess();
  try {
    if (!id) {
      return { success: false, error: "Missing item id." };
    }
    const existing = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { attachmentUrl: true },
    });
    if (!existing) {
      return { success: false, error: "Item not found." };
    }
    if (existing.attachmentUrl) {
      await deleteFromS3(existing.attachmentUrl);
    }
    await prisma.rawMaterial.update({
      where: { id },
      data: { attachmentUrl: null },
    });
    return { success: true, data: { id, attachmentUrl: null } };
  } catch (error: any) {
    console.error("Error clearing GMD attachment:", error);
    return {
      success: false,
      error: error.message || "Failed to clear attachment.",
    };
  }
}


export async function deleteGMDUpdateTransferredAction(id: string) {
  "use server";
  await requireAccess();
  try {
    if (!id) {
      return { success: false, error: "Missing item id." };
    }
    const existing = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { transferred: true, attachmentUrl: true, erpItemCode: true },
    });
    if (!existing) {
      return { success: false, error: "Item not found." };
    }
    if (!existing.transferred) {
      return { success: false, error: "Only transferred items can be deleted." };
    }
    if (existing.attachmentUrl) {
      try {
        await deleteFromS3(existing.attachmentUrl);
      } catch (e) {
        console.warn("[deleteGMDUpdateTransferred] S3 delete failed, continuing:", e);
      }
    }
    await prisma.rawMaterial.delete({ where: { id } });
    console.log(`[Server] Deleted transferred item id=${id} code=${existing.erpItemCode ?? ""}`);
    return { success: true, data: { id } };
  } catch (error: any) {
    console.error("Error deleting transferred item:", error);
    return {
      success: false,
      error: error.message || "Failed to delete item.",
    };
  }
}

export interface TransferCostMatchProposal {
  transferredRowId: string;
  transferredErpCode: string;
  cost: number;
  tuple: {
    l1: string;
    l2ValveType: string;
    l3Dia: string;
    l7Dimension: string;
    l4Component: string;
    l5Material: string;
    l6Std: string;
    l8ItemCategory: string;
  };
  matchedNewItems: { id: string; erpItemCode: string; indianImported: string }[];
  targetIds: string[];
}

interface LMatchRow {
  l1: string | null;
  l2ValveType: string | null;
  l3Dia: string | null;
  l7Dimension: string | null;
  l4Component: string | null;
  l5Material: string | null;
  l6Std: string | null;
  l8ItemCategory: string | null;
}

function lMatchKey(r: LMatchRow): string {
  return [
    r.l1,
    r.l2ValveType,
    r.l3Dia,
    r.l7Dimension,
    r.l4Component,
    r.l5Material,
    r.l6Std,
    r.l8ItemCategory,
  ]
    .map((v) => (v ?? "").trim().toLowerCase())
    .join("\u0001");
}

function lTupleComplete(r: LMatchRow): boolean {
  return [
    r.l1,
    r.l2ValveType,
    r.l3Dia,
    r.l7Dimension,
    r.l4Component,
    r.l5Material,
    r.l6Std,
    r.l8ItemCategory,
  ].every((v) => (v ?? "").trim() !== "");
}

const GMD_L_MATCH_SELECT = {
  l1: true,
  l2ValveType: true,
  l3Dia: true,
  l7Dimension: true,
  l4Component: true,
  l5Material: true,
  l6Std: true,
  l8ItemCategory: true,
} as const;

export async function getTransferCostMatchProposalsAction() {
  "use server";
  await requireAccess();
  try {
    const transferred = await prisma.rawMaterial.findMany({
      where: { transferred: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        erpItemCode: true,
        cost: true,
        indianImported: true,
        ...GMD_L_MATCH_SELECT,
      },
    });
    const newItems = await prisma.rawMaterial.findMany({
      where: {
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: {
        id: true,
        erpItemCode: true,
        indianImported: true,
        ...GMD_L_MATCH_SELECT,
      },
    });

    const byKey = new Map<string, typeof newItems>();
    for (const ni of newItems) {
      if (!lTupleComplete(ni)) continue;
      const key = lMatchKey(ni);
      const arr = byKey.get(key) ?? [];
      arr.push(ni);
      byKey.set(key, arr);
    }

    const proposals: TransferCostMatchProposal[] = [];
    for (const tr of transferred) {
      if (!lTupleComplete(tr)) continue;
      const cost = Number(tr.cost ?? 0);
      if (!cost) continue;
      const matches = byKey.get(lMatchKey(tr)) ?? [];
      if (matches.length === 0) continue;

      const matchedNewItems = matches.map((m) => ({
        id: m.id,
        erpItemCode: m.erpItemCode ?? "",
        indianImported: m.indianImported ?? "",
      }));

      let targetIds: string[];
      if (matches.length === 1) {
        targetIds = [matches[0].id];
      } else {
        targetIds = matches
          .filter((m) => (m.indianImported ?? "").trim().toLowerCase() === "indian")
          .map((m) => m.id);
        if (targetIds.length === 0) continue;
      }

      proposals.push({
        transferredRowId: tr.id,
        transferredErpCode: tr.erpItemCode ?? "",
        cost,
        tuple: {
          l1: tr.l1 ?? "",
          l2ValveType: tr.l2ValveType ?? "",
          l3Dia: tr.l3Dia ?? "",
          l7Dimension: tr.l7Dimension ?? "",
          l4Component: tr.l4Component ?? "",
          l5Material: tr.l5Material ?? "",
          l6Std: tr.l6Std ?? "",
          l8ItemCategory: tr.l8ItemCategory ?? "",
        },
        matchedNewItems,
        targetIds,
      });
    }

    console.log(
      `[MATCH] Scan complete: ${proposals.length} candidate proposal(s) out of ${transferred.length} transferred row(s).`,
    );
    return { success: true, data: { proposals, total: proposals.length } };
  } catch (error: any) {
    console.error("Error scanning transfer cost matches:", error);
    return {
      success: false,
      error: error.message || "Failed to scan matches.",
    };
  }
}

export async function applyTransferCostMatchAction(transferredRowId: string) {
  "use server";
  await requireAccess();
  try {
    if (!transferredRowId) {
      return { success: false, error: "Missing item id." };
    }
    const tr = await prisma.rawMaterial.findUnique({
      where: { id: transferredRowId },
      select: {
        id: true,
        transferred: true,
        erpItemCode: true,
        cost: true,
        indianImported: true,
        ...GMD_L_MATCH_SELECT,
      },
    });
    if (!tr) {
      return { success: false, error: "Transferred row not found." };
    }
    if (!tr.transferred) {
      return { success: false, error: "Row is no longer transferred." };
    }
    if (!lTupleComplete(tr)) {
      return { success: false, error: "L1-L8 are not complete on this row." };
    }
    const cost = Number(tr.cost ?? 0);
    if (!cost) {
      return { success: false, error: "Row has no cost to apply." };
    }

    const newItems = await prisma.rawMaterial.findMany({
      where: {
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: { id: true, indianImported: true, ...GMD_L_MATCH_SELECT },
    });
    const key = lMatchKey(tr);
    const matches = newItems.filter(
      (ni) => lTupleComplete(ni) && lMatchKey(ni) === key,
    );
    if (matches.length === 0) {
      return { success: false, error: "No matching New Items found." };
    }

    let targetIds: string[];
    if (matches.length === 1) {
      targetIds = [matches[0].id];
    } else {
      targetIds = matches
        .filter((m) => (m.indianImported ?? "").trim().toLowerCase() === "indian")
        .map((m) => m.id);
      if (targetIds.length === 0) {
        return {
          success: false,
          error: "Multiple matches exist but none are Indian â€” skipped.",
        };
      }
    }

    await prisma.rawMaterial.updateMany({
      where: { id: { in: targetIds } },
      data: { cost },
    });
    await prisma.rawMaterial.update({
      where: { id: transferredRowId },
      data: {
        transferred: false,
        l1: null,
        l2ValveType: null,
        l3Dia: null,
        l7Dimension: null,
        l4Component: null,
        l5Material: null,
        l6Std: null,
        l8ItemCategory: null,
      },
    });

    console.log(
      `[MATCH] Applied cost â‚¹${cost} from transferred ${tr.erpItemCode ?? tr.id} to ${targetIds.length} new item(s) (${targetIds.join(", ")}); row moved out of Transferred.`,
    );

    return {
      success: true,
      data: { transferredRowId, updatedNewItemIds: targetIds, cost },
    };
  } catch (error: any) {
    console.error("Error applying transfer cost match:", error);
    return {
      success: false,
      error: error.message || "Failed to apply cost match.",
    };
  }
}

export async function getTradingValveOptionsAction() {
  "use server";
  await requireAccess();
  try {
    const rows = await prisma.rawMaterial.findMany({
      where: {
        l8ItemCategory: {
          contains: "TRADING VALVE",
          mode: "insensitive",
        },
      },
      select: {
        l1: true,
        l2ValveType: true,
        l3Dia: true,
        l7Dimension: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
      },
    });
    const collect = (vals: (string | null)[]): string[] =>
      [...new Set(vals.map((v) => (v ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, undefined, { numeric: true }),
      );
    return {
      success: true,
      data: withHardcodedL7Options({
        L1: collect(rows.map((r) => r.l1)),
        "L2-VALVE TYPE": collect(rows.map((r) => r.l2ValveType)),
        "L3-DIA": collect(rows.map((r) => r.l3Dia)),
        "L7-DIMENSION": collect(rows.map((r) => r.l7Dimension)),
        "L4-COMPONENT": collect(rows.map((r) => r.l4Component)),
        "L5- MATERIAL": collect(rows.map((r) => r.l5Material)),
        "L6-STD": collect(rows.map((r) => r.l6Std)),
      }),
    };
  } catch (error: any) {
    console.error("Error fetching trading valve options:", error);
    return {
      success: false,
      error: error.message || "Failed to fetch trading valve options.",
    };
  }
}

export async function getActuatorOptionsAction() {
  "use server";
  await requireAccess();
  try {
    const rows = await prisma.rawMaterial.findMany({
      where: {
        l8ItemCategory: { contains: "ACTUATORS", mode: "insensitive" },
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: {
        l7Dimension: true,
        l6Std: true,
      },
    });
    const set = new Set<string>();
    for (const r of rows) {
      const l7 = (r.l7Dimension ?? "").trim();
      const l6 = (r.l6Std ?? "").trim();
      if (!l7 || !l6) continue;
      set.add(`${normalizeActuatorPart(l7)}@${normalizeActuatorPart(l6)}`);
    }
    const data = [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    return { success: true, data };
  } catch (error: unknown) {
    console.error("Error fetching actuator options:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch actuator options.",
    };
  }
}

export async function saveActuatorWithRmCodeAction(
  id: string,
  actuator: string | null,
) {
  "use server";
  await requireAccess();
  if (!columnAccess(await getContractReviewFlags()).isEditable("Actuator")) {
    return { success: false, error: "Not allowed in this app." };
  }
  try {
    const value = actuator?.trim() || null;
    if (!value) {
      await tenderPrisma.contractReview.update({
        where: { id },
        data: { actuator: null, rmCodeForActuator: null },
      });
      return {
        success: true,
        data: { id, actuator: null, rmCodeForActuator: null },
      };
    }
    const [aRaw, bRaw] = value.split("@");
    const a = normalizeActuatorPart(aRaw ?? "");
    const b = normalizeActuatorPart(bRaw ?? "");
    if (!a || !b) {
      return {
        success: false,
        error: "Invalid actuator format. Expected L7@L6.",
      };
    }
    const rows = await prisma.rawMaterial.findMany({
      where: {
        l8ItemCategory: { contains: "ACTUATORS", mode: "insensitive" },
        transferred: false,
        OR: [
          { newItemStatus: null },
          { newItemStatus: "" },
          { newItemStatus: "-" },
          { newItemStatus: "Updated" },
        ],
      },
      select: {
        erpItemCode: true,
        l7Dimension: true,
        l6Std: true,
      },
    });
    const codes = new Set<string>();
    for (const r of rows) {
      const l7 = normalizeActuatorPart(r.l7Dimension ?? "");
      const l6 = normalizeActuatorPart(r.l6Std ?? "");
      if (!l7 || !l6) continue;
      if (l7 === a && l6 === b) {
        const code = (r.erpItemCode ?? "").trim();
        if (code) codes.add(code);
      }
    }
    const rmCodeForActuator = [...codes].join(",");
    await tenderPrisma.contractReview.update({
      where: { id },
      data: { actuator: value, rmCodeForActuator },
    });
    return {
      success: true,
      data: { id, actuator: value, rmCodeForActuator },
    };
  } catch (error: unknown) {
    console.error("Error saving actuator with RM codes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save actuator.",
    };
  }
}

/** L-fields whose change affects the derived item name. */
const DERIVED_SOURCE_FIELDS = new Set([
  "l2ValveType",
  "l3Dia",
  "l4Component",
  "l5Material",
  "l6Std",
  "l7Dimension",
  "l8ItemCategory",
]);

export async function updateGMDUpdateFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  await requireAccess();
  const data: Record<string, unknown> =
    field === "cost"
      ? { [field]: value == null || value.trim() === "" ? null : value }
      : { [field]: value };

  // Keep the derived name in step with the L-fields it is built from.
  if (DERIVED_SOURCE_FIELDS.has(field)) {
    const current = await prisma.rawMaterial.findUnique({
      where: { id },
      select: {
        l8ItemCategory: true,
        l2ValveType: true,
        l3Dia: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
        l7Dimension: true,
      },
    });
    if (current) {
      data.itemNameDerived =
        buildDerivedItemName({ ...current, [field]: value }) || null;
    }
  }

  const updated = await prisma.rawMaterial.update({
    where: { id },
    data,
  });
  return {
    id,
    field,
    value,
    itemNameDerived: updated.itemNameDerived,
  };
}

/** NEW ITEM STATUS values that place a row in the "New Items" table. */
const NEW_ITEM_STATUS_VALUES = new Set(["", "-", "UPDATED"]);

function isNewItemsStatus(value: string | null): boolean {
  return NEW_ITEM_STATUS_VALUES.has((value ?? "").trim().toUpperCase());
}

/**
 * Sets NEW ITEM STATUS but, when the new value would move a row up into the
 * "New Items" table and the row's ITEM NAME (proposed)-AUTO already exists on a
 * New Item, it instead copies this row's cost onto that/those New Item(s) and
 * flags this row `costMerged` so it stays in Filtered (blank status) rather
 * than duplicating the New Item.
 */
export async function setNewItemStatusWithCostMergeAction(
  id: string,
  value: string | null,
) {
  "use server";
  await requireAccess();
  const stored = value == null || value.trim() === "" ? null : value;

  // A closed row moving back to blank is a reopen — notify n8n after the write.
  const before = await prisma.rawMaterial.findUnique({
    where: { id },
    select: { erpItemCode: true, newItemStatus: true },
  });
  const reopened =
    stored === null &&
    ERP_CLOSED_STATUSES.has((before?.newItemStatus ?? "").trim().toUpperCase());
  const notifyReopened = async () => {
    if (reopened && before?.erpItemCode) {
      await sendOpenItemsAction(before.erpItemCode);
    }
  };

  const empty = {
    merged: false,
    noCost: false,
    sourceId: id,
    newItemStatus: stored,
    targetIds: [] as string[],
    cost: null as number | null,
  };

  // Any value that keeps the row in Filtered is a plain write.
  if (!isNewItemsStatus(stored)) {
    await prisma.rawMaterial.update({
      where: { id },
      data: { newItemStatus: stored },
    });
    return { success: true, data: empty };
  }

  const source = await prisma.rawMaterial.findUnique({
    where: { id },
    select: { itemNameAuto: true, cost: true },
  });
  if (!source) return { success: false, error: "Item not found." };

  const name = (source.itemNameAuto ?? "").trim();
  const targets = name
    ? await prisma.rawMaterial.findMany({
        where: {
          id: { not: id },
          transferred: false,
          costMerged: false,
          OR: [
            { newItemStatus: null },
            { newItemStatus: "" },
            { newItemStatus: "-" },
            { newItemStatus: "Updated" },
          ],
          itemNameAuto: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      })
    : [];

  if (targets.length === 0) {
    await prisma.rawMaterial.update({
      where: { id },
      data: { newItemStatus: stored },
    });
    await notifyReopened();
    return { success: true, data: empty };
  }

  const targetIds = targets.map((t) => t.id);
  const sourceCost = source.cost == null ? null : Number(source.cost);
  const hasCost = sourceCost != null && sourceCost !== 0;

  await prisma.$transaction([
    ...(hasCost
      ? [
          prisma.rawMaterial.updateMany({
            where: { id: { in: targetIds } },
            data: { cost: sourceCost },
          }),
        ]
      : []),
    prisma.rawMaterial.update({
      where: { id },
      data: { newItemStatus: stored, costMerged: true },
    }),
  ]);

  await notifyReopened();

  return {
    success: true,
    data: {
      merged: true,
      noCost: !hasCost,
      sourceId: id,
      newItemStatus: stored,
      targetIds,
      cost: hasCost ? sourceCost : null,
    },
  };
}

export async function updateDerivedItemName(itemCode: string) {
  "use server";
  await requireAccess();
  try {
    const item = await prisma.rawMaterial.findFirst({
      where: { erpItemCode: itemCode },
    });
    if (!item) return { success: false, error: "Item not found." };

    const itemNameDerived = buildDerivedItemName(item) || null;
    await prisma.rawMaterial.update({
      where: { id: item.id },
      data: { itemNameDerived },
    });

    return { success: true, data: { itemCode, itemNameDerived } };
  } catch (error: any) {
    console.error("Error updating derived item name:", error);
    return {
      success: false,
      error: error.message || "Failed to update derived item name.",
    };
  }
}

export async function getUsdInrRateAction(refresh = false) {
  "use server";
  await requireAccess();
  try {
    const { rate, source, fetchedAt } = await getUsdInrRate(refresh);
    return { success: true, data: { rate, source, fetchedAt } };
  } catch (error: any) {
    console.error("Error fetching USD/INR rate:", error);
    return { success: false, error: error.message || "Failed to fetch USD/INR rate." };
  }
}

export async function updateGMDUsdCostAction(id: string, usdCost: string | null) {
  "use server";
  await requireAccess();
  try {
    const trimmed = usdCost?.trim() ?? "";
    if (!trimmed) {
      const existing = await prisma.rawMaterial.findUnique({
        where: { id },
        select: { cost: true },
      });
      await prisma.rawMaterial.update({
        where: { id },
        data: { usdRateOption: null },
      });
      return {
        success: true,
        data: { id, usdCost: null, cost: Number(existing?.cost ?? 0), rate: null, fetchedAt: new Date().toISOString() },
      };
    }
    const usd = parseFloat(trimmed.replace(/,/g, ""));
    if (isNaN(usd) || usd < 0) {
      return { success: false, error: "Invalid USD cost value." };
    }

    const { rate, fetchedAt } = await getUsdInrRate();
    const cost = Number((usd * rate).toFixed(2));

    await prisma.rawMaterial.update({
      where: { id },
      data: { usdRateOption: String(usd), cost },
    });

    return { success: true, data: { id, usdCost: String(usd), cost, rate, fetchedAt } };
  } catch (error: any) {
    console.error("Error updating GMD USD cost:", error);
    return { success: false, error: error.message || "Failed to update USD cost." };
  }
}

export async function selectGMDUpdateBomIdAction(
  id: string,
  bomId: string | null,
) {
  "use server";
  await requireAccess();
  try {
    const item = await prisma.rawMaterial.findUnique({
      where: { id },
      select: { erpItemCode: true },
    });
    if (!item) return { success: false, error: "Item not found." };
    const value = bomId?.trim() || null;

    // RM ↔ BOM now lives in BomItem. Unlink only clears rawMaterialId; rows are
    // never deleted, so a component's quantity/cost/noUse/cBatch survive.
    if (!value) {
      await prisma.bomItem.updateMany({
        where: { rawMaterialId: id },
        data: { rawMaterialId: null, manualLink: false },
      });
      return { success: true, data: { id, bomId: null } };
    }

    const code = (item.erpItemCode ?? "").trim();
    const bom = await prisma.bom.findFirst({
      where: {
        bomId: value,
        ...(code ? { fullItem: { itemCode: code } } : {}),
      },
      select: { id: true },
    });
    if (!bom) {
      return { success: false, error: "Selected BOM ID is not in available options." };
    }

    // Unlink this RM from any other BOM (keeps those rows).
    await prisma.bomItem.updateMany({
      where: { rawMaterialId: id, bomId: { not: bom.id } },
      data: { rawMaterialId: null, manualLink: false },
    });

    // manualLink keeps a hand pick from being unlinked by the hourly BOM MAST sync.
    const linked = await prisma.bomItem.findFirst({
      where: { bomId: bom.id, rawMaterialId: id },
      select: { id: true },
    });
    if (linked) {
      await prisma.bomItem.update({
        where: { id: linked.id },
        data: { manualLink: true },
      });
    } else {
      // Reuse a freed row for this BOM (preserves its data), else create.
      const free = await prisma.bomItem.findFirst({
        where: { bomId: bom.id, rawMaterialId: null, fullItemId: null },
        select: { id: true },
      });
      if (free) {
        await prisma.bomItem.update({
          where: { id: free.id },
          data: { rawMaterialId: id, manualLink: true },
        });
      } else {
        await prisma.bomItem.create({
          data: { bomId: bom.id, rawMaterialId: id, manualLink: true },
        });
      }
    }
    return { success: true, data: { id, bomId: value } };
  } catch (error: any) {
    console.error("Error selecting GMD BOM ID:", error);
    return { success: false, error: error.message || "Failed to select BOM ID." };
  }
}

export async function uploadSupplierRatesAction(rows: SupplierRate[]) {
  "use server";
  await requireAccess();
  try {
    const rates = rows.filter(
      (r) => typeof r?.erpItemCode === "string" && Number.isFinite(r.rateUsd) && r.rateUsd >= 0,
    );
    const existing = await prisma.rawMaterial.findMany({
      where: { erpItemCode: { in: rates.map((r) => r.erpItemCode) } },
      select: { id: true, erpItemCode: true, usdRateOption: true, cost: true, vendorReference: true, l8ItemCategory: true },
    });
    const byCode = new Map(existing.map((e) => [e.erpItemCode!, e]));
    const plan = planSupplierRateUpload(
      existing.map((e) => ({
        erpItemCode: e.erpItemCode!,
        usd: e.usdRateOption?.trim() ? Number(e.usdRateOption) : null,
        vendorReference: e.vendorReference,
        category: e.l8ItemCategory,
      })),
      rates,
    );

    const { rate } = await getUsdInrRate();
    const { auth } = await import("@/auth");
    const user = (await auth())?.user as { name?: string | null } | undefined;
    const changedBy = user?.name ?? null;
    const inr = (usd: number) => Number((usd * rate).toFixed(2));
    const hist = (r: SupplierRate, oldUsd: number | null, oldCost: number | null) => ({
      erpItemCode: r.erpItemCode,
      oldUsd,
      newUsd: r.rateUsd,
      oldCost,
      newCost: inr(r.rateUsd),
      supplier: r.supplier || null,
      offerNo: r.offerNo || null,
      offerDate: r.offerDate ? new Date(r.offerDate) : null,
      changedBy,
    });

    const updated = plan.updates.map(({ old, next }) => ({
      code: next.erpItemCode,
      oldUsd: old.usd,
      newUsd: next.rateUsd,
      oldCost: byCode.get(next.erpItemCode)!.cost == null ? null : Number(byCode.get(next.erpItemCode)!.cost),
      newCost: inr(next.rateUsd),
    }));
    await prisma.$transaction([
      ...plan.updates.map(({ next }) =>
        prisma.rawMaterial.update({
          where: { id: byCode.get(next.erpItemCode)!.id },
          data: { usdRateOption: String(next.rateUsd), cost: inr(next.rateUsd), vendorReference: vendorReferenceOf(next) },
        }),
      ),
      // Only a valid ERP code absent from the master is created (planner guarantees it); nothing is deleted.
      ...plan.adds.map((r) =>
        prisma.rawMaterial.create({
          data: {
            erpItemCode: r.erpItemCode,
            l8ItemCategory: "TRADING VALVES", // plural, as every existing master row is stored
            // Plural, matching every existing master row; the singular would not
            // match the `contains`/cascade filters used elsewhere.
            l8ItemCategory: "TRADING VALVES",
            usdRateOption: String(r.rateUsd),
            cost: inr(r.rateUsd),
            vendorReference: vendorReferenceOf(r),
          },
        }),
      ),
      prisma.supplierRateHistory.createMany({
        data: [
          ...updated.map((u, i) => hist(plan.updates[i].next, u.oldUsd, u.oldCost)),
          ...plan.adds.map((r) => hist(r, null, null)),
        ],
      }),
    ]);

    return {
      success: true,
      data: {
        rate,
        updated,
        added: plan.adds.map((r) => ({ code: r.erpItemCode, newUsd: r.rateUsd, newCost: inr(r.rateUsd) })),
        notMatched: plan.notMatched.map((n) => ({ code: n.rate.erpItemCode, reason: n.reason })),
        unchanged: plan.unchanged.length,
      },
    };
  } catch (error: any) {
    console.error("Error uploading supplier rates:", error);
    return { success: false, error: error.message || "Failed to upload supplier rates." };
  }
}
