"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import { saveLedgerFollowUpAction } from "@/app/actions/ledgerFollowUp";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import { GROUP_LABELS, buildCreditorParties } from "@/lib/creditors";
import type { AdvanceRow, CreditorParty, CreditorRow, VendorGroup } from "@/lib/creditors";
import { BUCKETS, daysOverdue, effectiveDueDate, formatLakh } from "@/lib/debtorsAgeing";
import type { Bucket } from "@/lib/debtorsAgeing";
import { CREDITOR_PREFS_KEY, DEFAULT_CREDITOR_PREFS, dateSort, loadPrefs, numericSort, savePrefs, textSort, toAmount, toTime } from "@/lib/tablePrefs";
import type { TablePrefs } from "@/lib/tablePrefs";
import { formatIndianNumber } from "@/lib/formatCurrency";
import { EMPTY_FOLLOW_UP, downloadCsv, followUpFor, toCsv } from "@/lib/debtorJoins";
import type { FollowUp } from "@/lib/debtorJoins";
import { CREDITOR_STATUSES } from "@/lib/ledgerFollowUp";

const FOLLOW_UP_COLS: { field: keyof FollowUp; label: string; type?: "date" }[] = [
  { field: "owner", label: "Accounts owner" },
  { field: "contactName", label: "Contact name" },
  { field: "contactPhone", label: "Contact phone" },
  { field: "contactEmail", label: "Contact email" },
  { field: "lastFollowUp", label: "Last follow-up", type: "date" },
  { field: "promisedDate", label: "Promised date", type: "date" },
  { field: "promisedAmount", label: "Promised amount" },
  { field: "status", label: "Follow-up status" },
  { field: "remarks", label: "Remarks" },
];

type PartyRow = CreditorParty & { follow: FollowUp };

// Sorting only: cells are rendered by hand below, in this same column order.
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { numeric: numericSort, date: dateSort, text: textSort } });
const col = createColumnHelper<typeof features, PartyRow>();
const amount = (id: string, header: string, get: (p: PartyRow) => number) => col.accessor(get, { id, header, sortFn: "numeric" });
const textCol = (id: string, header: string, get: (p: PartyRow) => string | null | undefined) =>
  col.accessor((p) => get(p) || undefined, { id, header, sortFn: "text", sortUndefined: "last" });
const COLUMNS = col.columns([
  textCol("party", "Party", (p) => p.accName),
  textCol("schedule", "Schedule", (p) => p.schedule),
  amount("totalDues", "Bills", (p) => p.totalDues),
  amount("credits", "Advances", (p) => p.credits),
  amount("net", "Net payable", (p) => p.net),
  amount("overdue", "Overdue", (p) => p.overdue),
  ...BUCKETS.map((b) => amount(b, b === "Not due" ? b : `${b} days`, (p) => p.buckets[b])),
  col.accessor((p) => toTime(p.oldestDue), { id: "oldestDue", header: "Oldest bill due", sortFn: "date", sortUndefined: "last" }),
  ...FOLLOW_UP_COLS.map((c) =>
    c.type === "date"
      ? col.accessor((p) => toTime(p.follow[c.field]), { id: c.field, header: c.label, sortFn: "date", sortUndefined: "last" })
      : c.field === "promisedAmount"
        ? col.accessor((p) => toAmount(p.follow[c.field]), { id: c.field, header: c.label, sortFn: "numeric", sortUndefined: "last" })
        : textCol(c.field, c.label, (p) => p.follow[c.field]),
  ),
]);
const RIGHT_ALIGNED = new Set<string>(["totalDues", "credits", "net", "overdue", ...BUCKETS]);
const GROUPS = Object.keys(GROUP_LABELS) as VendorGroup[];

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const TH = "border-r border-border px-3 py-2.5 text-[13px] font-semibold text-foreground whitespace-normal break-words align-bottom";
const TD = "border-r border-border px-3 py-2 text-right tabular-nums";
const bucketTone = (b: Bucket) => (b === "31-60" ? "text-amber-700 dark:text-amber-400" : b === "61-90" || b === "91-180" || b === "180+" ? "text-red-700 dark:text-red-400" : "");
const STICKY_PARTY = "sticky left-0 z-10 bg-inherit";
const INPUT = "w-full min-w-[120px] rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-primary";

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${danger ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

interface Props {
  rows: CreditorRow[];
  advances: AdvanceRow[];
  names: Record<string, string>;
  followUps: Record<string, FollowUp>;
}

export default function CreditorsTable({ rows, advances, names, followUps }: Props) {
  const [prefs, setPrefs] = useState<TablePrefs>(DEFAULT_CREDITOR_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [follow, setFollow] = useState(followUps);

  // Read saved prefs after mount so server and client render the same first paint.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(loadPrefs(CREDITOR_PREFS_KEY));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) savePrefs(CREDITOR_PREFS_KEY, prefs);
  }, [hydrated, prefs]);

  const search = prefs.filters.search ?? "";
  const overdueOnly = !!prefs.filters.overdueOnly;
  const group = prefs.filters.group === "all" || GROUPS.includes(prefs.filters.group as VendorGroup) ? (prefs.filters.group as VendorGroup | "all") : "local";
  const schedule = prefs.filters.schedule ?? "";
  // the group filter always stores a value ("local" is the default view, so "all" must be stored explicitly)
  const setFilter = (k: string, v: string) =>
    setPrefs((p) => {
      const filters = { ...p.filters };
      if (v) filters[k] = v;
      else delete filters[k];
      return { ...p, filters };
    });
  const fmt = prefs.amountFormat === "lakh" ? formatLakh : (n: number) => `${n < 0 ? "-" : ""}₹${formatIndianNumber(Math.abs(n))}`;

  // Optimistic: show the edit now, put the old value back and toast if the save fails.
  const saveFollowUp = async (accCode: string, field: keyof FollowUp, value: string) => {
    const prev = follow[accCode];
    const next = { ...EMPTY_FOLLOW_UP, ...prev, [field]: value.trim() || null };
    setFollow((m) => ({ ...m, [accCode]: next }));
    const res = await saveLedgerFollowUpAction({ ledger: "creditor", accCode, ...next });
    if (!res.success) {
      setFollow((m) => {
        const rest = { ...m };
        if (prev) rest[accCode] = prev;
        else delete rest[accCode];
        return rest;
      });
      toast.error(res.error ?? "Could not save the follow-up.");
    }
  };

  const today = useMemo(() => new Date(), []);
  const all = useMemo(() => buildCreditorParties(rows, advances, today, new Map(Object.entries(names))).parties, [rows, advances, names, today]);
  const schedules = useMemo(() => [...new Set(all.map((p) => p.schedule).filter((s): s is string => !!s))].sort(), [all]);

  // customs / labour / import are tabs of their own; only "All" mixes them with local vendors
  const groupNet = useMemo(() => {
    const m: Record<string, number> = { all: 0 };
    for (const p of all) {
      m[p.group] = (m[p.group] ?? 0) + p.net;
      m.all += p.net;
    }
    return m;
  }, [all]);

  const inGroup = useMemo(() => all.filter((p) => group === "all" || p.group === group), [all, group]);
  const filtered = useMemo<PartyRow[]>(() => {
    const needle = squish(search);
    return inGroup
      .filter((p) => (!needle || squish(`${p.accName} ${p.accCode}`).includes(needle)) && (!schedule || p.schedule === schedule) && (!overdueOnly || p.overdue > 0))
      .map((p) => ({ ...p, follow: { ...EMPTY_FOLLOW_UP, ...followUpFor(follow, p.accCode) } }));
  }, [inGroup, follow, search, schedule, overdueOnly]);

  const table = useTable({
    features,
    columns: COLUMNS,
    data: filtered,
    state: { sorting: prefs.sorting },
    onSortingChange: (u) => setPrefs((p) => ({ ...p, sorting: typeof u === "function" ? u(p.sorting) : u })),
  });
  const sortedRows = table.getRowModel().rows;
  const parties = useMemo(() => sortedRows.map((r) => r.original), [sortedRows]);
  const sumOf = (list: CreditorParty[], get: (p: CreditorParty) => number) => list.reduce((t, p) => t + get(p), 0);

  const bills = useMemo(() => {
    if (!open) return [];
    return rows
      .filter((r) => r.accCode === open && (r.unAllocCr ?? 0) !== 0)
      .map((r) => ({ r, days: daysOverdue(effectiveDueDate(r.dueDate, r.vrDate), today) }))
      .sort((a, b) => (b.days ?? -1e9) - (a.days ?? -1e9));
  }, [rows, open, today]);
  const openAdvances = useMemo(() => (open ? advances.filter((a) => a.accCode === open && (a.unAllocDr ?? 0) !== 0) : []), [advances, open]);

  // exports exactly what is on screen: `parties` is already filtered and in the current sort order
  const exportParties = () =>
    downloadCsv(
      "creditors_party_wise.csv",
      toCsv(
        ["Party", "Group", "Schedule", "Bills", "Advances", "Net payable", "Overdue", ...BUCKETS, "Oldest bill due", "Advance not adjusted", ...FOLLOW_UP_COLS.map((c) => c.label)],
        parties.map((p) => [p.accName, GROUP_LABELS[p.group], p.schedule, p.totalDues, p.credits, p.net, p.overdue, ...BUCKETS.map((b) => p.buckets[b]), formatDate(p.oldestDue), p.advanceNotAdjusted ? "Yes" : "", ...FOLLOW_UP_COLS.map((c) => p.follow[c.field])]),
      ),
    );

  if (rows.length === 0 && advances.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center">
        <Wallet className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium text-muted-foreground">No creditors data synced yet.</p>
      </div>
    );
  }

  const span = 6 + BUCKETS.length + 1 + FOLLOW_UP_COLS.length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="flex flex-wrap gap-2">
        {(["all", ...GROUPS] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setFilter("group", g)}
            className={`rounded-lg border px-3 py-1.5 text-left text-sm ${group === g ? "border-primary bg-primary/10" : "border-border bg-card"}`}
          >
            <span className="font-semibold">{g === "all" ? "All" : GROUP_LABELS[g]}</span>{" "}
            <span className="tabular-nums text-muted-foreground">{fmt(groupNet[g] ?? 0)}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile label="Total bills" value={fmt(sumOf(inGroup, (p) => p.totalDues))} />
        <Tile label="Advances" value={fmt(sumOf(inGroup, (p) => p.credits))} />
        <Tile label="Net payable" value={fmt(sumOf(inGroup, (p) => p.net))} />
        <Tile label="Overdue" value={fmt(sumOf(inGroup, (p) => p.overdue))} danger />
        <Tile label="180+ days" value={fmt(sumOf(inGroup, (p) => p.buckets["180+"]))} danger />
        <Tile label="No. of parties" value={String(inGroup.length)} />
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Party-wise payables</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{parties.length} parties</span>
          <select aria-label="Filter by schedule" value={schedule} onChange={(e) => setFilter("schedule", e.target.value)} className="rounded border border-border bg-card px-2 py-1 text-sm">
            <option value="">All schedules</option>
            {schedules.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setFilter("overdueOnly", e.target.checked ? "1" : "")} />
            Overdue only
          </label>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => setPrefs((p) => ({ ...p, amountFormat: p.amountFormat === "lakh" ? "full" : "lakh" }))}>
            {prefs.amountFormat === "lakh" ? "₹ L" : "₹"}
          </button>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={exportParties}>Download CSV</button>
          <div className="w-full sm:ml-auto sm:w-72">
            <DebouncedSearchInput value={search} onCommit={(v) => setFilter("search", v)} placeholder="Search party name or code" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="select-none">
              {table.getHeaderGroups().map((g) => (
                <tr key={g.id}>
                  {g.headers.map((h) => {
                    const sorted = h.column.getIsSorted();
                    const idx = prefs.sorting.length > 1 ? h.column.getSortIndex() + 1 : 0;
                    return (
                      <th
                        key={h.id}
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                        className={`${TH} sticky top-0 border-b bg-muted ${h.column.id === "party" ? "left-0 z-30 min-w-[160px]" : "z-20"} ${RIGHT_ALIGNED.has(h.column.id) ? "text-right" : ""}`}
                      >
                        <button type="button" title="Click to sort, shift-click to add a second sort" onClick={h.column.getToggleSortingHandler()} className="font-semibold hover:underline">
                          <table.FlexRender header={h} />
                          {sorted && <span className="ml-1">{sorted === "asc" ? "▲" : "▼"}{idx > 0 && <sup className="text-xs">{idx}</sup>}</span>}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border/60">
              {parties.map((p, i) => (
                <Fragment key={p.accCode}>
                  <tr className={`cursor-pointer hover:bg-accent ${i % 2 ? "bg-muted" : "bg-card"}`} onClick={() => setOpen(open === p.accCode ? null : p.accCode)}>
                    <td className={`${STICKY_PARTY} border-r border-border px-3 py-2 font-medium`}>
                      {open === p.accCode ? "▾" : "▸"} {p.accName}
                      {p.advanceNotAdjusted && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Advance not adjusted</span>}
                      {p.totalDues === 0 && p.credits > 0 && <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">Recover / adjust</span>}
                    </td>
                    <td className="border-r border-border px-3 py-2">{p.schedule ?? "-"}</td>
                    <td className={TD}>{fmt(p.totalDues)}</td>
                    <td className={TD}>{p.credits ? fmt(p.credits) : "-"}</td>
                    <td className={`${TD} font-semibold ${p.net < 0 ? "text-green-700" : ""}`}>{fmt(p.net)}</td>
                    <td className={TD}>{fmt(p.overdue)}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={`${TD} ${p.buckets[b] > 0 && bucketTone(b) ? `font-semibold ${bucketTone(b)}` : ""}`}>
                        {p.buckets[b] ? fmt(p.buckets[b]) : "-"}
                      </td>
                    ))}
                    <td className="border-r border-border px-3 py-2">{formatDate(p.oldestDue)}</td>
                    {FOLLOW_UP_COLS.map((c) => {
                      const v = p.follow[c.field] ?? "";
                      return (
                        <td key={c.field} className="border-r border-border px-1 py-1" onClick={(e) => e.stopPropagation()}>
                          {c.field === "status" ? (
                            <select key={v} defaultValue={v} aria-label={c.label} className={INPUT} onChange={(e) => saveFollowUp(p.accCode, c.field, e.target.value)}>
                              <option value="">-</option>
                              {CREDITOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : (
                            <input
                              key={v}
                              type={c.type ?? "text"}
                              defaultValue={v}
                              aria-label={c.label}
                              className={INPUT}
                              onBlur={(e) => e.target.value.trim() !== v && saveFollowUp(p.accCode, c.field, e.target.value)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {open === p.accCode && (
                    <tr>
                      <td colSpan={span} className="bg-muted/20 p-3">
                        <table className="w-full border-collapse text-[13px]">
                          <thead>
                            <tr>
                              {["VRNO", "Party bill no", "Party bill date", "Voucher date", "Due date", "Amount", "Days overdue"].map((h, i) => (
                                <th key={h} className={`${TH} ${i >= 5 ? "text-right" : ""}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {bills.map(({ r, days }) => (
                              <tr key={r.id}>
                                <td className="px-3 py-1.5">{r.vrNo ?? "-"}</td>
                                <td className="px-3 py-1.5">{r.partyBillNo ?? "-"}</td>
                                <td className="px-3 py-1.5">{formatDate(r.partyBillDate)}</td>
                                <td className="px-3 py-1.5">{formatDate(r.vrDate)}</td>
                                <td className="px-3 py-1.5">{formatDate(r.dueDate)}{!r.dueDate && r.vrDate ? " (voucher date)" : ""}</td>
                                <td className={TD}>{formatIndianNumber(r.unAllocCr, 2)}</td>
                                <td className={`${TD} ${days !== null && days > 45 ? "font-semibold text-red-700" : days !== null && days > 30 ? "font-semibold text-amber-700" : ""}`}>{days ?? "-"}</td>
                              </tr>
                            ))}
                            {openAdvances.map((a) => (
                              <tr key={a.id} className="text-green-700">
                                <td className="px-3 py-1.5">{a.vrNo ?? "-"}</td>
                                <td className="px-3 py-1.5" colSpan={2}>Advance {a.particular ?? a.narration ?? ""}</td>
                                <td className="px-3 py-1.5">{formatDate(a.vrDate)}</td>
                                <td className="px-3 py-1.5">-</td>
                                <td className={TD}>-{formatIndianNumber(a.unAllocDr, 2)}</td>
                                <td className={TD}>-</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {parties.length === 0 && (
                <tr>
                  <td colSpan={span} className="py-12 text-center text-sm text-muted-foreground">No parties match the filters.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className="sticky bottom-0 left-0 z-20 border-r border-t-2 border-border bg-muted px-3 py-2">Total ({parties.length} parties)</td>
                <td className="sticky bottom-0 border-t-2 border-border bg-muted" />
                {[sumOf(parties, (p) => p.totalDues), sumOf(parties, (p) => p.credits), sumOf(parties, (p) => p.net), sumOf(parties, (p) => p.overdue), ...BUCKETS.map((b) => sumOf(parties, (p) => p.buckets[b]))].map((v, i) => (
                  <td key={i} className={`${TD} sticky bottom-0 border-t-2 bg-muted`}>{fmt(v)}</td>
                ))}
                <td colSpan={1 + FOLLOW_UP_COLS.length} className="sticky bottom-0 border-t-2 border-border bg-muted" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
