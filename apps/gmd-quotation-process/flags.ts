import { flag } from "flags/next";
import type { ContractReviewHeader, SidebarSection } from "@gmd/contract-review/flags";
import type { EditableHeader, PhysicalStockHeader } from "@gmd/physical-stock/columns";
import type { SidebarSection as PhysicalStockSidebarSection } from "@gmd/physical-stock/flags";
import type { PurchaseHeader } from "@gmd/purchase/columns";
import type { SidebarSection as PurchaseSidebarSection } from "@gmd/purchase/flags";

// Feature flags for this app. Each decide() is the single place that knows
// where a value comes from: today a constant in this file; later it can read
// an env var, a database row or a provider without touching anything else.
// Flag keys are the same in every app; only the values differ.

// Quotation shows everything.
export const contractReviewDisabledColumns = flag<ContractReviewHeader[]>({
  key: "contract-review-disabled-columns",
  description: "Contract Review columns removed entirely (table, chips, filters, data, edits)",
  defaultValue: [],
  decide: () => [],
});

export const contractReviewReadOnlyColumns = flag<ContractReviewHeader[]>({
  key: "contract-review-readonly-columns",
  description: "Contract Review columns shown but not editable",
  defaultValue: [],
  decide: () => [],
});

export const contractReviewFlowDiagram = flag<boolean>({
  key: "contract-review-flow-diagram",
  description: "Show the flow diagram above the Contract Review table",
  defaultValue: true,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});

export const contractReviewExcelExport = flag<boolean>({
  key: "contract-review-excel-export",
  description: "Show the Export Excel button on the Contract Review table",
  defaultValue: true,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});

export const contractReviewHiddenSidebar = flag<SidebarSection[]>({
  key: "contract-review-hidden-sidebar",
  description: "Contract Review sidebar blocks to hide",
  defaultValue: [],
  decide: () => [],
});

// Physical Stock: quotation sees every column; BOM ID picker + duplicate-ERP
// highlight on, no "New" button.
export const physicalStockHiddenColumns = flag<PhysicalStockHeader[]>({
  key: "physical-stock-hidden-columns",
  description: "Physical Stock columns not shown in the table",
  defaultValue: [],
  decide: () => [],
});

export const physicalStockEditableColumns = flag<EditableHeader[]>({
  key: "physical-stock-editable-columns",
  description: "Physical Stock columns editable in the UI and on the server",
  defaultValue: [],
  decide: () => [
    "REMARKS",
    "item type",
    "PRICE",
    "MOQ",
    "IF LESS THAN MOQ- EXTRA CHARGES",
    "DRAWING/ TECHNICAL DATA",
    "BOM ID",
    "COST",
    "HEAT NO",
  ],
});

export const physicalStockHiddenSidebar = flag<PhysicalStockSidebarSection[]>({
  key: "physical-stock-hidden-sidebar",
  description: "Physical Stock sidebar blocks to hide",
  defaultValue: [],
  decide: () => [],
});

export const physicalStockNewItem = flag<boolean>({
  key: "physical-stock-new-item",
  description: "Show the New button (auto ERP code) on Physical Stock",
  defaultValue: false,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => false,
});

export const physicalStockDuplicateErpHighlight = flag<boolean>({
  key: "physical-stock-duplicate-erp-highlight",
  description: "Highlight Physical Stock rows sharing an ERP code",
  defaultValue: false,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});

// Purchase: the quotation app shows everything.
export const purchaseDisabledColumns = flag<PurchaseHeader[]>({
  key: "purchase-disabled-columns",
  description: "Purchase columns removed entirely (table, filters, export)",
  defaultValue: [],
  decide: () => [],
});

export const purchaseHiddenSidebar = flag<PurchaseSidebarSection[]>({
  key: "purchase-hidden-sidebar",
  description: "Purchase summary blocks to hide",
  defaultValue: [],
  decide: () => [],
});

export const purchaseExcelExport = flag<boolean>({
  key: "purchase-excel-export",
  description: "Show the Export Excel button on the Purchase table",
  defaultValue: true,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});

export const purchaseOpenOnlyByDefault = flag<boolean>({
  key: "purchase-open-only-by-default",
  description: "Open the Purchase table filtered to lines with material still to come",
  defaultValue: true,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});
