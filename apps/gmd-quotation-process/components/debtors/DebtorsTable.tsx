"use client";

import { Fragment, useMemo, useState } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";
import { saveLedgerFollowUpAction } from "@/app/actions/ledgerFollowUp";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import type { DebtorRow, DebtorTotals } from "@/lib/debtors";
import { BUCKETS, bucketOf, daysOverdue, formatLakh, outstanding, summarise } from "@/lib/debtorsAgeing";
import type { Bucket } from "@/lib/debtorsAgeing";
import { formatIndianNumber } from "@/lib/formatCurrency";
import { bgExposureByName, bgFor, billInfoFor, downloadCsv, followUpFor, toCsv } from "@/lib/debtorJoins";
import type { BgRow, BillInfo, FollowUp } from "@/lib/debtorJoins";

const EMPTY_FOLLOW_UP: FollowUp = { owner: null, contactName: null, contactPhone: null, contactEmail: null, lastFollowUp: null, promisedDate: null, promisedAmount: null, status: null, remarks: null };
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

interface DebtorsTableProps {
  rows: DebtorRow[];
  totals: DebtorTotals;
  billInfo: Record<string, BillInfo>;
  bgs: BgRow[];
  followUps: Record<string, FollowUp>;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const TH = "border-r border-border px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-normal break-words align-bottom";
const TD = "border-r border-border px-3 py-2 text-right tabular-nums";
const isRed = (b: Bucket) => b === "91-180" || b === "180+";

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${danger ? "text-red-600" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

const DOC_LINKS = [
  ["orderCopy", "Order copy"],
  ["invoice", "Invoice"],
  ["inspectionReport", "Inspection"],
  ["driveLink", "Drive"],
] as const;

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

export default function DebtorsTable({ rows, billInfo, bgs, followUps }: DebtorsTableProps) {
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [follow, setFollow] = useState(followUps);

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

  const today = useMemo(() => new Date(), []);
  const summary = useMemo(() => summarise(rows, today), [rows, today]);

  const bgMap = useMemo(() => bgExposureByName(bgs), [bgs]);

  const parties = useMemo(() => {
    const needle = squish(search);
    return summary.parties.filter((p) => {
      if (needle && !squish(`${p.accName} ${p.accCode}`).includes(needle)) return false;
      if (overdueOnly && p.overdue <= 0) return false;
      if (bucket && p.buckets[bucket] <= 0) return false;
      return true;
    });
  }, [summary, search, overdueOnly, bucket]);

  const bills = useMemo(() => {
    if (!open) return [];
    return rows
      .filter((r) => r.accCode === open && outstanding(r) !== 0)
      .map((r) => ({ r, days: daysOverdue(r.dueDate, today), bal: outstanding(r) }))
      .filter((b) => !bucket || (b.bal > 0 && bucketOf(b.days) === bucket))
      .sort((a, b) => (b.days ?? -1e9) - (a.days ?? -1e9));
  }, [rows, open, bucket, today]);

  const exportParties = () =>
    downloadCsv(
      "debtors_party_wise.csv",
      toCsv(
        ["Party", "Total dues", "Overdue", ...BUCKETS, "Unadjusted credit", "Net", "BG exposure", ...FOLLOW_UP_COLS.map((c) => c.label)],
        parties.map((p) => {
          const f = followUpFor(follow, p.accCode);
          return [p.accName, p.totalDues, p.overdue, ...BUCKETS.map((b) => p.buckets[b]), p.credits, p.net, bgFor(bgMap, p.accName), ...FOLLOW_UP_COLS.map((c) => f?.[c.field])];
        }),
      ),
    );

  const exportStatement = (accName: string) =>
    downloadCsv(
      `statement_${accName.replace(/[^A-Za-z0-9]+/g, "_")}.csv`,
      toCsv(
        ["Invoice no", "Date", "Order no", "PO ref", "Items", "Amount", "Allocated", "Balance", "Due date", "Days overdue"],
        bills.map(({ r, days, bal }) => {
          const i = billInfoFor(billInfo, r.vrNo);
          return [r.vrNo, formatDate(r.vrDate), i?.orderNo ?? r.particular, i?.poRef, i?.items, r.drAmt, r.drAllocAmt, bal, formatDate(r.dueDate), days];
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

  const span = BUCKETS.length + 15;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Total dues" value={formatLakh(summary.totalDues)} />
        <Tile label="Overdue" value={formatLakh(summary.overdue)} />
        <Tile label="Over 90 days" value={formatLakh(summary.over90)} danger />
        <Tile label={`Unadjusted credits / advances (net ${formatLakh(summary.net)})`} value={formatLakh(summary.credits)} />
        <Tile label="No. of parties" value={String(summary.parties.filter((p) => p.totalDues > 0).length)} />
      </div>

      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBucket(bucket === b ? null : b)}
            className={`rounded-lg border px-3 py-2 text-left ${bucket === b ? "border-primary bg-primary/10" : "border-border bg-card"}`}
          >
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">{b === "Not due" ? b : `${b} days`}</div>
            <div className={`text-base font-bold tabular-nums ${isRed(b) ? "text-red-600" : ""}`}>{formatLakh(summary.buckets[b])}</div>
          </button>
        ))}
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Party-wise outstanding</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{parties.length} parties</span>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
          {bucket && (
            <button type="button" className="text-xs text-primary underline" onClick={() => setBucket(null)}>
              Clear bucket: {bucket}
            </button>
          )}
          <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={exportParties}>Download CSV</button>
          <div className="ml-auto w-72">
            <DebouncedSearchInput value={search} onCommit={setSearch} placeholder="Search party name or code" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 select-none">
              <tr>
                <th className={TH}>Party</th>
                <th className={`${TH} text-right`}>Total dues</th>
                <th className={`${TH} text-right`}>Overdue</th>
                {BUCKETS.map((b) => (
                  <th key={b} className={`${TH} text-right`}>{b === "Not due" ? b : `${b} days`}</th>
                ))}
                <th className={`${TH} text-right`}>Unadjusted credit</th>
                <th className={`${TH} text-right`}>Net (dues minus credits)</th>
                <th className={`${TH} text-right`}>BG exposure (open BGs)</th>
                {FOLLOW_UP_COLS.map((c) => (
                  <th key={c.field} className={TH}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {parties.map((p) => (
                <Fragment key={p.accCode}>
                  <tr className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(open === p.accCode ? null : p.accCode)}>
                    <td className="border-r border-border px-3 py-2 font-medium">{open === p.accCode ? "▾" : "▸"} {p.accName}</td>
                    <td className={TD}>{formatLakh(p.totalDues)}</td>
                    <td className={TD}>{formatLakh(p.overdue)}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={`${TD} ${isRed(b) && p.buckets[b] > 0 ? "font-semibold text-red-600" : ""}`}>
                        {p.buckets[b] ? formatLakh(p.buckets[b]) : "-"}
                      </td>
                    ))}
                    <td className={TD}>{p.credits ? formatLakh(p.credits) : "-"}</td>
                    <td className={TD}>{formatLakh(p.net)}</td>
                    <td className={TD}>{bgFor(bgMap, p.accName) ? formatLakh(bgFor(bgMap, p.accName)) : "-"}</td>
                    {FOLLOW_UP_COLS.map((c) => {
                      const v = follow[p.accCode]?.[c.field] ?? "";
                      return (
                        <td key={c.field} className="border-r border-border px-1 py-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            key={v}
                            type={c.type ?? "text"}
                            defaultValue={v}
                            aria-label={c.label}
                            className="w-full min-w-[110px] rounded border border-transparent bg-transparent px-2 py-1 hover:border-border focus:border-primary"
                            onBlur={(e) => e.target.value.trim() !== v && saveFollowUp(p.accCode, c.field, e.target.value)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                  {open === p.accCode && (
                    <tr>
                      <td colSpan={span} className="bg-muted/20 p-3">
                        <table className="w-full border-collapse text-[12px]">
                          <thead>
                            <tr>
                              {["Invoice no", "Date", "Order no", "PO ref", "Item", "Amount", "Allocated", "Balance", "Due date", "Days overdue"].map((h, i) => (
                                <th key={h} className={`${TH} ${i >= 5 && i !== 8 ? "text-right" : ""}`}>{h}</th>
                              ))}
                              <th className={TH} colSpan={2}>
                                Documents{" "}
                                <button type="button" className="ml-2 rounded border border-border px-2 py-1 text-[10px] normal-case" onClick={() => exportStatement(p.accName)}>Download CSV</button>
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
                                <td className={`${TD} ${days !== null && days > 90 ? "font-semibold text-red-600" : ""}`}>{days ?? "-"}</td>
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
          </table>
        </div>
      </div>
    </div>
  );
}
