"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import {
  BLANK_ONLY_HEADERS,
  COLUMNS,
  DROPDOWN_OPTIONS,
  FIELDS,
  NUMERIC_COLUMNS,
  rowToArray,
} from "../columns";
import type { PhysicalStockFlags, SidebarSection } from "../flags";
import type { PhysicalStockActions, PhysicalStockRow } from "../types";
import StockAnalyticsSidebar, { type MajorMinorKind, type StockCardKind } from "./StockAnalyticsSidebar";
import NewItemDialog from "./NewItemDialog";

const HEADERS = [...COLUMNS] as string[];
const BLANK_ONLY = new Set<string>(BLANK_ONLY_HEADERS);
const AVAILABLE_IDX = COLUMNS.indexOf("AVAILABLE QTY.");
const COST_IDX = COLUMNS.indexOf("COST");
const MAJOR_IDX = COLUMNS.indexOf("MAJOR/MINOR MARKING");

function toNum(value: unknown): number {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const majorMinorKind = (value: unknown): MajorMinorKind =>
  value === true ? "yes" : value === false ? "no" : "blank";

export interface PhysicalStockPageProps {
  flags: PhysicalStockFlags;
  actions: PhysicalStockActions;
  /** Set false when the host app renders the header (and New button) elsewhere. */
  showHeader?: boolean;
}

export function PhysicalStockPage({ flags, actions, showHeader = true }: PhysicalStockPageProps) {
  const [items, setItems] = useState<PhysicalStockRow[]>([]);
  const [bomIdOptions, setBomIdOptions] = useState<Record<string, string[]>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [statsRows, setStatsRows] = useState<unknown[][]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cardFilter, setCardFilter] = useState<StockCardKind | null>(null);
  const [majorMinorFilter, setMajorMinorFilter] = useState<Set<MajorMinorKind>>(new Set());

  const { load, updateField, create, updateBomId } = actions;

  const { editableColumns, blankOnlyColumns, dropdownOptions, showSection } = useMemo(() => {
    const hiddenSidebar = new Set<string>(flags.hiddenSidebar);
    // ERP CODE and the L/Dia dropdowns may only fill a blank cell, and only
    // when the app put them in editableColumns (the admin/developer gate).
    const blankOnly = flags.editableColumns.filter((h) => BLANK_ONLY.has(h));
    const dropdowns: Record<string, string[]> = {};
    for (const h of blankOnly) {
      const options = DROPDOWN_OPTIONS[h];
      if (options) dropdowns[h] = [...options];
    }
    return {
      editableColumns: flags.editableColumns.filter(
        (h) => !BLANK_ONLY.has(h) && (h !== "BOM ID" || updateBomId),
      ),
      blankOnlyColumns: blankOnly,
      dropdownOptions: dropdowns,
      showSection: (s: SidebarSection) => !hiddenSidebar.has(s),
    };
  }, [flags, updateBomId]);

  const loadData = useCallback(async () => {
    try {
      const res = await load();
      if (res.success) {
        setItems(res.data.items);
        setBomIdOptions(res.data.bomIdOptions ?? {});
      } else {
        toast.error(res.error || "Failed to load physical stock data.");
      }
    } catch {
      toast.error("Failed to load physical stock data.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // A "New" button rendered outside this component (e.g. the app navbar) asks
  // the table to reload through this event.
  useEffect(() => {
    const onCreated = () => loadData();
    window.addEventListener("physical-stock:created", onCreated);
    return () => window.removeEventListener("physical-stock:created", onCreated);
  }, [loadData]);

  const rows = useMemo(() => items.map(rowToArray), [items]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);

  // Stat-card filter narrows the table only; the sidebar totals ignore it so
  // toggling a card never changes the qty/value figures.
  const cardFilteredRows = useMemo(() => {
    if (!cardFilter) return rows;
    const rowsOut: unknown[][] = [];
    for (const row of rows) {
      const qty = toNum(row[AVAILABLE_IDX]);
      if (cardFilter === "qty" && qty <= 0) continue;
      if (cardFilter === "value" && toNum(row[COST_IDX]) * qty <= 0) continue;
      rowsOut.push(row);
    }
    return rowsOut;
  }, [rows, cardFilter]);

  const cardDisplayFilter = useCallback(
    (row: unknown[]) => {
      if (!cardFilter) return true;
      const qty = toNum(row[AVAILABLE_IDX]);
      return cardFilter === "qty" ? qty > 0 : toNum(row[COST_IDX]) * qty > 0;
    },
    [cardFilter],
  );

  const majorMinorCounts = useMemo(() => {
    const counts: Record<MajorMinorKind, number> = { yes: 0, no: 0, blank: 0 };
    for (const row of cardFilteredRows) counts[majorMinorKind(row[MAJOR_IDX])]++;
    return counts;
  }, [cardFilteredRows]);

  // Major/Minor filter narrows the table without touching other filters.
  const tableRows = useMemo(() => {
    if (majorMinorFilter.size === 0) return { rows, ids };
    const rowsOut: unknown[][] = [];
    const idsOut: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (!majorMinorFilter.has(majorMinorKind(rows[i][MAJOR_IDX]))) continue;
      rowsOut.push(rows[i]);
      idsOut.push(ids[i]);
    }
    return { rows: rowsOut, ids: idsOut };
  }, [rows, ids, majorMinorFilter]);

  const toggleMajorMinor = useCallback((kind: MajorMinorKind) => {
    setMajorMinorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  // Sums follow the table's own column/global filters, but not the stat-card
  // drill-down (the table reports rows before applying displayOnlyRowFilter).
  const { availableQty, availableValue } = useMemo(() => {
    let qty = 0;
    let value = 0;
    for (const row of statsRows) {
      const available = toNum(row[AVAILABLE_IDX]);
      qty += available;
      value += toNum(row[COST_IDX]) * available;
    }
    return { availableQty: qty, availableValue: value };
  }, [statsRows]);

  const mergeRow = useCallback((id: string, changes: Partial<PhysicalStockRow>) => {
    setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }, []);

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = COLUMNS[colIndex];
      const toastId = toast.loading(`Updating ${header}...`);
      const res = await updateField(id, FIELDS[colIndex], value);
      if (res.success && res.data.merged) {
        const m = res.data.merged;
        toast.success(
          `Merged into ERP ${m.erp_code}: location and L columns matched. Received ${m.received_qty ?? 0}, dispatch ${m.dispatch_qty ?? 0}, available ${m.available_qty ?? 0}.`,
          { id: toastId, duration: 8000 },
        );
        await loadData();
      } else if (res.success) {
        mergeRow(id, res.data);
        toast.success(`${header} updated`, { id: toastId });
      } else {
        toast.error(res.error || `Failed to update ${header}`, { id: toastId });
      }
    },
    [updateField, mergeRow, loadData],
  );

  const handleSelectBomId = useCallback(
    async (id: string, bomId: string | null) => {
      if (!updateBomId) return;
      const toastId = toast.loading("Saving BOM ID...");
      const res = await updateBomId(id, bomId);
      if (res.success) {
        mergeRow(id, res.data);
        toast.success("BOM ID saved", { id: toastId });
      } else {
        toast.error(res.error || "Failed to save BOM ID", { id: toastId });
      }
    },
    [updateBomId, mergeRow],
  );

  const showNew = showHeader && flags.newItem && create;

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        {showHeader && (
          <GMDUpdateHeader
            totalRows={items.length}
            title="Physical Stock"
            actions={
              showNew && (
                <button
                  type="button"
                  onClick={() => setShowNewDialog(true)}
                  className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-400 dark:text-emerald-300 transition-all"
                >
                  <Plus size={12} />
                  New
                </button>
              )
            }
          />
        )}
        {showNew && (
          <NewItemDialog
            open={showNewDialog}
            onOpenChange={setShowNewDialog}
            rows={items}
            create={create}
            onCreated={loadData}
          />
        )}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading physical stock...
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex gap-4 mt-4">
            <StockAnalyticsSidebar
              show={showSection}
              availableQty={availableQty}
              availableValue={availableValue}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((c) => !c)}
              activeCard={cardFilter}
              onCardClick={(kind) => setCardFilter((prev) => (prev === kind ? null : kind))}
              majorMinorSelection={majorMinorFilter}
              majorMinorCounts={majorMinorCounts}
              onToggleMajorMinor={toggleMajorMinor}
            />
            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
              <GMDUpdateTable
                headers={HEADERS}
                rows={tableRows.rows}
                ids={tableRows.ids}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                title="Physical Stock"
                editable
                editableColumns={editableColumns}
                blankOnlyEditableColumns={blankOnlyColumns}
                blankOnlyUnlockedBy="ERP CODE"
                fixedDropdownOptions={dropdownOptions}
                hiddenColumns={flags.hiddenColumns}
                numericColumns={NUMERIC_COLUMNS}
                bomIdOptionsById={updateBomId ? bomIdOptions : undefined}
                onSelectBomId={updateBomId ? handleSelectBomId : undefined}
                onCellUpdate={handleCellUpdate}
                displayOnlyRowFilter={cardDisplayFilter}
                onFilteredRowsChange={setStatsRows}
                duplicateErpHighlight={flags.duplicateErpHighlight}
                fullHeight
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
