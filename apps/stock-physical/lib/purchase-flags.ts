import "server-only";
import { resolvePurchaseFlags, type PurchaseFlags } from "@gmd/purchase/flags";
import {
  purchaseDisabledColumns,
  purchaseExcelExport,
  purchaseHiddenSidebar,
  purchaseOpenOnlyByDefault,
} from "@/flags";

/** Evaluates this app's Purchase flags for the current request. */
export async function getPurchaseFlags(): Promise<PurchaseFlags> {
  const [disabledColumns, hiddenSidebar, excelExport, openOnlyByDefault] = await Promise.all([
    purchaseDisabledColumns(),
    purchaseHiddenSidebar(),
    purchaseExcelExport(),
    purchaseOpenOnlyByDefault(),
  ]);
  return resolvePurchaseFlags({ disabledColumns, hiddenSidebar, excelExport, openOnlyByDefault });
}
