"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  hydrateGMDUpdate,
  upsertGMDUpdateItems,
  applyTransferCostMatch,
  updateGMDUpdateField,
  updateGMDUsdCost,
  setNewItemStatusWithCostMerge,
  selectAllGMDUpdateRows,
  selectGMDUpdateBomId,
  uploadGMDUpdateAttachment,
  clearGMDUpdateAttachment,
  deleteGMDUpdateTransferredItem,
  type GMDUpdateRow,
} from "@/lib/gmdUpdateSlice";
import {
  CASTING_KEYS,
  applyCastingCost,
  computeCardStats,
  computeDuplicateDerivedIds,
  itemToRow,
  matchesNewItemsTableFilters,
  matchesSidebarItem,
  type CastingKey,
} from "@/lib/gmd_lib/rawMaterialView";
import {
  FIXED_DROPDOWN_OPTIONS,
  CANONICAL_COLUMNS,
  COL_INDEX_TO_DB_FIELD,
  resolveGMDUpdateField,
  withHardcodedL7Options,
} from "@/lib/gmd_lib/sheet-columns";
import { C_BATCH_HEADER, cBatchBadges, cBatchFilter } from "@/lib/gmd_lib/verify-bom-columns";
import { getUsdInrRateAction, setGMDUpdateTransferredAction, addTransferredBlankItemsAction, importTransferredExcelAction, transferFilteredByCodeAction, getTradingValveOptionsAction, getTransferCostMatchProposalsAction, applyTransferCostMatchAction, uploadSupplierRatesAction, type TransferCostMatchProposal } from "@/app/actions/gmdUpdate";
import { getGMDCastingRatesAction, saveGMDCastingRateAction } from "@/app/actions/misc";
import TransferCostMatchDialog from "../../components/gmd_dashboard/TransferCostMatchDialog";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@gmd/ui/components/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@gmd/ui/components/resizable";
import { useDefaultLayout } from "react-resizable-panels";

const layoutStorage = {
  getItem: (key: string) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
};

const CASCADE_ROOT_HEADER = "L8 -ITEM CATEGORY";
const CASCADE_ROOT_VALUES = ["TRADING VALVE"];
const CASCADE_LEVEL_HEADERS = [
  "L1",
  "L2-VALVE TYPE",
  "L3-DIA",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
  "L7-DIMENSION",
];

const EMPTY_HEADERS: string[] = [];

interface SheetData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  syncedAt: string | null;
  bomIdOptions?: Record<string, string[]>;
  transferredIds?: string[];
  costMergedIds?: string[];
}

const NEW_STATUS_COL = "NEW ITEM STATUS";

/** NEW ITEM STATUS values that place a row in the "New Items" table. */
function isMoveToNewItemsStatus(value: string | null): boolean {
  const v = (value ?? "").trim().toUpperCase();
  return v === "" || v === "-" || v === "UPDATED";
}

// Stable descriptor list so GMDUpdateTable's row predicate keeps a stable dep.
const RAW_MATERIAL_BATCH_FILTERS = [cBatchFilter()];

// Static table props, hoisted so every render hands GMDUpdateTable the same
// references and its filter/option memos aren't invalidated by parent renders.
const ERP_CODE_BADGES = cBatchBadges("ERP ITEM CODE");
const UNIQUE_KEY_COLUMNS = ["ERP ITEM CODE"];
const NEW_ITEMS_EDITABLE_COLUMNS = [
  "CONV",
  "AUM",
  "1 pcs wgt",
  "cost",
  "Available Stock",
  "INDIAN/IMPORTED",
  "USD cost",
  "HSN CODE",
  "HSN Code Validation",
  "MAJOR MARKING",
  "RM TYPE",
  "NEW ITEM STATUS",
  "Order Qty",
];
const NEW_ITEMS_HIDDEN_COLUMNS = [
  "BOM ID",
  "Vendor Reference",
  "Attachment",
  C_BATCH_HEADER,
];
const PROCESSED_ITEMS_HIDDEN_COLUMNS = [
  "Vendor Reference",
  "Attachment",
  C_BATCH_HEADER,
];
const TRANSFERRED_ITEMS_HIDDEN_COLUMNS = ["BOM ID", C_BATCH_HEADER];

const RAW_MATERIAL_TABS = [
  { key: "new-items", label: "New Items (Blank Status)" },
  { key: "filtered-items", label: "Filtered Items" },
  { key: "transferred-items", label: "Transferred Items" },
] as const;
type RawMaterialTab = (typeof RAW_MATERIAL_TABS)[number]["key"];

function rowToGMDUpdateItem(
  id: string,
  row: unknown[],
  cBatchIdx: number,
  costMerged = false,
): GMDUpdateRow {
  return {
    id,
    erpItemCode: String(row[0] ?? ""),
    itemNameAuto: String(row[1] ?? ""),
    itemNameDerived: String(row[2] ?? ""),
    l1: String(row[3] ?? ""),
    l2ValveType: String(row[4] ?? ""),
    l3Dia: String(row[5] ?? ""),
    l4Component: String(row[6] ?? ""),
    l5Material: String(row[7] ?? ""),
    l6Std: String(row[8] ?? ""),
    l7Dimension: String(row[9] ?? ""),
    l8ItemCategory: String(row[10] ?? ""),
    um: String(row[11] ?? ""),
    availableStock: String(row[12] ?? ""),
    conv1: String(row[13] ?? ""),
    pcsWgt: String(row[14] ?? ""),
    aum: String(row[15] ?? ""),
    cost: row[16] != null && row[16] !== "" ? Number(row[16]) : null,
    usdRateOption: String(row[17] ?? ""),
    hsnCode: String(row[18] ?? ""),
    hsnCodeValidation: String(row[19] ?? ""),
    conv2: String(row[20] ?? ""),
    majorMarking: String(row[21] ?? ""),
    newItemStatus: String(row[22] ?? ""),
    currentStatus: String(row[23] ?? ""),
    rmType: String(row[24] ?? ""),
    indianImported: String(row[25] ?? ""),
    orderDelivery: String(row[26] ?? ""),
    bomId: String(row[27] ?? ""),
    vendorReference: String(row[28] ?? ""),
    attachmentUrl: String(row[29] ?? ""),
    // cBatch is appended after dbItemToRow by the route, so its index is not
    // fixed here - it is resolved from the payload headers at the call site.
    cBatch: cBatchIdx >= 0 ? String(row[cBatchIdx] ?? "") : "",
    costMerged,
  };
}

function blankGMDUpdateRow(id: string, erpItemCode: string): GMDUpdateRow {
  return {
    id,
    erpItemCode,
    itemNameAuto: null,
    l1: null,
    l2ValveType: null,
    l3Dia: null,
    l7Dimension: null,
    l4Component: null,
    l5Material: null,
    l6Std: null,
    l8ItemCategory: null,
    um: null,
    availableStock: null,
    conv1: null,
    pcsWgt: null,
    aum: null,
    cost: null,
    usdRateOption: null,
    hsnCode: null,
    hsnCodeValidation: null,
    conv2: null,
    majorMarking: null,
    newItemStatus: null,
    currentStatus: null,
    rmType: null,
    indianImported: null,
    orderDelivery: null,
    bomId: null,
    vendorReference: null,
    attachmentUrl: null,
    itemNameDerived: null,
    cBatch: null,
    costMerged: false,
  };
}

function normalizeImportHeader(h: string): string {
  return h.trim().toUpperCase().replace(/\s+/g, " ");
}

const EXCEL_HEADER_TO_FIELD: Record<string, string> = {};
CANONICAL_COLUMNS.forEach((h, i) => {
  const field = COL_INDEX_TO_DB_FIELD[i];
  const key = normalizeImportHeader(h);
  if (field && !(key in EXCEL_HEADER_TO_FIELD)) {
    EXCEL_HEADER_TO_FIELD[key] = field;
  }
});
EXCEL_HEADER_TO_FIELD[normalizeImportHeader("BOM ID")] = "bomId";
EXCEL_HEADER_TO_FIELD[normalizeImportHeader("Vendor Reference")] =
  "vendorReference";

export default function Home() {
  const dispatch = useAppDispatch();
  const allItems = useAppSelector(selectAllGMDUpdateRows);
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<
    Record<string, string[]>
  >({});
  const [usdInrRate, setUsdInrRate] = useState<number | null>(null);
  const [usdRateNote, setUsdRateNote] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RawMaterialTab>("new-items");
  const [bomIdOptionsById, setBomIdOptionsById] = useState<
    Record<string, string[]>
  >({});
  const [castingRates, setCastingRates] = useState<Record<CastingKey, string>>({
    DI: "",
    CS: "",
    CI: "",
    SS: "",
    Bronze: "",
    MS: "",
    GI: "",
  });
  const saveRateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transferredIds, setTransferredIds] = useState<string[]>([]);
  const [pasteDraft, setPasteDraft] = useState("");
  const [tradingValveOptions, setTradingValveOptions] = useState<
    Record<string, string[]>
  >({});

  const {
    defaultLayout: horizontalLayout,
    onLayoutChanged: onHorizontalLayoutChanged,
  } = useDefaultLayout({
    id: "raw-material-horizontal",
    storage: layoutStorage,
  });

  const handleCastingRateChange = useCallback((key: string, value: string) => {
    setCastingRates((prev) => ({ ...prev, [key]: value }));
    if (saveRateTimer.current) clearTimeout(saveRateTimer.current);
    saveRateTimer.current = setTimeout(() => {
      saveGMDCastingRateAction(key, value);
    }, 600);
  }, []);

  useEffect(() => {
    getGMDCastingRatesAction().then((res) => {
      if (res.success && res.data) {
        setCastingRates((prev) => ({ ...prev, ...res.data }));
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (saveRateTimer.current) clearTimeout(saveRateTimer.current);
    },
    [],
  );

  const handleSelectBomId = useCallback(
    async (id: string, bomId: string | null) => {
      const toastId = toast.loading("Saving BOM ID...");
      try {
        await dispatch(selectGMDUpdateBomId({ id, bomId })).unwrap();
        toast.success("BOM ID saved", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to save BOM ID", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const castingRateInputs = useMemo(
    () =>
      CASTING_KEYS.map((key) => ({
        key,
        label: key,
        value: castingRates[key],
        onChange: (value: string) => handleCastingRateChange(key, value),
      })),
    [castingRates, handleCastingRateChange],
  );

  const applyUsdRate = useCallback(
    (data: { rate: number; source: string; fetchedAt: string }) => {
      setUsdInrRate(data.rate);
      const asOf = new Date(data.fetchedAt).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
      setUsdRateNote(`${data.source} · as of ${asOf}`);
    },
    [],
  );

  const refreshRate = useCallback(async () => {
    const res = await getUsdInrRateAction(true);
    if (res.success && res.data) applyUsdRate(res.data);
  }, [applyUsdRate]);

  useEffect(() => {
    getUsdInrRateAction(false).then((res) => {
      if (res.success && res.data) applyUsdRate(res.data);
    });
  }, [applyUsdRate]);

  const enhancedCategoryOptions = useMemo(
    () =>
      withHardcodedL7Options({
        ...categoryOptions,
        "INDIAN/IMPORTED": categoryOptions["INDIAN/IMPORTED"] || [
          "Indian",
          "Imported",
        ],
      }),
    [categoryOptions],
  );

  const transferredCategoryOptions = useMemo(
    () =>
      withHardcodedL7Options({
        ...enhancedCategoryOptions,
        [CASCADE_ROOT_HEADER]: CASCADE_ROOT_VALUES,
        ...Object.fromEntries(
          CASCADE_LEVEL_HEADERS.filter(
            (h) => (tradingValveOptions[h]?.length ?? 0) > 0,
          ).map((h) => [h, tradingValveOptions[h]]),
        ),
      }),
    [enhancedCategoryOptions, tradingValveOptions],
  );

  const transferredFilterOptions = useMemo(
    () => ({ [CASCADE_ROOT_HEADER]: CASCADE_ROOT_VALUES }),
    [],
  );

  const clearMoved = useCallback(async () => {
    if (!transferredIds.length) return;
    const res = await setGMDUpdateTransferredAction(transferredIds, false);
    if (res.success) {
      setTransferredIds([]);
      toast.success("All moved items returned to Filtered Items");
    } else {
      toast.error(res.error || "Failed to clear moved items");
    }
  }, [transferredIds]);

  const loadTradingValveOptions = useCallback(async () => {
    const res = await getTradingValveOptionsAction();
    if (res.success && res.data) {
      setTradingValveOptions(res.data);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      void loadTradingValveOptions(); // runs alongside the data request
      const res = await fetch("/raw_material/api/gmd-update");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setTransferredIds(json.transferredIds ?? []);
      if (json.bomIdOptions) setBomIdOptionsById(json.bomIdOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [loadTradingValveOptions]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/raw_material/api/gmd-update/sync", {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetch("/raw_material/api/gmd-category")
      .then((res) => res.json())
      .then(setCategoryOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (data?.ids && data?.rows) {
      const transferredIdSet = new Set(data.transferredIds ?? []);
      const validIndices = data.rows
        .map((row, i) => ({ row, i }))
        .filter(
          ({ row, i }) =>
            String(row[0] ?? "").trim() !== "" ||
            transferredIdSet.has(data.ids[i]),
        )
        .map(({ i }) => i);
      const cBatchIdx = (data.headers ?? []).indexOf(C_BATCH_HEADER);
      const costMergedIdSet = new Set(data.costMergedIds ?? []);
      const items = validIndices.map((i) =>
        rowToGMDUpdateItem(
          data.ids[i],
          data.rows[i],
          cBatchIdx,
          costMergedIdSet.has(data.ids[i]),
        ),
      );
      dispatch(hydrateGMDUpdate(items));
    }
  }, [data, dispatch]);

  const headers = data?.headers ?? EMPTY_HEADERS;
  const syncedAt = data?.syncedAt ?? null;

  const transferredSet = useMemo(
    () => new Set(transferredIds),
    [transferredIds],
  );

  const newItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          (!item.newItemStatus ||
            item.newItemStatus === "-" ||
            item.newItemStatus === "Updated") &&
          !item.costMerged &&
          !transferredSet.has(item.id),
      ),
    [allItems, transferredSet],
  );

  const processedItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          (item.costMerged ||
            (item.newItemStatus &&
              item.newItemStatus !== "-" &&
              item.newItemStatus !== "Updated")) &&
          !transferredSet.has(item.id),
      ),
    [allItems, transferredSet],
  );

  const transferredItems = useMemo(
    () => allItems.filter((item) => transferredSet.has(item.id)),
    [allItems, transferredSet],
  );

  const totalRows = allItems.length;

  // Ids of rows sharing a derived item name catalogue-wide (see rawMaterialView).
  const duplicateDerivedIds = useMemo(
    () => computeDuplicateDerivedIds(allItems),
    [allItems],
  );

  const processedCost = useMemo(
    () => applyCastingCost(processedItems, castingRates),
    [processedItems, castingRates],
  );
  const processedItemRows = useMemo(
    () => processedCost.items.map(itemToRow),
    [processedCost],
  );
  const processedItemIds = useMemo(
    () => processedCost.items.map((i) => i.id),
    [processedCost],
  );

  const transferredItemRows = useMemo(
    () => transferredItems.map(itemToRow),
    [transferredItems],
  );
  const transferredItemIds = useMemo(
    () => transferredItems.map((i) => i.id),
    [transferredItems],
  );

  const transferredHeaders = useMemo(() => {
    const out: string[] = [];
    for (const h of headers) {
      if (h === "Vendor Reference") continue;
      out.push(h === "Available Stock" ? "Vendor Reference" : h);
    }
    return out;
  }, [headers]);

  const transferredRows = useMemo(() => {
    const vendorIdx = headers.indexOf("Vendor Reference");
    return transferredItemRows.map((row) => {
      const out: unknown[] = [];
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (h === "Vendor Reference") continue;
        if (h === "Available Stock") {
          out.push(vendorIdx >= 0 ? (row[vendorIdx] ?? "") : "");
        } else {
          out.push(row[i]);
        }
      }
      return out;
    });
  }, [headers, transferredItemRows]);

  const moveErpCodes = useCallback(
    async (raw: string) => {
      const codes = raw
        .split(/[\n,;\t]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!codes.length) return;
      const next = new Set(transferredIds);
      const matchedIds: string[] = [];
      let matched = 0;
      const newCodes: string[] = [];
      for (const code of codes) {
        const key = code.trim().toLowerCase();
        const item = allItems.find(
          (it) =>
            String(it.erpItemCode ?? "")
              .trim()
              .toLowerCase() === key,
        );
        if (item && next.has(item.id)) continue;
        const isProcessed =
          item &&
          item.newItemStatus &&
          item.newItemStatus !== "-" &&
          item.newItemStatus !== "Updated";
        if (isProcessed) {
          next.add(item.id);
          matchedIds.push(item.id);
          matched++;
        } else {
          newCodes.push(code);
        }
      }
      if (matched > 0) {
        const res = await setGMDUpdateTransferredAction(matchedIds, true);
        if (res.success) {
          setTransferredIds([...next]);
          toast.success(
            `${matched} item${matched === 1 ? "" : "s"} moved to Transferred Items`,
          );
        } else {
          toast.error(res.error || "Failed to move items");
        }
      }
      if (newCodes.length) {
        const res = await addTransferredBlankItemsAction(newCodes);
        if (res.success && res.data) {
          const { created, invalid } = res.data;
          if (created.length) {
            dispatch(
              upsertGMDUpdateItems(
                created.map((c) => blankGMDUpdateRow(c.id, c.code)),
              ),
            );
            setTransferredIds((prev) => [...prev, ...created.map((c) => c.id)]);
            toast.success(
              `${created.length} code${created.length === 1 ? "" : "s"} added as blank row${created.length === 1 ? "" : "s"}`,
            );
          }
          if (invalid.length) {
            toast.error(
              `Invalid ERP Format${invalid.length === 1 ? "" : "s"} (3 caps letters + 6 digits): ${invalid.join(", ")}`,
            );
          }
        } else {
          toast.error(res.error || "Failed to add items");
        }
      }
    },
    [transferredIds, allItems, dispatch],
  );

  const handleImportExcel = useCallback(
    async (file: File) => {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        if (!sheet) {
          toast.error("No sheet found in the file.");
          return;
        }
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          sheet,
          { defval: null },
        );
        if (!jsonRows.length) {
          toast.error("No data rows found in the sheet.");
          return;
        }
        const parsed: {
          erpItemCode: string;
          values: Record<string, string>;
        }[] = [];
        for (const row of jsonRows) {
          let code = "";
          const values: Record<string, string> = {};
          for (const key of Object.keys(row)) {
            const field = EXCEL_HEADER_TO_FIELD[normalizeImportHeader(key)];
            if (!field) continue;
            const raw = row[key];
            if (raw == null) continue;
            const str = String(raw).trim();
            if (field === "erpItemCode") {
              code = str;
              continue;
            }
            if (str !== "") values[field] = str;
          }
          parsed.push({ erpItemCode: code, values });
        }
        if (!parsed.length) {
          toast.error("No data rows found in the sheet.");
          return;
        }
        const res = await importTransferredExcelAction(parsed);
        if (res.success && res.data) {
          const { updated, skipped } = res.data;
          const upserts: GMDUpdateRow[] = [];
          for (const u of updated) {
            const existing = allItems.find((i) => i.id === u.id);
            const parsedRow = parsed.find((p) => p.erpItemCode === u.code);
            upserts.push({
              ...blankGMDUpdateRow(u.id, u.code),
              ...existing,
              ...(parsedRow?.values ?? {}),
            });
          }
          if (upserts.length) dispatch(upsertGMDUpdateItems(upserts));
          const ids = updated.map((u) => u.id);
          if (ids.length) {
            setTransferredIds((prev) => [...new Set([...prev, ...ids])]);
          }
          const parts: string[] = [];
          if (updated.length) parts.push(`${updated.length} updated`);
          if (skipped) {
            parts.push(`${skipped} skipped (no code / not in Transferred)`);
          }
          if (parts.length)
            toast.success(`Import complete: ${parts.join(", ")}`);
        } else {
          toast.error(res.error || "Failed to import Excel.");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to read Excel file.",
        );
      }
    },
    [allItems, dispatch],
  );

  const handleTransferredErpCodeChange = useCallback(
    async (_id: string, code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      const res = await transferFilteredByCodeAction(trimmed);
      if (res.success && res.data && res.data.id) {
        setTransferredIds((prev) => [...new Set([...prev, res.data.id!])]);
        toast.success("Matching Filtered item moved to Transferred Items");
      }
    },
    [],
  );

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = headers[colIndex];
      if (!header) return;
      const field = resolveGMDUpdateField(headers, colIndex);
      if (!field) return;

      // Clearing NEW ITEM STATUS normally shifts the row up to New Items. If its
      // ITEM NAME (proposed)-AUTO already exists there, transfer this row's cost
      // to that New Item instead and keep this row in Filtered.
      if (field === "newItemStatus" && isMoveToNewItemsStatus(value)) {
        const src = allItems.find((it) => it.id === id);
        const isFilteredRow =
          !!src &&
          !src.costMerged &&
          !!src.newItemStatus &&
          src.newItemStatus !== "-" &&
          src.newItemStatus !== "Updated";
        if (isFilteredRow) {
          const toastId = toast.loading(`Updating ${header}...`);
          try {
            const data = await dispatch(
              setNewItemStatusWithCostMerge({ id, value: value || null }),
            ).unwrap();
            if (data.merged) {
              toast.success(
                data.noCost
                  ? "No cost to transfer — row kept in Filtered Items."
                  : `Cost transferred to ${data.targetIds.length} New Item(s); row kept in Filtered Items.`,
                { id: toastId },
              );
            } else {
              toast.success(`${header} updated`, { id: toastId });
            }
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : `Failed to update ${header}`,
              { id: toastId },
            );
          }
          return;
        }
      }

      const toastId = toast.loading(`Updating ${header}...`);
      try {
        await dispatch(
          updateGMDUpdateField({ id, field, value: value || null }),
        ).unwrap();
        toast.success(`${header} updated`, { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || `Failed to update ${header}`, {
          id: toastId,
        });
      }
    },
    [headers, dispatch, allItems],
  );

  const handleTransferredCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = transferredHeaders[colIndex];
      if (!header) return;
      const field = resolveGMDUpdateField(transferredHeaders, colIndex);
      if (!field) return;
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        await dispatch(
          updateGMDUpdateField({ id, field, value: value || null }),
        ).unwrap();
        toast.success(`${header} updated`, { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || `Failed to update ${header}`, {
          id: toastId,
        });
      }
      if (header === "ERP ITEM CODE" && value) {
        handleTransferredErpCodeChange(id, value);
      }
    },
    [transferredHeaders, dispatch, handleTransferredErpCodeChange],
  );

  const handleUploadAttachment = useCallback(
    async (id: string, file: File) => {
      const toastId = toast.loading("Uploading attachment...");
      try {
        await dispatch(uploadGMDUpdateAttachment({ id, file })).unwrap();
        toast.success("Attachment uploaded", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to upload attachment.", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const handleClearAttachment = useCallback(
    async (id: string) => {
      const toastId = toast.loading("Removing attachment...");
      try {
        await dispatch(clearGMDUpdateAttachment({ id })).unwrap();
        toast.success("Attachment removed", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to remove attachment.", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const handleDeleteTransferredRow = useCallback(
    async (id: string) => {
      const toastId = toast.loading("Deleting row...");
      try {
        await dispatch(deleteGMDUpdateTransferredItem({ id })).unwrap();
        setTransferredIds((prev) => prev.filter((x) => x !== id));
        toast.success("Row deleted", { id: toastId });
      } catch (err: any) {
        toast.error(err?.message || err || "Failed to delete row.", {
          id: toastId,
        });
      }
    },
    [dispatch],
  );

  const [matchProposals, setMatchProposals] = useState<
    TransferCostMatchProposal[]
  >([]);
  const [matchOpen, setMatchOpen] = useState(false);

  const handleStartMatchCosts = useCallback(async () => {
    const res = await getTransferCostMatchProposalsAction();
    if (!res.success) {
      toast.error(res.error || "Failed to scan matches.");
      return;
    }
    const proposals = res.data?.proposals ?? [];
    if (proposals.length === 0) {
      toast.info("No L1–L8 matches found between Transferred and New Items.");
      return;
    }
    setMatchProposals(proposals);
    setMatchOpen(true);
  }, []);

  const handleApplyMatch = useCallback(
    async (proposal: TransferCostMatchProposal) => {
      const res = await applyTransferCostMatchAction(proposal.transferredRowId);
      if (!res.success) {
        toast.error(res.error || "Failed to apply cost match.");
        return;
      }
      const data = res.data!;
      dispatch(
        applyTransferCostMatch({
          transferredRowId: data.transferredRowId,
          newItemIds: data.updatedNewItemIds,
          cost: data.cost,
        }),
      );
      setTransferredIds((prev) =>
        prev.filter((x) => x !== data.transferredRowId),
      );
      toast.success(
        `Updated ${data.updatedNewItemIds.length} new item${data.updatedNewItemIds.length === 1 ? "" : "s"} to cost ₹${data.cost}`,
      );
    },
    [dispatch],
  );

  const handleMatchClose = useCallback(() => {
    setMatchOpen(false);
    setMatchProposals([]);
    fetchData();
  }, [fetchData]);

  const [supplierSummary, setSupplierSummary] = useState<{
    rate: number;
    updated: { code: string; oldUsd: number | null; newUsd: number; oldCost: number | null; newCost: number }[];
    added: { code: string; newUsd: number; newCost: number }[];
    notMatched: { code: string; reason: string }[];
    unchanged: number;
  } | null>(null);
  const supplierFileRef = useRef<HTMLInputElement>(null);

  const handleDownloadSupplierTemplate = useCallback(async () => {
    const XLSX = await import("xlsx");
    const { SUPPLIER_RATE_HEADERS } = await import("@/lib/supplierRateUpload");
    const ws = XLSX.utils.aoa_to_sheet([[...SUPPLIER_RATE_HEADERS]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Supplier prices");
    XLSX.writeFile(wb, "supplier-price-template.xlsx");
  }, []);

  const handleUploadSupplierPrices = useCallback(
    async (file: File) => {
      const toastId = toast.loading("Reading supplier prices...");
      try {
        const { parseSupplierRateFile } = await import("@/lib/supplierRateUpload");
        const { rates, errors } = parseSupplierRateFile(await file.arrayBuffer());
        if (!rates.length && !errors.length) {
          toast.error("No data rows found in the sheet.", { id: toastId });
          return;
        }
        const res = rates.length ? await uploadSupplierRatesAction(rates) : null;
        if (res && !res.success) {
          toast.error(res.error || "Failed to upload supplier prices.", { id: toastId });
          return;
        }
        toast.dismiss(toastId);
        const d = res?.data;
        setSupplierSummary({
          rate: d?.rate ?? 0,
          updated: d?.updated ?? [],
          added: d?.added ?? [],
          // Rows rejected while reading the sheet (no code, bad rate/date, repeated) are not matched too.
          notMatched: [
            ...errors.map((e) => ({ code: `Row ${e.row}`, reason: e.message })),
            ...(d?.notMatched ?? []),
          ],
          unchanged: d?.unchanged ?? 0,
        });
        void fetchData();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to read Excel file.", { id: toastId });
      }
    },
    [fetchData],
  );

  // Table filter lift (controlled like contract_review) for true cascading
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [multiFilters, setMultiFilters] = useState<Record<string, string[]>>(
    {},
  );
  const [batchFilters, setBatchFilters] = useState<Record<string, boolean>>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filterState = useMemo(
    () => ({
      columnFilters,
      multiFilters,
      batchFilters,
      dateFrom,
      dateTo,
      globalSearch,
      currentPage,
      pageSize,
    }),
    [
      columnFilters,
      multiFilters,
      batchFilters,
      dateFrom,
      dateTo,
      globalSearch,
      currentPage,
      pageSize,
    ],
  );

  const filterActions = useMemo(
    () => ({
      onColumnFilter: (header: string, value: string) =>
        setColumnFilters((prev) => ({ ...prev, [header]: value })),
      onMultiFilter: (header: string, values: string[]) =>
        setMultiFilters((prev) => {
          const next = { ...prev };
          if (values.length) next[header] = values;
          else delete next[header];
          return next;
        }),
      onBatchFilter: (key: string, value: boolean) =>
        setBatchFilters((prev) => {
          const next = { ...prev };
          if (value) next[key] = true;
          else delete next[key];
          return next;
        }),
      onDateFrom: setDateFrom,
      onDateTo: setDateTo,
      onGlobalSearch: setGlobalSearch,
      onResetFilters: () => {
        setColumnFilters({});
        setMultiFilters({});
        setBatchFilters({});
        setGlobalSearch("");
        setDateFrom("");
        setDateTo("");
      },
      onPageChange: setCurrentPage,
      onPageSizeChange: setPageSize,
    }),
    [],
  );

  // Dual cascading sidebar filters (Indian/Imported + Major/Minor)
  const [indianImported, setIndianImported] = useState<
    "all" | "indian" | "imported"
  >("all");
  const [majorFilter, setMajorFilter] = useState<"all" | "major" | "minor">(
    "all",
  );

  const scopedNewItems = useMemo(
    () =>
      newItems.filter((item) =>
        matchesSidebarItem(item, indianImported, majorFilter),
      ),
    [newItems, indianImported, majorFilter],
  );

  const scopedNewCost = useMemo(
    () => applyCastingCost(scopedNewItems, castingRates),
    [scopedNewItems, castingRates],
  );
  const scopedNewItemRows = useMemo(
    () => scopedNewCost.items.map(itemToRow),
    [scopedNewCost],
  );
  const scopedNewItemIds = useMemo(
    () => scopedNewCost.items.map((i) => i.id),
    [scopedNewCost],
  );

  const lockedCostIds = useMemo(
    () => new Set([...scopedNewCost.lockedIds, ...processedCost.lockedIds]),
    [scopedNewCost, processedCost],
  );

  // Base rows for sidebar = table-filtered newItems (respects column/multi/global filters)
  const sidebarBaseRows = useMemo(() => {
    const allRows = newItems.map(itemToRow);
    if (!headers.length) return allRows;
    return allRows.filter((row) =>
      matchesNewItemsTableFilters(
        row,
        headers,
        columnFilters,
        multiFilters,
        globalSearch,
        batchFilters,
      ),
    );
  }, [newItems, headers, columnFilters, multiFilters, globalSearch, batchFilters]);

  const cardStats = useMemo(
    () => computeCardStats(sidebarBaseRows, headers, indianImported, majorFilter),
    [sidebarBaseRows, headers, indianImported, majorFilter],
  );

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const handleUsdCostUpdate = useCallback(
    (id: string, usdCost: string) =>
      dispatch(updateGMDUsdCost({ id, usdCost })).unwrap(),
    [dispatch],
  );
  const handleNewItemsReset = useCallback(() => {
    setIndianImported("all");
    setMajorFilter("all");
  }, []);

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader
            totalRows={0}
            syncedAt={null}
            onSync={handleSync}
            syncing={false}
          />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader
            totalRows={0}
            syncedAt={null}
            onSync={handleSync}
            syncing={false}
          />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0 p-4 h-[calc(100vh-64px)]">
        <ResizablePanelGroup
          orientation="horizontal"
          id="raw-material-horizontal"
          defaultLayout={horizontalLayout}
          onLayoutChanged={onHorizontalLayoutChanged}
          className="h-full min-h-screen"
        >
          <ResizablePanel
            id="stock-value"
            defaultSize={240}
            minSize={180}
            maxSize={420}
          >
            <aside className="h-full w-full bg-[#0a2540] border border-[#1e3d59] dark:bg-card dark:border-border rounded-lg shadow-sm p-4 flex flex-col gap-3 overflow-y-auto">
              <span className="text-xs font-bold uppercase tracking-wider text-white dark:text-foreground">
                STOCK VALUE
              </span>

              {/* Not a toggle: the total of whatever the current filters leave
                  on screen, so it moves with them instead of filtering again. */}
              <div className="w-full bg-white/10 border border-white/25 rounded-lg p-3">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Total
                </span>
                <span className="block text-xl font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.total.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.total.count} item
                  {cardStats.total.count === 1 ? "" : "s"}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setIndianImported((s) => (s === "indian" ? "all" : "indian"))
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  indianImported === "indian"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Indian
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.indian.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.indian.count} item
                  {cardStats.indian.count === 1 ? "" : "s"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setIndianImported((s) =>
                    s === "imported" ? "all" : "imported",
                  )
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  indianImported === "imported"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Imported
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.imported.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.imported.count} item
                  {cardStats.imported.count === 1 ? "" : "s"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setMajorFilter((s) => (s === "major" ? "all" : "major"))
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  majorFilter === "major"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Major
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.major.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.major.count} item
                  {cardStats.major.count === 1 ? "" : "s"}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setMajorFilter((s) => (s === "minor" ? "all" : "minor"))
                }
                className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
                  majorFilter === "minor"
                    ? "border-[#38ef7d] dark:border-emerald-400/50 bg-white/10"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
                  Minor
                </span>
                <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
                  {fmt(cardStats.minor.sum)}
                </span>
                <span className="block text-[10px] font-medium text-white/50 mt-0.5">
                  {cardStats.minor.count} item
                  {cardStats.minor.count === 1 ? "" : "s"}
                </span>
              </button>
            </aside>
          </ResizablePanel>

          <ResizableHandle withHandle className="mx-2 bg-border" />

          <ResizablePanel id="content" minSize="40%">
            <div className="flex h-full flex-col min-h-0 min-w-0">
              <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleDownloadSupplierTemplate}>
                  Download supplier price template
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => supplierFileRef.current?.click()}>
                  Upload supplier prices
                </Button>
                <input
                  ref={supplierFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void handleUploadSupplierPrices(f);
                  }}
                />
              </div>
              <GMDUpdateHeader
                totalRows={totalRows}
                syncedAt={syncedAt}
                warnIfStale
                onSync={handleSync}
                syncing={syncing}
              />
              <div
                role="tablist"
                aria-label="Raw material tables"
                className="mt-4 flex gap-1 overflow-x-auto border-b border-border"
              >
                {RAW_MATERIAL_TABS.map((tab) => {
                  const isActive = tab.key === activeTab;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      id={`tab-${tab.key}`}
                      aria-selected={isActive}
                      aria-controls={`panel-${tab.key}`}
                      onClick={() => setActiveTab(tab.key)}
                      className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                        isActive
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {/* Panels stay mounted so each table keeps its filters and scroll when switching tabs. */}
              <div
                id="panel-new-items"
                role="tabpanel"
                aria-labelledby="tab-new-items"
                className={`mt-4 min-h-0 flex-1 flex-col ${activeTab === "new-items" ? "flex" : "hidden"}`}
              >
                  <GMDUpdateTable
                    headers={headers}
                    rows={scopedNewItemRows}
                    ids={scopedNewItemIds}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    title={`New Items (Blank Status)`}
                    // hiddenFilters={["NEW ITEM STATUS"]}
                    categoryOptions={enhancedCategoryOptions}
                    editable
                    fixedDropdownOptions={FIXED_DROPDOWN_OPTIONS}
                    editableColumns={NEW_ITEMS_EDITABLE_COLUMNS}
                    uniqueKeyColumns={UNIQUE_KEY_COLUMNS}
                    onCellUpdate={handleCellUpdate}
                    filterState={filterState}
                    filterActions={filterActions}
                    onReset={handleNewItemsReset}
                    externalFiltersActive={
                      indianImported !== "all" || majorFilter !== "all"
                    }
                    castingRateInputs={castingRateInputs}
                    lockedCostIds={lockedCostIds}
                    bomIdOptionsById={bomIdOptionsById}
                    onSelectBomId={handleSelectBomId}
                    usdInrRate={usdInrRate}
                    usdRateNote={usdRateNote}
                    onUsdCostUpdate={handleUsdCostUpdate}
                    onRefreshRate={refreshRate}
                    hiddenColumns={NEW_ITEMS_HIDDEN_COLUMNS}
                    cellBadges={ERP_CODE_BADGES}
                    batchFilterHeader="ERP ITEM CODE"
                    batchPresenceFilters={RAW_MATERIAL_BATCH_FILTERS}
                    warningRowIds={duplicateDerivedIds}
                    warningColumn="ITEM NAME (derived)"
                    fullHeight
                  />
              </div>

              <div
                id="panel-filtered-items"
                role="tabpanel"
                aria-labelledby="tab-filtered-items"
                className={`mt-4 min-h-0 flex-1 flex-col ${activeTab === "filtered-items" ? "flex" : "hidden"}`}
              >
                  <GMDUpdateTable
                    headers={headers}
                    rows={processedItemRows}
                    ids={processedItemIds}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    title="Filtered Items"
                    editable
                    categoryOptions={enhancedCategoryOptions}
                    uniqueKeyColumns={UNIQUE_KEY_COLUMNS}
                    onCellUpdate={handleCellUpdate}
                    lockedCostIds={lockedCostIds}
                    bomIdOptionsById={bomIdOptionsById}
                    onSelectBomId={handleSelectBomId}
                    usdInrRate={usdInrRate}
                    usdRateNote={usdRateNote}
                    onUsdCostUpdate={handleUsdCostUpdate}
                    onRefreshRate={refreshRate}
                    hiddenColumns={PROCESSED_ITEMS_HIDDEN_COLUMNS}
                    cellBadges={ERP_CODE_BADGES}
                    batchFilterHeader="ERP ITEM CODE"
                    batchPresenceFilters={RAW_MATERIAL_BATCH_FILTERS}
                    warningRowIds={duplicateDerivedIds}
                    warningColumn="ITEM NAME (derived)"
                    fullHeight
                  />
              </div>

              <div
                id="panel-transferred-items"
                role="tabpanel"
                aria-labelledby="tab-transferred-items"
                className={`mt-4 min-h-0 flex-1 flex-col ${activeTab === "transferred-items" ? "flex" : "hidden"}`}
              >
                  <GMDUpdateTable
                    headers={transferredHeaders}
                    rows={transferredRows}
                    ids={transferredItemIds}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                    title="Transferred Items"
                    editable
                    categoryOptions={transferredCategoryOptions}
                    fixedDropdownOptions={FIXED_DROPDOWN_OPTIONS}
                    filterOptionsOverride={transferredFilterOptions}
                    uniqueKeyColumns={UNIQUE_KEY_COLUMNS}
                    lockedCostIds={lockedCostIds}
                    bomIdOptionsById={bomIdOptionsById}
                    onSelectBomId={handleSelectBomId}
                    usdInrRate={usdInrRate}
                    usdRateNote={usdRateNote}
                    onUsdCostUpdate={handleUsdCostUpdate}
                    onRefreshRate={refreshRate}
                    hiddenColumns={TRANSFERRED_ITEMS_HIDDEN_COLUMNS}
                    cellBadges={ERP_CODE_BADGES}
                    batchFilterHeader="ERP ITEM CODE"
                    batchPresenceFilters={RAW_MATERIAL_BATCH_FILTERS}
                    warningRowIds={duplicateDerivedIds}
                    warningColumn="ITEM NAME (derived)"
                    onCellUpdate={handleTransferredCellUpdate}
                    pasteErpCodes={{
                      draft: pasteDraft,
                      setDraft: setPasteDraft,
                      onAdd: () => {
                        moveErpCodes(pasteDraft);
                        setPasteDraft("");
                      },
                      onPaste: (text) => {
                        moveErpCodes(text);
                        setPasteDraft("");
                      },
                    }}
                    onClearMoved={clearMoved}
                    onImportExcel={handleImportExcel}
                    onErpCodeChange={handleTransferredErpCodeChange}
                    attachmentColumn="Attachment"
                    onUploadAttachment={handleUploadAttachment}
                    onClearAttachment={handleClearAttachment}
                    onDeleteRow={handleDeleteTransferredRow}
                    onMatchCosts={handleStartMatchCosts}
                    fullHeight
                  />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <TransferCostMatchDialog
        open={matchOpen}
        proposals={matchProposals}
        onApply={handleApplyMatch}
        onClose={handleMatchClose}
      />
      <Dialog open={!!supplierSummary} onOpenChange={(o) => !o && setSupplierSummary(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Supplier price upload</DialogTitle>
            <DialogDescription>
              {supplierSummary?.rate ? `INR at live rate 1 USD = ₹${supplierSummary.rate}. ` : ""}
              Existing quotes are not re-costed.
            </DialogDescription>
          </DialogHeader>
          {supplierSummary && (
            <div className="space-y-3 text-sm">
              <section>
                <h4 className="font-semibold">Updated ({supplierSummary.updated.length})</h4>
                {supplierSummary.updated.map((u) => (
                  <p key={u.code}>
                    {u.code}: ${u.oldUsd ?? "-"} → ${u.newUsd} (₹{u.oldCost ?? "-"} → ₹{u.newCost})
                  </p>
                ))}
              </section>
              <section>
                <h4 className="font-semibold">Added ({supplierSummary.added.length})</h4>
                {supplierSummary.added.map((a) => (
                  <p key={a.code}>
                    {a.code}: ${a.newUsd} (₹{a.newCost})
                  </p>
                ))}
              </section>
              <section>
                <h4 className="font-semibold">Not matched ({supplierSummary.notMatched.length})</h4>
                {supplierSummary.notMatched.map((n, i) => (
                  <p key={i}>
                    {n.code}: {n.reason}
                  </p>
                ))}
              </section>
              <p>Unchanged: {supplierSummary.unchanged}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
