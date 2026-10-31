import type { GMDUpdateRow } from "@/lib/gmdUpdateSlice";
import { dbItemToRow } from "@/lib/gmd_lib/mapSheetRow";
import { looseIncludes, squish } from "@gmd/dashboard/lib/squish";
import { C_BATCH_HEADER, C_BATCH_VALUE } from "@/lib/gmd_lib/verify-bom-columns";

// Pure helpers behind the Raw Material page: row building, casting costs, the
// New Items filters, the stock-value sidebar and duplicate detection. Kept out
// of the component so they are testable and so the page hands the tables stable
// references (see the identity caches below).

export type IndianImportedFilter = "all" | "indian" | "imported";
export type MajorFilter = "all" | "major" | "minor";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// Redux items are immutable (immer), so a row array built from an item stays
// valid for as long as that item object does. Caching by identity means a state
// change only rebuilds the rows of the items that actually changed, and the
// tables receive the same row array for an untouched item - which keeps their
// own per-row caches (global search text, sort keys) warm.
const rowCache = new WeakMap<GMDUpdateRow, unknown[]>();

/** The table row for an item: the sheet columns with the derived name inserted and the C-batch flag appended. */
export function itemToRow(item: GMDUpdateRow): unknown[] {
  let row = rowCache.get(item);
  if (!row) {
    const r = dbItemToRow(item);
    row = [...r.slice(0, 2), item.itemNameDerived, ...r.slice(2), item.cBatch];
    rowCache.set(item, row);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Casting cost
// ---------------------------------------------------------------------------

export type CastingKey = "DI" | "CS" | "CI" | "SS" | "Bronze" | "MS" | "GI";

export const CASTING_KEYS: CastingKey[] = [
  "DI",
  "CS",
  "CI",
  "SS",
  "Bronze",
  "MS",
  "GI",
];

const CASTING_RATE_MATCHERS: {
  key: CastingKey;
  l8: string[];
  l5: string[];
}[] = [
  { key: "DI", l8: ["CASTING"], l5: ["DUCTILE IRON"] },
  {
    key: "CS",
    l8: ["CASTING"],
    l5: ["CARBON STEEL/CAST STEEL", "CARBIDE STEEL"],
  },
  { key: "CI", l8: ["CASTING"], l5: ["CAST IRON"] },
  { key: "SS", l8: ["SS SPARES"], l5: ["STAINLESS STEEL"] },
  { key: "Bronze", l8: ["BRONZE ITEMS"], l5: ["BRONZE/BRASS/GUN METAL"] },
];

export function getCastingKey(l8: string, l5: string): CastingKey | null {
  const a = l8.trim().toUpperCase();
  const b = l5.trim().toUpperCase();
  for (const m of CASTING_RATE_MATCHERS) {
    if (m.l8.includes(a) && m.l5.includes(b)) return m.key;
  }
  return null;
}

// A casting row's cost is derived (rate x weight), which makes a new item
// object. Reusing the last derived object while the cost is unchanged keeps its
// identity - and its cached table row - stable across unrelated renders.
const castingCache = new WeakMap<
  GMDUpdateRow,
  { cost: number; out: GMDUpdateRow }
>();

export function applyCastingCost(
  items: GMDUpdateRow[],
  rates: Record<CastingKey, string>,
): { items: GMDUpdateRow[]; lockedIds: Set<string> } {
  const lockedIds = new Set<string>();
  const out = items.map((item) => {
    const key = getCastingKey(item.l8ItemCategory ?? "", item.l5Material ?? "");
    if (!key) return item;
    const rateStr = (rates[key] ?? "").trim();
    if (!rateStr) return item;
    const rate = parseFloat(rateStr.replace(/,/g, ""));
    const wgt = parseFloat(String(item.pcsWgt ?? "").replace(/,/g, ""));
    if (isNaN(rate) || isNaN(wgt)) return item;
    lockedIds.add(item.id);
    const cost = Number((rate * wgt).toFixed(2));
    const cached = castingCache.get(item);
    if (cached && cached.cost === cost) return cached.out;
    const derived = { ...item, cost };
    castingCache.set(item, { cost, out: derived });
    return derived;
  });
  return { items: out, lockedIds };
}

// ---------------------------------------------------------------------------
// New Items filters (mirror of GMDUpdateTable's controlled filters)
// ---------------------------------------------------------------------------

const rowHayCache = new WeakMap<unknown[], string>();

function rowHay(row: unknown[], headerCount: number): string {
  let hay = rowHayCache.get(row);
  if (hay === undefined) {
    const parts: string[] = new Array(headerCount);
    for (let i = 0; i < headerCount; i++)
      parts[i] = squish(row[i]);
    hay = parts.join("");
    rowHayCache.set(row, hay);
  }
  return hay;
}

export function matchesNewItemsTableFilters(
  row: unknown[],
  hdrs: string[],
  colFilters: Record<string, string>,
  mFilters: Record<string, string[]>,
  gSearch: string,
  bFilters: Record<string, boolean> = {},
): boolean {
  if (gSearch.trim()) {
    const q = squish(gSearch);
    if (!rowHay(row, hdrs.length).includes(q)) return false;
  }
  for (const [colName, filterVal] of Object.entries(colFilters)) {
    if (!filterVal || filterVal === "All") continue;
    const colIdx = hdrs.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "");
    if (filterVal === "(Blank)") {
      if (cellVal !== "") return false;
    } else if (!looseIncludes(cellVal, filterVal)) {
      return false;
    }
  }
  for (const [colName, selected] of Object.entries(mFilters)) {
    if (!selected.length) continue;
    const colIdx = hdrs.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "").trim();
    const matchesBlank = selected.includes("(Blank)") && cellVal === "";
    if (!(matchesBlank || selected.includes(cellVal))) return false;
  }
  if (bFilters.cBatch) {
    const idx = hdrs.indexOf(C_BATCH_HEADER);
    if (idx === -1 || String(row[idx] ?? "").trim() !== C_BATCH_VALUE)
      return false;
  }
  return true;
}

/** Dual cascading sidebar filters (Indian/Imported + Major/Minor). */
export function matchesSidebarNew(
  row: unknown[],
  indianImp: IndianImportedFilter,
  major: MajorFilter,
  hdrs: string[],
  exclude?: "indian" | "major",
): boolean {
  if (exclude !== "indian" && indianImp !== "all") {
    const imp = String(row[hdrs.indexOf("INDIAN/IMPORTED")] ?? "")
      .trim()
      .toLowerCase();
    if (imp !== indianImp) return false;
  }
  if (exclude !== "major" && major !== "all") {
    const m = String(row[hdrs.indexOf("MAJOR MARKING")] ?? "")
      .trim()
      .toLowerCase();
    const isMajor = m === "true";
    const isMinor = m === "false";
    if (major === "major" && !isMajor) return false;
    if (major === "minor" && !isMinor) return false;
  }
  return true;
}

/** Items kept by the sidebar's Indian/Imported + Major/Minor toggles. */
export function matchesSidebarItem(
  item: GMDUpdateRow,
  indianImported: IndianImportedFilter,
  majorFilter: MajorFilter,
): boolean {
  if (
    indianImported !== "all" &&
    (item.indianImported ?? "").trim().toLowerCase() !== indianImported
  )
    return false;
  const marking = String(item.majorMarking ?? "")
    .trim()
    .toLowerCase();
  if (majorFilter === "major" && marking !== "true") return false;
  if (majorFilter === "minor" && marking !== "false") return false;
  return true;
}

export interface CardStats {
  indian: { count: number; sum: number };
  imported: { count: number; sum: number };
  major: { count: number; sum: number };
  minor: { count: number; sum: number };
  /**
   * Everything the current filters leave on screen. Not `indian + imported`:
   * a row whose INDIAN/IMPORTED cell is blank or says something else counts in
   * neither of those, so adding them up understates the stock on hand.
   *
   * Unlike the other cards this one excludes no toggle, because it is not one —
   * it answers "what is the stock I am looking at worth".
   */
  total: { count: number; sum: number };
}

/** Stock value (available stock x cost) per sidebar card, cascading on the other toggle. */
export function computeCardStats(
  sidebarBaseRows: unknown[][],
  headers: string[],
  indianImported: IndianImportedFilter,
  majorFilter: MajorFilter,
): CardStats {
  const stats: CardStats = {
    indian: { count: 0, sum: 0 },
    imported: { count: 0, sum: 0 },
    major: { count: 0, sum: 0 },
    minor: { count: 0, sum: 0 },
    total: { count: 0, sum: 0 },
  };
  const stockValue = (row: unknown[]): number | null => {
    const stockStr = String(row[12] ?? "").trim();
    const costStr = String(row[16] ?? "").trim();
    if (stockStr === "" || costStr === "") return null;
    const stock = parseFloat(stockStr.replace(/,/g, ""));
    const cost = parseFloat(costStr.replace(/,/g, ""));
    if (isNaN(stock) || isNaN(cost)) return null;
    return stock * cost;
  };
  const impIdx = headers.indexOf("INDIAN/IMPORTED");
  const majorIdx = headers.indexOf("MAJOR MARKING");

  // Indian/Imported counts exclude the indian toggle (respect major + table).
  for (const row of sidebarBaseRows) {
    if (!matchesSidebarNew(row, "all", majorFilter, headers, "indian")) continue;
    const value = stockValue(row);
    if (value === null) continue;
    const imp = String(row[impIdx] ?? row[24] ?? "")
      .trim()
      .toLowerCase();
    if (imp === "indian") {
      stats.indian.count++;
      stats.indian.sum += value;
    }
    if (imp === "imported") {
      stats.imported.count++;
      stats.imported.sum += value;
    }
  }

  // Major/Minor counts exclude the major toggle (respect indian + table).
  for (const row of sidebarBaseRows) {
    if (!matchesSidebarNew(row, indianImported, "all", headers, "major"))
      continue;
    const value = stockValue(row);
    if (value === null) continue;
    const m = String(row[majorIdx] ?? row[20] ?? "")
      .trim()
      .toLowerCase();
    if (m === "true") {
      stats.major.count++;
      stats.major.sum += value;
    }
    if (m === "false") {
      stats.minor.count++;
      stats.minor.sum += value;
    }
  }

  // Grand total: both toggles applied, nothing excluded.
  for (const row of sidebarBaseRows) {
    if (!matchesSidebarNew(row, indianImported, majorFilter, headers)) continue;
    const value = stockValue(row);
    if (value === null) continue;
    stats.total.count++;
    stats.total.sum += value;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/** NEW ITEM STATUS values the catalogue treats as gone; never flagged as duplicates. */
const DEDUP_SKIPPED_STATUSES = new Set([
  "CLOSED",
  "TO BE CLOSED",
  "TO BE LOCKED",
]);

/**
 * Ids of rows whose derived item name is shared by more than one raw material
 * row (catalogue-wide). Blank names are ignored, and rows the catalogue treats
 * as gone never count or get flagged.
 */
export function computeDuplicateDerivedIds(items: GMDUpdateRow[]): Set<string> {
  const keyOf = (item: GMDUpdateRow) =>
    (item.itemNameDerived ?? "").trim().toUpperCase();
  const live = items.filter(
    (item) =>
      !DEDUP_SKIPPED_STATUSES.has(
        String(item.newItemStatus ?? "").trim().toUpperCase(),
      ),
  );
  const counts = new Map<string, number>();
  for (const item of live) {
    const key = keyOf(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const item of live) {
    const key = keyOf(item);
    if (key && (counts.get(key) ?? 0) > 1) ids.add(item.id);
  }
  return ids;
}
