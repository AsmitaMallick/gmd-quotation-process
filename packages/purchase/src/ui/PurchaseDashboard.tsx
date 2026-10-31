"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@gmd/ui/components/table";
import { Button } from "@gmd/ui/components/button";
import Pagination from "@gmd/dashboard/components/Pagination";
import DebouncedSearchInput from "@gmd/dashboard/components/DebouncedSearchInput";
import { isSyncStale } from "@gmd/dashboard/lib/syncStale";
import {
  HEADER_TO_FIELD,
  NUMERIC_HEADERS,
  type PurchaseHeader,
  type PurchaseRow,
} from "../columns";
import { balanceDisagrees, overReceived } from "../lib/inTransit";
import { columnAccess, type PurchaseFlags } from "../flags";
import type { PurchaseActions, PurchasePage, PurchaseView } from "../types";

/**
 * Purchase dashboard: open purchase order lines and the material they have in
 * transit, tagged to the sales contract each was raised against.
 *
 * **The table never empties on a failure.** A failed reload leaves the last
 * rows on screen with a banner saying when they were loaded, because a buyer
 * reading slightly old numbers is better served than one staring at an error
 * where the data used to be.
 */
export function PurchaseDashboard({
  actions,
  flags,
  title = "Purchase",
}: {
  actions: PurchaseActions;
  flags: PurchaseFlags;
  title?: string;
}) {
  const access = columnAccess(flags);
  const headers = access.visibleHeaders();

  const [view, setView] = useState<PurchaseView>({
    openOnly: flags.openOnlyByDefault,
    page: 1,
    pageSize: 50,
  });
  const [data, setData] = useState<PurchasePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** When the rows on screen were actually fetched. Null until the first success. */
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  // Drops a slow response that lost the race to a newer one.
  const requestId = useRef(0);

  const load = useCallback(
    async (next: PurchaseView) => {
      const id = ++requestId.current;
      setLoading(true);
      const result = await actions.loadView(next);
      if (id !== requestId.current) return;
      if (result.success) {
        setData(result.data);
        setLoadedAt(new Date());
        setError(null);
      } else {
        // Keep `data` as it is: stale rows beat no rows.
        setError(result.error);
      }
      setLoading(false);
    },
    [actions],
  );

  useEffect(() => {
    void load(view);
  }, [load, view]);

  const summary = data?.summary;
  const rows = data?.rows ?? [];
  const syncStale = isSyncStale(data?.syncedAt);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold mr-auto">{title}</h1>

        <DebouncedSearchInput
          value={view.search ?? ""}
          onCommit={(search: string) => setView((v) => ({ ...v, search, page: 1 }))}
          placeholder="PO, item, supplier, contract…"
        />

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={view.openOnly ?? false}
            onChange={(e) => setView((v) => ({ ...v, openOnly: e.target.checked, page: 1 }))}
          />
          Open lines only
        </label>

        <Button variant="outline" size="sm" onClick={() => void load(view)} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          Refresh
        </Button>
      </header>

      {(error || syncStale) && (
        <div className="flex items-start gap-2 px-4 py-2 text-sm bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            {error && (
              <p>
                Could not refresh{loadedAt ? `, showing data from ${loadedAt.toLocaleTimeString()}` : ""}.{" "}
                <span className="opacity-80">{error}</span>
              </p>
            )}
            {!error && syncStale && (
              <p>
                The purchase sync has not run in over a day
                {data?.syncedAt ? ` (last run ${new Date(data.syncedAt).toLocaleString()})` : ""}.
              </p>
            )}
          </div>
        </div>
      )}

      {summary && access.showSection("inTransit") && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border border-b border-border">
          <Tile label="Lines" value={summary.lineCount.toLocaleString("en-IN")} />
          <Tile label="Open lines" value={summary.openLineCount.toLocaleString("en-IN")} />
          <Tile label="In transit (qty)" value={formatQty(summary.inTransitQty)} />
          <Tile label="In transit (value)" value={formatMoney(summary.inTransitValue)} />
          {access.showSection("byContract") && (
            <Tile label="Contracts awaiting" value={summary.contractCount.toLocaleString("en-IN")} />
          )}
          {access.showSection("dataHealth") && (
            <Tile
              label="Untagged open lines"
              value={summary.untaggedLineCount.toLocaleString("en-IN")}
              hint={
                summary.disagreeingLineCount > 0
                  ? `${summary.disagreeingLineCount} line(s) where BALANCE disagrees with ordered − received`
                  : undefined
              }
            />
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              {headers.map((h) => (
                <TableHead key={h} className={NUMERIC_HEADERS.has(h) ? "text-right" : undefined}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={headers.length} className="text-center text-muted-foreground py-8">
                  {error ? "No rows loaded yet." : "No purchase lines match this view."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id} className={rowTone(row)}>
                {headers.map((h) => (
                  <TableCell key={h} className={NUMERIC_HEADERS.has(h) ? "text-right tabular-nums" : undefined}>
                    {renderCell(row, h)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && (
        <div className="border-t border-border">
          <Pagination
            total={data.total}
            currentPage={data.page}
            pageSize={data.pageSize}
            onPageChange={(page: number) => setView((v) => ({ ...v, page }))}
            onPageSizeChange={(pageSize: number) => setView((v) => ({ ...v, pageSize, page: 1 }))}
          />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-background px-4 py-3" title={hint}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{hint}</div>}
    </div>
  );
}

/** Amber for a line whose numbers do not agree; red for one received over order. */
function rowTone(row: PurchaseRow): string | undefined {
  if (overReceived(row)) return "bg-red-50 dark:bg-red-950/30";
  if (balanceDisagrees(row)) return "bg-amber-50 dark:bg-amber-950/30";
  return undefined;
}

function renderCell(row: PurchaseRow, header: PurchaseHeader): string {
  if (header === "IN TRANSIT") {
    // The stored derived number, so the cell always matches what the totals counted.
    return row.inTransit === null ? "—" : formatQty(row.inTransit);
  }
  if (header === "VALUE") {
    return row.lineValue === null ? "—" : formatMoney(row.lineValue);
  }
  if (header === "PARTY REF") {
    return [row.partyRefNo, row.partyRefDate].filter(Boolean).join(" · ") || "—";
  }
  const value = row[HEADER_TO_FIELD[header]];
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function formatQty(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default PurchaseDashboard;
