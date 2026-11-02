"use client";

import { useEffect, useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import DebtorsTable from "@/components/debtors/DebtorsTable";
import { DEFAULT_MSME_SETTINGS } from "@/lib/msme";
import type { DebtorTotals, DebtorsResult } from "@/lib/debtors";

type DebtorsData = DebtorsResult;

const EMPTY_TOTALS: DebtorTotals = {
  drAmt: 0,
  drAllocAmt: 0,
  unAllocDr: 0,
  unAllocCr: 0,
};

export default function DebtorsPage() {
  const [data, setData] = useState<DebtorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/debtors");
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <GMDUpdateHeader
          title="DEBTORS"
          totalRows={0}
          syncedAt={undefined}
        />
        <GMDUpdateSkeleton />
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <GMDUpdateHeader
        title="DEBTORS"
        totalRows={data?.rows.length ?? 0}
        syncedAt={data?.syncedAt ?? undefined}
      warnIfStale
      />
      {error && (
        <div className="px-6 py-4 text-sm text-red-600">{error}</div>
      )}
      <div className="flex-1 min-h-0 px-6 pb-6 flex gap-4">
        <div className="flex-1 min-h-0">
          <DebtorsTable
            rows={data?.rows ?? []}
            totals={data?.totals ?? EMPTY_TOTALS}
            billInfo={data?.billInfo ?? {}}
            bgs={data?.bgs ?? []}
            followUps={data?.followUps ?? {}}
            legalCases={data?.legalCases ?? {}}
            msme={data?.msme ?? DEFAULT_MSME_SETTINGS}
          />
        </div>
      </div>
    </main>
  );
}
