import type { PhysicalStockRow } from "./types";

// Plain TS, safe to import from client and server code.

export const COLUMNS = [
  "DATE",
  "ERP CODE",
  "location",
  "L2-VALVE TYPE",
  "Dia",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
  "L7-PN",
  "L8 -ITEM CATEGORY",
  "RECEIVED QTY.",
  "DISPATCH QTY.",
  "AVAILABLE QTY.",
  "REMARKS",
  "sum of PHYSICAL stock",
  "stock as per erp",
  "item wise-value",
  "MOVING WITHIN 3 MONTHS",
  "Order Ag Approval recvd",
  "PURCHASE IN 26-27",
  "dispatched in 26-27",
  "ORDER IN hand QTY",
  "shortage qty",
  "",
  "item type",
  "PRICE",
  "MOQ",
  "IF LESS THAN MOQ- EXTRA CHARGES",
  "DRAWING/ TECHNICAL DATA",
  "COST",
  "BOM ID",
  "MAJOR/MINOR MARKING",
  "HEAT NO",
  "SERIAL NO",
  // Derived from the purchase order lines, not from the stock sheet. Last, so
  // every existing column keeps its index (edits look fields up by index).
  "IN TRANSIT",
] as const;

export type PhysicalStockHeader = (typeof COLUMNS)[number];

// FIELDS[i] is the DB field of COLUMNS[i]: cell edits look the field up by
// column index and rowToArray renders cells in the same order.
export const FIELDS = [
  "form_date",
  "erp_code",
  "location",
  "l2_valve_type",
  "dimension",
  "l4_component",
  "l5_material",
  "l6_std",
  "l7_dimension",
  "l8_item_category",
  "received_qty",
  "dispatch_qty",
  "available_qty",
  "remarks",
  "sum_of_physical_stock",
  "stock_as_per_erp",
  "item_wise_value",
  "moving_within_3_months",
  "order_ag_approval_recvd",
  "purchase_in_26_27",
  "dispatched_in_26_27",
  "order_in_hand_qty",
  "shortage_qty",
  "unnamed_aa",
  "item_type",
  "price",
  "moq",
  "if_less_than_moq_extra_charges",
  "drawing_technical_data",
  "cost",
  "bom_id",
  "majorminor_marking",
  "heat_no",
  "serial_no",
  "in_transit",
] as const satisfies readonly (keyof PhysicalStockRow)[];

export type PhysicalStockField = (typeof FIELDS)[number];

export const fieldOf = (header: string): PhysicalStockField | undefined =>
  FIELDS[COLUMNS.indexOf(header as PhysicalStockHeader)];

export const NUMERIC_COLUMNS: ReadonlySet<string> = new Set([
  "IN TRANSIT",
  "RECEIVED QTY.",
  "DISPATCH QTY.",
  "AVAILABLE QTY.",
  "sum of PHYSICAL stock",
  "stock as per erp",
  "item wise-value",
  "PURCHASE IN 26-27",
  "dispatched in 26-27",
  "ORDER IN hand QTY",
  "shortage qty",
  "",
  "COST",
]);

/**
 * Every column an app may make editable. The set is fixed (not per app): both
 * apps write the same table.
 * "ERP CODE" is only writable while blank; "BOM ID" goes through updateBomId.
 */
export const EDITABLE_CANDIDATES = [
  "ERP CODE",
  "HEAT NO",
  "DISPATCH QTY.",
  "REMARKS",
  "item type",
  "PRICE",
  "MOQ",
  "IF LESS THAN MOQ- EXTRA CHARGES",
  "DRAWING/ TECHNICAL DATA",
  "COST",
  "BOM ID",
  "location",
  "L2-VALVE TYPE",
  "Dia",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
  "L7-PN",
  "L8 -ITEM CATEGORY",
] as const satisfies readonly PhysicalStockHeader[];

export type EditableHeader = (typeof EDITABLE_CANDIDATES)[number];

/**
 * Options for the L / Dia dropdowns, taken from the distinct values in the
 * stock DB (Jan 2026 snapshot). A value outside the list still renders and
 * saves: the table keeps the current cell value as an extra option.
 */
export const DROPDOWN_OPTIONS: Partial<Record<PhysicalStockHeader, readonly string[]>> = {
  "L2-VALVE TYPE": [
    "ACTUATOR",
    "AIR CUSHION VALVE",
    "AIR VALVE",
    "BALL VALVE",
    "BUTTERFLY VALVE",
    "CAPITAL",
    "CHECK VALVE",
    "COMPANION FLANGE",
    "CONSUMABLES",
    "DPCV",
    "FLOAT VALVE",
    "FOOT VALVE",
    "GEAR BOX",
    "GLOBE VALVE",
    "KNIFE GATE VALVE",
    "NEEDLE VALVE",
    "OIL & LUBE",
    "PACKING MATERIAL",
    "PRESSURE REDUCING VALVE",
    "PRINTING & STATIONERY",
    "SLUICE GATE",
    "SLUICE VALVE",
    "SOLENOID VALVE",
    "SPARE",
    "TOOLS & FIXTURES",
    "TPAV",
    "WASTAGE",
  ],
  Dia: [
    "12.5MM",
    "15MM",
    "20MM",
    "25MM",
    "32MM",
    "40MM",
    "50MM",
    "65MM",
    "72MM",
    "80MM",
    "100MM",
    "110MM",
    "125MM",
    "150MM",
    "155MM",
    "190MM",
    "200MM",
    "250MM",
    "300MM",
    "350MM",
    "400MM",
    "450MM",
    "500MM",
    "600MM",
    "700MM",
    "750MM",
    "800MM",
    "900MM",
    "1000MM",
    "1100MM",
    "1200MM",
    "1300MM",
    "1400MM",
    "1500MM",
    "1600MM",
    "1700MM",
    "1800MM",
    "2000MM",
    "2200MM",
    "2300MM",
    "450X300MM",
    "450X450MM",
    "1000X1000MM",
    "F10",
    "F14",
    "1.5KW-2HP",
  ],
  "L4-COMPONENT": [
    "2-PIECE DESIGN LEVER OPERATED SCREWED END",
    "3-PIECE DESIGN LEVER OPERATED FLANGE END",
    "ACTUATOR",
    "AIR WRENCH",
    "ALLEN BOLT",
    "ARALDITE EPOXY ADHESIVE",
    "BEVEL GEAR BOX",
    "BLACK ROD",
    "BLANK BASE",
    "BODY",
    "BODY GASKET",
    "BODY SEAT RING",
    "BONNET",
    "BUBBLE WRAP",
    "BUSH",
    "COMPANION FLANGES",
    "COVER",
    "DALUI MARKING TAPE",
    "DEAD END COVER",
    "DEWATERING SUMERSIBLE PUMP",
    "DISC",
    "DISC SEAT RING",
    "DRIVE STUB",
    "ENAMEL PAINT- BLUE",
    "ENDCAP",
    "EYE BOLT",
    "FLOAT GUIDE",
    "FLOW REGULATION",
    "GASKET",
    "GEAR OP",
    "GLAND",
    "GREASE",
    "GRINDING WHEEL",
    "GRUB SCREW",
    "HANDWASH",
    "HEADSTOCK",
    "HEX BOLT",
    "HEX BOLT & NUT",
    "HW OP",
    "HYDRAULIC OIL",
    "LEVER OP",
    "LIFTING BOLT",
    "LIGHT BBD",
    "LOW PRESSURE SEAT RING",
    "METAL TO METAL",
    "METAL TO RUBBER",
    "MOBIL OIL",
    "MOUNTAIN",
    "NON STD",
    "NOZZLE/NIPPLE",
    "NUT",
    "PTFE SEAT SS 304 BALL LEVER OPERATED",
    "ROD",
    "SEAL RETAINER",
    "SHAFT SEAL KIT",
    "SPINDLE",
    "SPRING",
    "SPRING LOADED",
    "SPUR GEAR BOX",
    "STUD BOLT",
    "TEFLON TAPE",
    "THINNER",
    "THRUST PLATE",
    "WASHER",
    "WEB SEALING BELT",
    "WEDGE",
    "WEDGE NUT",
    "WEDGE SEAT RING",
    "WITH STRAINER",
    "WORM GEAR BOX",
  ],
  "L5- MATERIAL": [
    "BRONZE/BRASS/GUN METAL",
    "CARBON STEEL/CAST STEEL",
    "CAST IRON",
    "DUCTILE IRON",
    "EN-45 (NICKEL PLATED)",
    "EPDM RUBBER",
    "GALVANISED IRON",
    "HIGH SPEED STEEL/HSS",
    "HIGH TENSILE STEEL",
    "JUTE & HEMP",
    "LIQUID SEALANT",
    "MILD STEEL",
    "NATURAL RUBBER",
    "NITRILE RUBBER",
    "PLASTIC",
    "PVC",
    "STAINLESS STEEL",
  ],
  "L6-STD": [
    "3WD44438",
    "AISI 304",
    "AISI 410",
    "CONTROL-DIAPHRAGM TYPE",
    "CONTROL-DIAPHRAGM TYPE-9523",
    "EN-8",
    "FLANGE TYPE",
    "FLANGE TYPE-9523",
    "HSS 6542",
    "IS 1367:CL-4.6",
    "IS:318 GR:LTB-2",
    "KINETIC",
    "LIFT TYPE",
    "LIFT TYPE-9523",
    "NON-RISING",
    "NON-RISING-9523",
    "ORIFICE",
    "RISING",
    "RISING WITH ACT BASE",
    "RISING-9523",
    "SAFETY",
    "SINGLE AIR",
    "SS 304",
    "STD",
    "STD-9523",
    "SWING TYPE",
    "SWING TYPE-9523",
    "WAFER TYPE",
    "WD1000",
    "WD1612Z00",
    "WD1669Z00",
    "WD1690Z00",
    "WD1690Z00F",
    "WD1692Z60",
    "WD1692Z60F",
    "WD1697Z00F",
    "WD1697Z00JXZ",
    "WD27131",
    "WD31374",
    "WD31383",
    "WD9000",
    "WD9200",
    "WD9205",
  ],
  "L8 -ITEM CATEGORY": [
    "ACTUATORS",
    "BOLTS & NUTS",
    "BRONZE ITEMS",
    "CAPITAL",
    "CASTING",
    "FINISHED VALVES",
    "GEAR BOX",
    "MISCELLANEOUS",
    "PACKING MATERIALS",
    "PATTERN",
    "RUBBER ITEMS",
    "SCRAP",
    "SPARES",
    "SS SPARES",
    "TOOLS",
    "TRADING VALVES",
  ],
};

/**
 * Editable only while the cell is blank; overwriting a filled cell is rejected,
 * except on a row whose ERP CODE is blank: there everything but ERP CODE can be
 * changed (and a match with an existing item merges the row, see mergeRows).
 */
export const BLANK_ONLY_HEADERS = [
  "ERP CODE",
  "location",
  "L2-VALVE TYPE",
  "Dia",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
  "L7-PN",
  "L8 -ITEM CATEGORY",
] as const satisfies readonly EditableHeader[];

export function rowToArray(row: PhysicalStockRow): unknown[] {
  // item wise-value is shown from the current cost, which the BOM job refreshes hourly.
  return FIELDS.map((field) =>
    field === "item_wise_value" ? computeItemWiseValue(row.cost, row.available_qty) : row[field] ?? "",
  );
}

function parseNum(value: unknown): number | null {
  const s = String(value ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** `cost (BOM master) * available qty`, two decimals; a blank operand counts as 0. */
export function computeItemWiseValue(cost: unknown, availableQty: unknown): string {
  return ((parseNum(cost) ?? 0) * (parseNum(availableQty) ?? 0)).toFixed(2);
}

// L levels a row's dropdowns cascade on (L7-PN has no fixed list but still narrows the others).
const CASCADE_IDX = (
  ["L2-VALVE TYPE", "Dia", "L4-COMPONENT", "L5- MATERIAL", "L6-STD", "L7-PN", "L8 -ITEM CATEGORY"] as const
).map((h) => COLUMNS.indexOf(h));
const normCell = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Options of L dropdown `header` on `row`: only values that occur in some stock
 * row together with every other L level already filled on `row`. The level
 * being edited never narrows itself; no match (a new combination) gives the full list.
 */
export function cascadedOptions(header: string, row: readonly unknown[], rows: readonly (readonly unknown[])[]): string[] {
  const all = DROPDOWN_OPTIONS[header as PhysicalStockHeader] ?? [];
  const self = COLUMNS.indexOf(header as PhysicalStockHeader);
  const picked = CASCADE_IDX.filter((i) => i !== self && normCell(row[i])).map((i) => [i, normCell(row[i])] as const);
  if (!picked.length) return [...all];
  const seen = new Set<string>();
  for (const r of rows) {
    if (picked.every(([i, v]) => normCell(r[i]) === v)) seen.add(normCell(r[self]));
  }
  const out = all.filter((o) => seen.has(normCell(o)));
  return out.length ? out : [...all];
/** `cost * available qty` (cost comes from the BOM master), two decimals; a blank operand counts as 0. */
export function computeItemWiseValue(cost: unknown, availableQty: unknown): string {
  return ((parseNum(cost) ?? 0) * (parseNum(availableQty) ?? 0)).toFixed(2);
}

/** erp_code-l8_item_category-heat_no-heat_seq; null until the row has a heat no and number. */
export function buildSerial(r: {
  erp_code?: string | null;
  l8_item_category?: string | null;
  heat_no?: string | null;
  heat_seq?: number | null;
}): string | null {
  if (!r.heat_no || r.heat_seq == null) return null;
  return [r.erp_code, r.l8_item_category, r.heat_no, r.heat_seq].map((v) => String(v ?? "").trim()).join("-");
}

/** Codes minted by createPhysicalStock: 3 letters + 6 digits. */
export const isGeneratedErpCode = (code: string | null | undefined): boolean =>
  /^[A-Z]{3}\d{6}$/.test((code ?? "").trim());

/** Identity of a new item: location + the L columns, case/space-insensitive. */
export function itemKey(r: Partial<Record<PhysicalStockField, unknown>>): string {
  return (
    ["location", "l2_valve_type", "dimension", "l7_dimension", "l4_component", "l5_material", "l6_std", "l8_item_category"] as const
  )
    .map((f) => String(r[f] ?? "").trim().replace(/\s+/g, " ").toUpperCase())
    .join("|");
}

/** a + b as a string; null only when both are blank. */
export function addQty(a: unknown, b: unknown): string | null {
  const x = parseNum(a);
  const y = parseNum(b);
  return x === null && y === null ? null : String((x ?? 0) + (y ?? 0));
}

// Text fields whose values are kept side by side (comma separated) on a merge.
const JOINED_FIELDS = [
  "remarks",
  "moving_within_3_months",
  "order_ag_approval_recvd",
  "item_type",
  "price",
  "moq",
  "if_less_than_moq_extra_charges",
  "drawing_technical_data",
] as const;
// Numeric/derived fields: the target keeps its value, a blank one takes the source's.
const FILLED_FIELDS = [
  "sum_of_physical_stock",
  "stock_as_per_erp",
  "purchase_in_26_27",
  "dispatched_in_26_27",
  "order_in_hand_qty",
  "shortage_qty",
  "unnamed_aa",
  "cost",
  "bom_id",
] as const;

/**
 * Changes to write on `target` when `source` (same item, blank ERP code) is
 * folded into it: received/dispatch added, available + item value recomputed,
 * text fields joined with ", " (distinct values only), the rest filled if blank.
 */
export function mergeRows(
  target: Partial<Record<keyof PhysicalStockRow, unknown>>,
  source: Partial<Record<keyof PhysicalStockRow, unknown>>,
): Record<string, string | null> {
  const blank = (v: unknown) => String(v ?? "").trim() === "";
  const changes: Record<string, string | null> = {
    received_qty: addQty(target.received_qty, source.received_qty),
    dispatch_qty: addQty(target.dispatch_qty, source.dispatch_qty),
  };
  const available = computeAvailableQty(changes.received_qty, changes.dispatch_qty);
  if (available !== null) {
    changes.available_qty = available;
    changes.item_wise_value = computeItemWiseValue(
      blank(target.cost) ? source.cost : target.cost,
      available,
    );
  }
  for (const f of JOINED_FIELDS) {
    const parts: string[] = [];
    for (const v of [target[f], source[f]]) {
      const s = String(v ?? "").trim();
      if (s && !parts.includes(s)) parts.push(s);
    }
    const joined = parts.join(", ") || null;
    if (joined !== (blank(target[f]) ? null : String(target[f]).trim())) changes[f] = joined;
  }
  for (const f of FILLED_FIELDS) {
    if (blank(target[f]) && !blank(source[f])) changes[f] = String(source[f]).trim();
  }
  return changes;
}

/** received - dispatch, or null when either is blank (leave available_qty alone). */
export function computeAvailableQty(received: unknown, dispatch: unknown): string | null {
  const r = parseNum(received);
  const d = parseNum(dispatch);
  return r === null || d === null ? null : String(r - d);
}

// l8_item_category (as stored in the stock DB, upper-cased) -> major/minor.
// Rules confirmed with product: finished valves, capital, gear box, trading
// valves, actuators, casting and pattern are major; everything else listed is
// minor. An unknown category returns null so callers leave the field alone.
const MAJOR_CATEGORIES = new Set([
  "FINISHED VALVES",
  "CAPITAL",
  "GEAR BOX",
  "TRADING VALVES",
  "ACTUATORS",
  "CASTING",
  "PATTERN",
]);

const MINOR_CATEGORIES = new Set([
  "BOLTS & NUTS",
  "MISCELLANEOUS",
  "BRONZE ITEMS",
  "PACKING MATERIALS",
  "RUBBER ITEMS",
  "SPARES",
  "SS SPARES",
  "TOOLS",
  "SCRAP",
]);

/** Major (true) / minor (false) marking for an item category; null when unknown. */
export function computeMajorMinorMarking(category: string | null | undefined): boolean | null {
  const c = (category ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (MAJOR_CATEGORIES.has(c)) return true;
  if (MINOR_CATEGORIES.has(c)) return false;
  return null;
}
