import { PURCHASE_HEADERS, type PurchaseHeader } from "./columns";

// Per-app switches for the Purchase dashboard. This file defines WHAT can be
// switched and the safe defaults; each app decides the values (with the Flags
// SDK, in apps/<app>/flags.ts) and passes a plain PurchaseFlags object in.
// Plain TS, so it is safe to import from both client and server code.

export const SIDEBAR_SECTIONS = ["inTransit", "byContract", "dataHealth"] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

export interface PurchaseFlags {
  /** Removed everywhere: table, filters, export. */
  disabledColumns: PurchaseHeader[];
  hiddenSidebar: SidebarSection[];
  /** Show the Export Excel button. */
  excelExport: boolean;
  /** Start with "open lines only" switched on. */
  openOnlyByDefault: boolean;
}

export const DEFAULT_PURCHASE_FLAGS: PurchaseFlags = {
  disabledColumns: [],
  hiddenSidebar: [],
  excelExport: true,
  openOnlyByDefault: true,
};

export function resolvePurchaseFlags(partial: Partial<PurchaseFlags>): PurchaseFlags {
  return { ...DEFAULT_PURCHASE_FLAGS, ...partial };
}

export function columnAccess(flags: PurchaseFlags) {
  const disabled = new Set<string>(flags.disabledColumns);
  const hiddenSidebar = new Set<string>(flags.hiddenSidebar);
  return {
    isEnabled: (header: string) => !disabled.has(header),
    showSection: (section: SidebarSection) => !hiddenSidebar.has(section),
    visibleHeaders: () => PURCHASE_HEADERS.filter((h) => !disabled.has(h)),
  };
}
