import type { SortFn } from "@tanstack/react-table";

export type TablePrefs = {
  sorting: { id: string; desc: boolean }[];
  filters: Record<string, string>;
  amountFormat: "full" | "lakh";
};

export const DEFAULT_DEBTOR_PREFS: TablePrefs = {
  sorting: [{ id: "overdue", desc: true }],
  filters: {},
  amountFormat: "lakh",
};

export const DEBTOR_PREFS_KEY = "debtors-table-prefs-v1";

const isPrefs = (v: unknown): v is TablePrefs => {
  const p = v as TablePrefs | null;
  return (
    !!p &&
    Array.isArray(p.sorting) &&
    p.sorting.every((s) => typeof s?.id === "string" && typeof s.desc === "boolean") &&
    !!p.filters && typeof p.filters === "object" && !Array.isArray(p.filters) &&
    Object.values(p.filters).every((f) => typeof f === "string") &&
    (p.amountFormat === "full" || p.amountFormat === "lakh")
  );
};

// A blocked (private window) or corrupt store must never blank the table: fall back to the defaults.
export function loadPrefs(key: string): TablePrefs {
  try {
    const raw = globalThis.localStorage.getItem(key);
    if (!raw) return DEFAULT_DEBTOR_PREFS;
    const parsed: unknown = JSON.parse(raw);
    return isPrefs(parsed) ? parsed : DEFAULT_DEBTOR_PREFS;
  } catch {
    return DEFAULT_DEBTOR_PREFS;
  }
}

export function savePrefs(key: string, p: TablePrefs): void {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(p));
  } catch {
    // storage blocked or full: the preference just won't survive a reload
  }
}

/** Ascending comparators. The table reverses them for descending; blanks are handled by `sortUndefined: "last"`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const numericSort: SortFn<any, any> = (a, b, id) => a.getValue<number>(id) - b.getValue<number>(id);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dateSort: SortFn<any, any> = numericSort; // dates are stored as epoch ms, see toTime

/** Blank / unparseable date -> undefined (sorts last in both directions); else epoch ms. */
export function toTime(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/** "1,50,000" -> 150000; blank or non-numeric -> undefined. */
export function toAmount(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) && v.trim() !== "" ? n : undefined;
}

/** Text compare ignoring case; blank -> undefined (last). */
export const textSort: SortFn<any, any> = (a, b, id) => // eslint-disable-line @typescript-eslint/no-explicit-any
  String(a.getValue(id)).localeCompare(String(b.getValue(id)), "en", { sensitivity: "base", numeric: true });

export const DEFAULT_CREDITOR_PREFS: TablePrefs = {
  sorting: [{ id: "overdue", desc: true }],
  filters: {},
  amountFormat: "lakh",
};

export const CREDITOR_PREFS_KEY = "creditors-table-prefs-v1";
