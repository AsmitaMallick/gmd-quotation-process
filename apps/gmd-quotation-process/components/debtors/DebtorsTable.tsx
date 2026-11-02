"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { User } from "lucide-react";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { toast } from "sonner";
import { saveLedgerFollowUpAction } from "@/app/actions/ledgerFollowUp";
import { saveLegalCaseAction } from "@/app/actions/partyLegalCase";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import type { DebtorRow, DebtorTotals } from "@/lib/debtors";
import { BUCKETS, bucketOf, daysOverdue, formatLakh, outstanding, summarise } from "@/lib/debtorsAgeing";
import type { Bucket, PartyAgeing } from "@/lib/debtorsAgeing";
import { DEBTOR_PREFS_KEY, DEFAULT_DEBTOR_PREFS, dateSort, loadPrefs, numericSort, savePrefs, textSort, toAmount, toTime } from "@/lib/tablePrefs";
import type { TablePrefs } from "@/lib/tablePrefs";
import { LEGAL_STATUSES, isUnderLitigation, resolveProvision, splitDues } from "@/lib/legalStatus";
import type { LegalCaseView } from "@/lib/legalStatus";
import { formatIndianNumber } from "@/lib/formatCurrency";
import { EMPTY_FOLLOW_UP, bgExposureByName, bgFor, billInfoFor, creditNoteRefOf, creditNotesByBill, downloadCsv, followUpFor, toCsv } from "@/lib/debtorJoins";
import type { BgRow, BillInfo, FollowUp } from "@/lib/debtorJoins";
import { dueToday, partyMsme } from "@/lib/msme";
import type { MsmeSettings, PartyMsme } from "@/lib/msme";

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
  { field: "creditDays", label: "Agreed credit days" },
  { field: "clientType", label: "Client type" },
  { field: "udyamOnInvoice", label: "Udyam on invoice" },
  { field: "nextActionDate", label: "Next action date", type: "date" },
  { field: "samadhaanNo", label: "Samadhaan case no." },
  { field: "samadhaanStatus", label: "Samadhaan status" },
];
// Computed, read-only, rendered right after the BG column. "Promise vs paid" is a column, not a view.
// shortcut: there is no receipts feed, so "paid" is inferred from dues still overdue after the promised date, upgrade when receipts are synced
const MSME_COLS = [["msmeStage", "Follow-up stage"], ["msmeDays", "Days past MSME due"], ["msmeInterest", "MSME interest"], ["msmeClaimable", "Claimable (dues + interest)"], ["promiseVsPaid", "Promise vs paid"]] as const;
type View = "all" | "today" | "breach" | "stage";
const VIEWS: [View, string][] = [["all", "All parties"], ["today", "Due today"], ["breach", "MSME breach list"], ["stage", "Ageing by stage"]];
const promiseState = (p: { follow: FollowUp; overdue: number }, startOfToday: number) =>
  (toTime(p.follow.promisedDate) ?? Infinity) < startOfToday && p.overdue > 0 ? "Missed" : p.follow.promisedDate || p.follow.promisedAmount ? "Pending" : null;

const EMPTY_LEGAL: LegalCaseView = { status: null, forum: null, caseNo: null, filingDate: null, nextHearingDate: null, advocate: null, claimAmount: null, interestClaimed: null, provisionPct: null, provisionAmount: null, documentLink: null, lastUpdate: null };
const LEGAL_COLS: { field: keyof LegalCaseView; label: string; type?: "date" | "number" }[] = [
  { field: "status", label: "Legal status" },
  { field: "forum", label: "Forum" },
  { field: "caseNo", label: "Case no." },
  { field: "filingDate", label: "Filing date", type: "date" },
  { field: "nextHearingDate", label: "Next hearing", type: "date" },
  { field: "advocate", label: "Advocate" },
  { field: "claimAmount", label: "Claim amount", type: "number" },
  { field: "interestClaimed", label: "Interest claimed", type: "number" },
  { field: "provisionPct", label: "Provision %", type: "number" },
  { field: "provisionAmount", label: "Provision amount", type: "number" },
  { field: "documentLink", label: "Document link" },
  { field: "lastUpdate", label: "Legal last update" },
];

type PartyRow = PartyAgeing & { bg: number; follow: FollowUp; legal: LegalCaseView; msme: PartyMsme; promise: string | null };

// Sorting only: cells are still rendered by hand below, in this same column order.
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { numeric: numericSort, date: dateSort, text: textSort } });
const col = createColumnHelper<typeof features, PartyRow>();
const amount = (id: string, header: string, get: (p: PartyRow) => number) => col.accessor(get, { id, header, sortFn: "numeric" });
const textCol = (id: string, header: string, get: (p: PartyRow) => string | null | undefined) =>
  col.accessor((p) => get(p) || undefined, { id, header, sortFn: "text", sortUndefined: "last" });
const COLUMNS = col.columns([
  textCol("party", "Party", (p) => p.accName),
  amount("totalDues", "Total dues", (p) => p.totalDues),
  amount("overdue", "Overdue", (p) => p.overdue),
  ...BUCKETS.map((b) => amount(b, b === "Not due" ? b : `${b} days`, (p) => p.buckets[b])),
  amount("credits", "Unadjusted credit", (p) => p.credits),
  amount("net", "Net (dues minus credits)", (p) => p.net),
  amount("bg", "BG exposure (open BGs)", (p) => p.bg),
  col.accessor((p) => p.msme.stage ?? undefined, { id: "msmeStage", header: "Follow-up stage", sortFn: "numeric", sortUndefined: "last" }),
  col.accessor((p) => p.msme.daysPastDue ?? undefined, { id: "msmeDays", header: "Days past MSME due", sortFn: "numeric", sortUndefined: "last" }),
  amount("msmeInterest", "MSME interest", (p) => p.msme.interest),
  amount("msmeClaimable", "Claimable (dues + interest)", (p) => p.msme.claimable),
  textCol("promiseVsPaid", "Promise vs paid", (p) => p.promise),
  ...FOLLOW_UP_COLS.map((c) =>
    c.type === "date"
      ? col.accessor((p) => toTime(p.follow[c.field]), { id: c.field, header: c.label, sortFn: "date", sortUndefined: "last" })
      : c.field === "promisedAmount" || c.field === "creditDays"
        ? col.accessor((p) => toAmount(p.follow[c.field]), { id: c.field, header: c.label, sortFn: "numeric", sortUndefined: "last" })
        : textCol(c.field, c.label, (p) => p.follow[c.field]),
  ),
  ...LEGAL_COLS.map((c) =>
    c.type === "date"
      ? col.accessor((p) => toTime(p.legal[c.field]), { id: c.field, header: c.label, sortFn: "date", sortUndefined: "last" })
      : c.type === "number"
        ? col.accessor((p) => toAmount(p.legal[c.field]), { id: c.field, header: c.label, sortFn: "numeric", sortUndefined: "last" })
        : textCol(c.field, c.label, (p) => p.legal[c.field]),
  ),
]);
const RIGHT_ALIGNED = new Set<string>(["totalDues", "overdue", ...BUCKETS, "credits", "net", "bg", "msmeDays", "msmeInterest", "msmeClaimable"]);

interface DebtorsTableProps {
  rows: DebtorRow[];
  totals: DebtorTotals;
  billInfo: Record<string, BillInfo>;
  bgs: BgRow[];
  followUps: Record<string, FollowUp>;
  legalCases: Record<string, LegalCaseView>;
  msme: MsmeSettings;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const TH = "border-r border-border px-3 py-2.5 text-[13px] font-semibold text-foreground whitespace-normal break-words align-bottom";
const TD = "border-r border-border px-3 py-2 text-right tabular-nums";
// shortcut: buckets are 31-60 / 61+, not split at 45, so amber covers 31-60 and red starts at 61, upgrade when the buckets are re-cut at 45
const bucketTone = (b: Bucket) => (b === "31-60" ? "text-amber-700 dark:text-amber-400" : b === "61-90" || b === "91-180" || b === "180+" ? "text-red-700 dark:text-red-400" : "");
const STICKY_PARTY = "sticky left-0 z-10 bg-inherit";

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${danger ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

const DOC_LINKS = [
  ["orderCopy", "Order copy"],
  ["invoice", "Invoice"],
  ["inspectionReport", "Inspection"],
  ["driveLink", "Drive"],
] as const;

function LegalCells({ p, onSave }: { p: PartyRow; onSave: (accCode: string, field: keyof LegalCaseView, value: string) => void }) {
  return (
    <>
      {LEGAL_COLS.map((c) => {
        const v = p.legal[c.field] ?? "";
        return (
          <td key={c.field} className="border-r border-border px-1 py-1" onClick={(e) => e.stopPropagation()}>
            {c.field === "status" ? (
              <select aria-label={c.label} value={v} className="w-full min-w-[150px] rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border" onChange={(e) => onSave(p.accCode, c.field, e.target.value)}>
                <option value="">-</option>
                {LEGAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input
                key={v}
                type={c.type === "date" ? "date" : "text"}
                inputMode={c.type === "number" ? "decimal" : undefined}
                defaultValue={v}
                aria-label={c.label}
                className="w-full min-w-[120px] rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-primary"
                onBlur={(e) => e.target.value.trim() !== v && onSave(p.accCode, c.field, e.target.value)}
              />
            )}
          </td>
        );
      })}
    </>
  );
}

function DocLinks({ info }: { info?: BillInfo }) {
  const links = DOC_LINKS.map(([k, label]) => [label, info?.[k]] as const).filter(([, v]) => v);
  if (links.length === 0) return <>-</>;
  return (
    <>
      {links.map(([label, v]) =>
        /^https?:\/\//i.test(v!) ? (
          <a key={label} href={v!} target="_blank" rel="noreferrer" className="mr-2 text-primary underline">{label}</a>
        ) : (
          <span key={label} className="mr-2">{label}: {v}</span>
        ),
      )}
    </>
  );
}

export default function DebtorsTable({ rows, billInfo, bgs, followUps, legalCases, msme }: DebtorsTableProps) {
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [view, setView] = useState<View>("all");
  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<TablePrefs>(DEFAULT_DEBTOR_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [follow, setFollow] = useState(followUps);
  const [legal, setLegal] = useState(legalCases);

  // Read saved prefs after mount (not in the initial state) so server and client render the same first paint.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(loadPrefs(DEBTOR_PREFS_KEY));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) savePrefs(DEBTOR_PREFS_KEY, prefs);
  }, [hydrated, prefs]);

  const search = prefs.filters.search ?? "";
  const owner = prefs.filters.owner ?? "";
  const overdueOnly = !!prefs.filters.overdueOnly;
  const over45 = !!prefs.filters.over45;
  const broken = !!prefs.filters.broken;
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
    const res = await saveLedgerFollowUpAction({ ledger: "debtor", accCode, ...next });
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

  const saveLegal = async (accCode: string, field: keyof LegalCaseView, value: string) => {
    const prev = legal[accCode];
    const next = { ...EMPTY_LEGAL, ...prev, [field]: value.trim() || null };
    setLegal((m) => ({ ...m, [accCode]: next }));
    const res = await saveLegalCaseAction({ ledger: "debtor", accCode, ...next });
    if (!res.success) {
      setLegal((m) => {
        const rest = { ...m };
        if (prev) rest[accCode] = prev;
        else delete rest[accCode];
        return rest;
      });
      toast.error(res.error ?? "Could not save the legal details.");
    }
  };

  const today = useMemo(() => new Date(), []);
  const summary = useMemo(() => summarise(rows, today), [rows, today]);

  const bgMap = useMemo(() => bgExposureByName(bgs), [bgs]);
  const split = useMemo(() => splitDues(summary.parties, new Map(Object.entries(legal))), [summary, legal]);

  const owners = useMemo(() => [...new Set(Object.values(follow).map((f) => f.owner).filter((o): o is string => !!o))].sort(), [follow]);

  // shortcut: re-sorts as soon as an edited cell is saved (a row can jump after editing the sorted column), upgrade by freezing order while an input is focused
  const openBills = useMemo(() => {
    const m = new Map<string, { bal: number; vrDate: string | null }[]>();
    for (const r of rows) {
      const bal = outstanding(r);
      if (bal > 0) m.set(r.accCode, [...(m.get(r.accCode) ?? []), { bal, vrDate: r.vrDate }]);
    }
    return m;
  }, [rows]);
  const withExtras = useMemo<PartyRow[]>(() => {
    const startOfToday = new Date(today).setHours(0, 0, 0, 0);
    return summary.parties.map((p) => {
      const f = { ...EMPTY_FOLLOW_UP, ...followUpFor(follow, p.accCode) };
      const l = { ...EMPTY_LEGAL, ...legal[p.accCode] };
      const promise = promiseState({ follow: f, overdue: p.overdue }, startOfToday);
      const cd = f.creditDays ? Number(f.creditDays) : null;
      const m = partyMsme(openBills.get(p.accCode) ?? [], cd !== null && Number.isFinite(cd) ? cd : null, msme, today, { promiseMissed: promise === "Missed", underLitigation: isUnderLitigation(l.status) });
      return { ...p, bg: bgFor(bgMap, p.accName), follow: f, legal: l, msme: m, promise };
    });
  }, [summary, bgMap, follow, legal, openBills, msme, today]);
  // Ageing by stage: litigating parties have a null stage and so never appear here.
  const stageStats = useMemo(() => {
    const out = Array.from({ length: 7 }, () => ({ count: 0, value: 0 }));
    for (const p of withExtras) if (p.msme.stage !== null && p.totalDues > 0) { out[p.msme.stage].count += 1; out[p.msme.stage].value += p.totalDues; }
    return out;
  }, [withExtras]);
  // Parties under litigation leave the collection table (and so every reminder-style filter) and get their own section.
  const litigating = useMemo(() => {
    const needle = squish(search);
    return withExtras.filter((p) => isUnderLitigation(p.legal.status) && (!needle || squish(`${p.accName} ${p.accCode}`).includes(needle)));
  }, [withExtras, search]);
  const filtered = useMemo<PartyRow[]>(() => {
    const needle = squish(search);
    const startOfToday = new Date(today).setHours(0, 0, 0, 0);
    return withExtras
      .filter((p) => {
        if (isUnderLitigation(p.legal.status)) return false;
        if (needle && !squish(`${p.accName} ${p.accCode}`).includes(needle)) return false;
        if (owner && p.follow.owner !== owner) return false;
        if (overdueOnly && p.overdue <= 0) return false;
        // shortcut: "past 45 days" is approximated by the 61+ buckets, upgrade with the 45-day bucket cut
        if (over45 && p.buckets["61-90"] + p.buckets["91-180"] + p.buckets["180+"] <= 0) return false;
        if (broken && !((toTime(p.follow.promisedDate) ?? Infinity) < startOfToday && p.overdue > 0)) return false;
        if (bucket && p.buckets[bucket] <= 0) return false;
        if (view === "today" && !dueToday({ nextActionDate: p.follow.nextActionDate, promisedDate: p.follow.promisedDate, overdue: p.overdue, underLitigation: false }, today)) return false;
        if (view === "breach" && (p.msme.daysPastDue ?? -1) <= 0) return false;
        if (view === "stage" && stageFilter !== null && p.msme.stage !== stageFilter) return false;
        return true;
      });
  }, [withExtras, today, search, owner, overdueOnly, over45, broken, bucket, view, stageFilter]);

  const table = useTable({
    features,
    columns: COLUMNS,
    data: filtered,
    state: { sorting: prefs.sorting },
    onSortingChange: (u) => setPrefs((p) => ({ ...p, sorting: typeof u === "function" ? u(p.sorting) : u })),
  });
  const sortedRows = table.getRowModel().rows;
  const parties = useMemo(() => sortedRows.map((r) => r.original), [sortedRows]);
  const sumOf = (get: (p: PartyRow) => number) => parties.reduce((t, p) => t + get(p), 0);

  const creditNotes = useMemo(() => creditNotesByBill(rows), [rows]);
  // Credit shown against its bill ("SR26Y-00009") and on the credit row itself ("Against GD26Y-00139").
  const creditRefOf = (r: DebtorRow) => {
    const ref = creditNoteRefOf(r.particular, r.tCode);
    return ref ? `Against ${ref}` : (creditNotes.get((r.vrNo ?? "").replace(/\s+/g, " ").trim().toUpperCase())?.join(", ") ?? "");
  };
  const bills = useMemo(() => {
    if (!open) return [];
    return rows
      .filter((r) => r.accCode === open && outstanding(r) !== 0)
      .map((r) => ({ r, days: daysOverdue(r.dueDate, today), bal: outstanding(r) }))
      .filter((b) => !bucket || (b.bal > 0 && bucketOf(b.days) === bucket))
      .sort((a, b) => (b.days ?? -1e9) - (a.days ?? -1e9));
  }, [rows, open, bucket, today]);

  // exports exactly what is on screen: `parties` is already filtered and in the current sort order
  const exportParties = () =>
    downloadCsv(
      "debtors_party_wise.csv",
      toCsv(
        ["Party", "Total dues", "Overdue", ...BUCKETS, "Unadjusted credit", "Net", "BG exposure", ...MSME_COLS.map(([, l]) => l), ...FOLLOW_UP_COLS.map((c) => c.label), ...LEGAL_COLS.map((c) => c.label)],
        parties.map((p) => {
          return [p.accName, p.totalDues, p.overdue, ...BUCKETS.map((b) => p.buckets[b]), p.credits, p.net, p.bg, p.msme.stage, p.msme.daysPastDue, Math.round(p.msme.interest), Math.round(p.msme.claimable), p.promise, ...FOLLOW_UP_COLS.map((c) => p.follow[c.field]), ...LEGAL_COLS.map((c) => p.legal[c.field])];
        }),
      ),
    );

  const exportStatement = (accName: string) =>
    downloadCsv(
      `statement_${accName.replace(/[^A-Za-z0-9]+/g, "_")}.csv`,
      toCsv(
        ["Invoice no", "Date", "Order no", "PO ref", "Items", "Amount", "Allocated", "Balance", "Due date", "Days overdue", "Credit note"],
        bills.map(({ r, days, bal }) => {
          const i = billInfoFor(billInfo, r.vrNo);
          return [r.vrNo, formatDate(r.vrDate), i?.orderNo ?? r.particular, i?.poRef, i?.items, r.drAmt, r.drAllocAmt, bal, formatDate(r.dueDate), days, creditRefOf(r)];
        }),
      ),
    );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center">
        <User className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium text-muted-foreground">No debtors data synced yet.</p>
      </div>
    );
  }

  const span = BUCKETS.length + 6 + MSME_COLS.length + FOLLOW_UP_COLS.length + LEGAL_COLS.length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Total dues" value={fmt(summary.totalDues)} />
        <Tile label="Overdue" value={fmt(summary.overdue)} />
        <Tile label="Over 90 days" value={fmt(summary.over90)} danger />
        <Tile label={`Unadjusted credits / advances (net ${fmt(summary.net)})`} value={fmt(summary.credits)} />
        <Tile label="No. of parties" value={String(summary.parties.filter((p) => p.totalDues > 0).length)} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Gross dues" value={fmt(split.gross)} />
        <Tile label="Under litigation (after provision)" value={fmt(split.underLitigation)} danger />
        <Tile label="Provision for doubtful debts" value={fmt(split.provision)} />
        <Tile label="Net collectable" value={fmt(split.netCollectable)} />
      </div>

      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBucket(bucket === b ? null : b)}
            className={`rounded-lg border px-3 py-2 text-left ${bucket === b ? "border-primary bg-primary/10" : "border-border bg-card"}`}
          >
            <div className="text-xs font-semibold text-muted-foreground">{b === "Not due" ? b : `${b} days`}</div>
            <div className={`text-lg font-bold tabular-nums ${bucketTone(b)}`}>{fmt(summary.buckets[b])}</div>
          </button>
        ))}
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Party-wise outstanding</h2>
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={`rounded-full border px-3 py-1 text-sm ${view === v ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}
              onClick={() => {
                setView(v);
                setStageFilter(null);
                if (v === "breach") setPrefs((p) => ({ ...p, sorting: [{ id: "totalDues", desc: true }] })); // biggest amount first
              }}
            >
              {label}
            </button>
          ))}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{parties.length} parties</span>
          <select aria-label="Filter by owner" value={owner} onChange={(e) => setFilter("owner", e.target.value)} className="rounded border border-border bg-card px-2 py-1 text-sm">
            <option value="">All owners</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {([["overdueOnly", "Overdue only"], ["over45", "Past 45 days only"], ["broken", "Promise broken"]] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 text-sm text-foreground">
              <input type="checkbox" checked={!!prefs.filters[k]} onChange={(e) => setFilter(k, e.target.checked ? "1" : "")} />
              {label}
            </label>
          ))}
          {bucket && (
            <button type="button" className="text-sm text-primary underline" onClick={() => setBucket(null)}>
              Clear bucket: {bucket}
            </button>
          )}
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => setPrefs((p) => ({ ...p, amountFormat: p.amountFormat === "lakh" ? "full" : "lakh" }))}>
            {prefs.amountFormat === "lakh" ? "₹ L" : "₹"}
          </button>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={exportParties}>Download CSV</button>
          <div className="w-full sm:ml-auto sm:w-72">
            <DebouncedSearchInput value={search} onCommit={(v) => setFilter("search", v)} placeholder="Search party name or code" />
          </div>
        </div>
        {view === "stage" && (
          <div className="grid grid-cols-4 gap-2 border-b border-border px-4 py-2.5 md:grid-cols-7">
            {stageStats.map((st, i) => (
              <button key={i} type="button" onClick={() => setStageFilter(stageFilter === i ? null : i)} className={`rounded-lg border px-3 py-2 text-left ${stageFilter === i ? "border-primary bg-primary/10" : "border-border"}`}>
                <div className="text-xs font-semibold text-muted-foreground">Stage {i} ({st.count})</div>
                <div className="text-sm font-bold tabular-nums">{fmt(st.value)}</div>
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="select-none">
              {table.getHeaderGroups().map((g) => (
                <tr key={g.id}>
                  {g.headers.map((h) => {
                    const sorted = h.column.getIsSorted();
                    const right = RIGHT_ALIGNED.has(h.column.id);
                    const idx = prefs.sorting.length > 1 ? h.column.getSortIndex() + 1 : 0;
                    return (
                      <th
                        key={h.id}
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                        className={`${TH} sticky top-0 border-b bg-muted ${h.column.id === "party" ? "left-0 z-30 min-w-[160px]" : "z-20"} ${right ? "text-right" : ""}`}
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
                    <td className={`${STICKY_PARTY} border-r border-border px-3 py-2 font-medium`}>{open === p.accCode ? "▾" : "▸"} {p.accName}</td>
                    <td className={TD}>{fmt(p.totalDues)}</td>
                    <td className={TD}>{fmt(p.overdue)}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={`${TD} ${p.buckets[b] > 0 && bucketTone(b) ? `font-semibold ${bucketTone(b)}` : ""}`}>
                        {p.buckets[b] ? fmt(p.buckets[b]) : "-"}
                      </td>
                    ))}
                    <td className={TD}>{p.credits ? fmt(p.credits) : "-"}</td>
                    <td className={TD}>{fmt(p.net)}</td>
                    <td className={TD}>{p.bg ? fmt(p.bg) : "-"}</td>
                    <td className={`${TD} text-center`}>{p.msme.stage ?? "-"}</td>
                    <td className={TD}>{p.msme.daysPastDue ?? "-"}</td>
                    <td className={TD}>{p.msme.interest > 0 ? fmt(Math.round(p.msme.interest)) : "-"}</td>
                    <td className={TD}>{p.msme.claimable > 0 ? fmt(Math.round(p.msme.claimable)) : "-"}</td>
                    <td className={`${TD} text-left ${p.promise === "Missed" ? "font-semibold text-red-700" : ""}`}>{p.promise ?? "-"}</td>
                    {FOLLOW_UP_COLS.map((c) => {
                      const v = p.follow[c.field] ?? "";
                      return (
                        <td key={c.field} className="border-r border-border px-1 py-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            key={v}
                            type={c.type ?? "text"}
                            defaultValue={v}
                            aria-label={c.label}
                            className="w-full min-w-[120px] rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-border focus:border-primary"
                            onBlur={(e) => e.target.value.trim() !== v && saveFollowUp(p.accCode, c.field, e.target.value)}
                          />
                        </td>
                      );
                    })}
                    <LegalCells p={p} onSave={saveLegal} />
                  </tr>
                  {open === p.accCode && (
                    <tr>
                      <td colSpan={span} className="bg-muted/20 p-3">
                        <table className="w-full border-collapse text-[13px]">
                          <thead>
                            <tr>
                              {["Invoice no", "Date", "Order no", "PO ref", "Item", "Amount", "Allocated", "Balance", "Due date", "Days overdue", "Credit note"].map((h, i) => (
                                <th key={h} className={`${TH} ${i >= 5 && i !== 8 ? "text-right" : ""}`}>{h}</th>
                              ))}
                              <th className={TH} colSpan={2}>
                                Documents{" "}
                                <button type="button" className="ml-2 rounded border border-border px-2 py-1 text-xs font-normal" onClick={() => exportStatement(p.accName)}>Download CSV</button>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {bills.map(({ r, days, bal }) => {
                              const info = billInfoFor(billInfo, r.vrNo);
                              return (
                              <tr key={r.id}>
                                <td className="px-3 py-1.5">{r.vrNo ?? "-"}</td>
                                <td className="px-3 py-1.5">{formatDate(r.vrDate)}</td>
                                <td className="px-3 py-1.5">{info?.orderNo ?? r.particular ?? "-"}</td>
                                <td className="px-3 py-1.5">{info?.poRef ?? "-"}</td>
                                <td className="px-3 py-1.5">{info?.items ?? "-"}</td>
                                <td className={TD}>{formatIndianNumber(r.drAmt, 2) || "-"}</td>
                                <td className={TD}>{formatIndianNumber(r.drAllocAmt, 2) || "-"}</td>
                                <td className={`${TD} ${bal < 0 ? "text-green-700" : ""}`}>
                                  {formatIndianNumber(bal, 2)}{bal < 0 ? " (credit)" : ""}
                                </td>
                                <td className="px-3 py-1.5">{formatDate(r.dueDate)}</td>
                                <td className={`${TD} ${days !== null && days > 45 ? "font-semibold text-red-700" : days !== null && days > 30 ? "font-semibold text-amber-700" : ""}`}>{days ?? "-"}</td>
                                <td className="px-3 py-1.5">{creditRefOf(r) || "-"}</td>
                                <td className="px-3 py-1.5" colSpan={2}><DocLinks info={info} /></td>
                              </tr>
                              );
                            })}
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
                {[sumOf((p) => p.totalDues), sumOf((p) => p.overdue), ...BUCKETS.map((b) => sumOf((p) => p.buckets[b])), sumOf((p) => p.credits), sumOf((p) => p.net), sumOf((p) => p.bg)].map((v, i) => (
                  <td key={i} className={`${TD} sticky bottom-0 border-t-2 bg-muted`}>{fmt(v)}</td>
                ))}
                <td colSpan={MSME_COLS.length + FOLLOW_UP_COLS.length + LEGAL_COLS.length} className="sticky bottom-0 border-t-2 border-border bg-muted" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {litigating.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-foreground">Under litigation</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{litigating.length} parties</span>
            <span className="text-xs text-muted-foreground">Excluded from reminders and the collectable total.</span>
          </div>
          {/* shortcut: this section is not sortable, upgrade by sharing the main table's column model */}
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  {["Party", "Total dues", "Provision", "Carried after provision", ...LEGAL_COLS.map((c) => c.label)].map((h, i) => (
                    <th key={h} className={`${TH} sticky top-0 z-20 border-b bg-muted ${i >= 1 && i <= 3 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {litigating.map((p, i) => {
                  const prov = resolveProvision(p.legal, p.totalDues);
                  return (
                    <tr key={p.accCode} className={i % 2 ? "bg-muted" : "bg-card"}>
                      <td className="border-r border-border px-3 py-2 font-medium">{p.accName}</td>
                      <td className={TD}>{fmt(p.totalDues)}</td>
                      <td className={TD}>{prov ? fmt(prov) : "-"}</td>
                      <td className={TD}>{fmt(p.totalDues - prov)}</td>
                      <LegalCells p={p} onSave={saveLegal} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
