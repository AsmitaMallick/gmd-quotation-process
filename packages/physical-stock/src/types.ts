export interface PhysicalStockRow {
  id: string;
  /** ISO string; the server converts the DB Date. */
  form_date: string | null;
  erp_code: string | null;
  location: string | null;
  l2_valve_type: string | null;
  dimension: string | null;
  l7_dimension: string | null;
  l4_component: string | null;
  l5_material: string | null;
  l6_std: string | null;
  l8_item_category: string | null;
  received_qty: string | null;
  dispatch_qty: string | null;
  available_qty: string | null;
  remarks: string | null;
  sum_of_physical_stock: string | null;
  stock_as_per_erp: string | null;
  item_wise_value: string | null;
  moving_within_3_months: string | null;
  order_ag_approval_recvd: string | null;
  purchase_in_26_27: string | null;
  dispatched_in_26_27: string | null;
  order_in_hand_qty: string | null;
  shortage_qty: string | null;
  unnamed_aa: string | null;
  item_type: string | null;
  price: string | null;
  moq: string | null;
  if_less_than_moq_extra_charges: string | null;
  drawing_technical_data: string | null;
  cost: string | null;
  bom_id: string | null;
  majorminor_marking: boolean | null;
  heat_no: string | null;
  heat_seq: number | null;
  /** Derived (erp_code-l8_item_category-heat_no-heat_seq); blank without a heat no. */
  serial_no: string | null;
  /**
   * Ordered but not yet received against a GRN, summed over this item's open
   * purchase order lines (`@gmd/purchase`). Not stored on PhysicalStock: the
   * host app's `load()` fills it by ERP code, and leaves it null when it does
   * not read purchase data — blank means "unknown", never "none on the way".
   */
  in_transit: number | null;
}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface PhysicalStockData {
  items: PhysicalStockRow[];
  /** Per-row BOM ID dropdown options; only apps with updateBomId send them. */
  bomIdOptions?: Record<string, string[]>;
}

export const NEW_ITEM_FIELDS = [
  "location",
  "l2_valve_type",
  "dimension",
  "l7_dimension",
  "l4_component",
  "l5_material",
  "l6_std",
  "l8_item_category",
  "received_qty",
  "dispatch_qty",
  "heat_no",
] as const;

export type NewItemInput = Partial<Record<(typeof NEW_ITEM_FIELDS)[number], string>>;

/** Set when editing a blank-ERP row folded it into an existing item (the edited row is deleted). */
export interface MergeInfo {
  erp_code: string;
  received_qty: string | null;
  dispatch_qty: string | null;
  available_qty: string | null;
}

export type FieldUpdate = Partial<PhysicalStockRow> & { merged?: MergeInfo };

/** Server Actions the host app passes in. Optional ones switch features on. */
export interface PhysicalStockActions {
  load: () => Promise<ActionResult<PhysicalStockData>>;
  updateField: (
    id: string,
    field: string,
    value: string | null,
  ) => Promise<ActionResult<FieldUpdate>>;
  create?: (input: NewItemInput) => Promise<ActionResult<{ erp_code: string; merged: boolean }>>;
  updateBomId?: (
    id: string,
    bomId: string | null,
  ) => Promise<ActionResult<Partial<PhysicalStockRow>>>;
}
