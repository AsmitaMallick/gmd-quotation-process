import type { PurchaseRow } from "./columns";

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

/** What the table asks the server for. All fields optional: an empty view is "everything". */
export interface PurchaseView {
  search?: string;
  /** Only lines with material still to come. */
  openOnly?: boolean;
  /** Exact `SALES_CONT`. */
  salesContract?: string;
  /** Exact ERP item code. */
  itemCode?: string;
  /** Exact supplier name. */
  supplierName?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchaseSummary {
  /** Lines matching the current view. */
  lineCount: number;
  /** Of those, how many still have material to come. */
  openLineCount: number;
  /** Summed in-transit quantity. Units are mixed across items; see `inTransitByItem`. */
  inTransitQty: number;
  /** Summed `BASIC_AMT` of the open lines. */
  inTransitValue: number;
  /** Open lines carrying no `SALES_CONT`. */
  untaggedLineCount: number;
  /** Open lines whose BALANCE disagrees with ordered - received. */
  disagreeingLineCount: number;
  /** Distinct sales contracts with material on the way. */
  contractCount: number;
}

export interface PurchasePage {
  rows: PurchaseRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: PurchaseSummary;
  /** When the sync last wrote. Drives the stale banner. */
  syncedAt: string | null;
}

/** The server actions a host app passes in. Each app owns auth and flags. */
export interface PurchaseActions {
  loadView: (view: PurchaseView) => Promise<ActionResult<PurchasePage>>;
}
