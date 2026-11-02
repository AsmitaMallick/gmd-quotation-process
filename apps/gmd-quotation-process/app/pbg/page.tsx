import { Suspense } from "react";
import type { Metadata } from "next";
import { getPbgData } from "@/lib/pbg/pbg-data";
import { PbgTable } from "@/components/pbg/pbg-table";

export const metadata: Metadata = {
  title: "PBG | GMD One Person Lead Framework",
  description: "Performance Bank Guarantee records synced from the sheet.",
};

// Reads live data on every request, so render dynamically.
export const dynamic = "force-dynamic";

function PbgSkeleton() {
  return (
    <div className="h-full min-h-0 animate-pulse rounded-xl border border-slate-200 bg-white" />
  );
}

async function PbgDashboard({ includeClosed }: { includeClosed: boolean }) {
  const records = await getPbgData({ includeClosed });

  return (
    <div className="h-full min-h-0">
      <PbgTable records={records} includeClosed={includeClosed} />
    </div>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ includeClosed?: string }>;
}) {
  const params = await searchParams;
  const includeClosed = params.includeClosed === "1";

  return (
    <main className="h-[calc(100vh-64px)] overflow-hidden bg-background p-3">
      <Suspense fallback={<PbgSkeleton />}>
        <PbgDashboard
          key={String(includeClosed)}
          includeClosed={includeClosed}
        />
      </Suspense>
    </main>
  );
}
