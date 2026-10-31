import { flag } from "flags/next";
import type { EditableHeader, PhysicalStockHeader } from "@gmd/physical-stock/columns";
import type { SidebarSection } from "@gmd/physical-stock/flags";

// Feature flags for this app. Each decide() is the single place that knows
// where a value comes from: today a constant in this file; later it can read
// an env var, a database row or a provider without touching anything else.
// Flag keys are the same in every app; only the values differ.

// Stock-physical: store view. Pricing / BOM / planning columns hidden, qty
// entry + "New" item on, no BOM ID picker.
export const physicalStockHiddenColumns = flag<PhysicalStockHeader[]>({
  key: "physical-stock-hidden-columns",
  description: "Physical Stock columns not shown in the table",
  defaultValue: [],
  decide: () => [
    "sum of PHYSICAL stock",
    "stock as per erp",
    "item wise-value",
    "MOVING WITHIN 3 MONTHS",
    "Order Ag Approval recvd",
    "PURCHASE IN 26-27",
    "dispatched in 26-27",
    "ORDER IN hand QTY",
    "shortage qty",
    "item type",
    "PRICE",
    "MOQ",
    "IF LESS THAN MOQ- EXTRA CHARGES",
    "DRAWING/ TECHNICAL DATA",
    "COST",
    "BOM ID",
  ],
});

export const physicalStockEditableColumns = flag<EditableHeader[]>({
  key: "physical-stock-editable-columns",
  description: "Physical Stock columns editable in the UI and on the server",
  defaultValue: [],
  // Blank ERP CODE and the L/Dia dropdowns are added for admin/developer in
  // lib/physical-stock-flags.ts.
  decide: () => ["DISPATCH QTY.", "REMARKS", "HEAT NO"],
});

export const physicalStockHiddenSidebar = flag<SidebarSection[]>({
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
  decide: () => true,
});

export const physicalStockDuplicateErpHighlight = flag<boolean>({
  key: "physical-stock-duplicate-erp-highlight",
  description: "Highlight Physical Stock rows sharing an ERP code",
  defaultValue: false,
  options: [{ value: true, label: "On" }, { value: false, label: "Off" }],
  decide: () => true,
});
  