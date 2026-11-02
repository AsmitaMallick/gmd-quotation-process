import { VALIDITY_OPTIONS } from "@/lib/pbg/validity";

/** Reminder gate values shown in the Mail Trigger column. */
export const MAIL_TRIGGER_OPTIONS = ["HOLD", "CONTINUE"];

export type ColumnType =
  | "text"
  | "select"
  | "date"
  | "number"
  | "files"
  | "links";

export type ColumnKey =
  | "clientName"
  | "project"
  | "poNumber"
  | "poDate"
  | "bgNo"
  | "bgDate"
  | "bgAmtFc"
  | "expiryDate"
  | "claimDate"
  | "marginPct"
  | "marginAmount"
  | "contactPerson"
  | "contactNumber"
  | "remark"
  | "status"
  | "mailTrigger"
  | "bankGuarantee"
  | "orderList"
  | "validityOn"
  | "lastSupplyDate"
  | "extendedValidity";

export type FilterKind = "text" | "multiselect";

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  type: ColumnType;
  align?: "left" | "right";
  width: number;
  /** How the header filter behaves. Defaults to "text" for text, "multiselect" for select. */
  filter?: FilterKind;
  /** Suggested values for a text column (rendered as an editable combobox). */
  options?: string[];
  /** Derived/user-owned value that is never written back to the database. */
  readonly?: boolean;
};

export const PBG_COLUMN_DEFS: ColumnDef[] = [
  { key: "clientName", label: "Client Name", type: "text", width: 220, filter: "multiselect" },
  { key: "project", label: "Project", type: "text", width: 150, filter: "multiselect" },
  { key: "poNumber", label: "PO Number", type: "text", width: 190, readonly: true },
  { key: "poDate", label: "PO Date", type: "date", width: 115, readonly: true },
  { key: "bgNo", label: "BG No", type: "text", width: 160 },
  {
    key: "mailTrigger",
    label: "Mail Trigger",
    type: "select",
    width: 130,
    filter: "multiselect",
    options: MAIL_TRIGGER_OPTIONS,
  },
  { key: "bgDate", label: "BG Date", type: "date", width: 115 },
  { key: "bgAmtFc", label: "BG Amt (₹)", type: "number", align: "right", width: 130 },
  { key: "expiryDate", label: "Expiry Date", type: "date", width: 115 },
  { key: "claimDate", label: "Claim Date", type: "date", width: 115 },
  {
    key: "validityOn",
    label: "Validity as per contract",
    type: "text",
    width: 180,
    options: VALIDITY_OPTIONS,
  },
  { key: "lastSupplyDate", label: "Last Supply Date", type: "date", width: 130, readonly: true },
  { key: "extendedValidity", label: "Validity as per contract (Date Calculation)", type: "date", width: 130, readonly: true },
  { key: "orderList", label: "Order List", type: "links", width: 210, readonly: true },
  { key: "marginPct", label: "Margin %", type: "select", align: "right", width: 95 },
  { key: "marginAmount", label: "Margin Amount", type: "number", align: "right", width: 130 },
  { key: "contactPerson", label: "Contact Person", type: "text", width: 210 },
  { key: "contactNumber", label: "Contact Number", type: "text", width: 160 },
  { key: "remark", label: "Remark", type: "text", width: 300 },
  { key: "bankGuarantee", label: "Bank Guarantee", type: "files", width: 240 },
  { key: "status", label: "Status", type: "select", width: 120 },
];

export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = PBG_COLUMN_DEFS.map(
  (column) => column.key,
);
