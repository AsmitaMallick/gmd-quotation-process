import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLookupOptions } from "./actions";
import LookupOptionsManager from "./LookupOptionsManager";

export const metadata = {
  title: "Lookup Options Admin | GMD One Person Lead Framework",
};

export const dynamic = "force-dynamic";

export default async function LookupOptionsAdminPage() {
  const session = await auth();
  const role = (session?.user as any)?.role as string | undefined;
  if (role !== "developer") redirect("/login");
  const canEdit = role === "developer";

  const options = await getLookupOptions();

  const types = Array.from(new Set(options.map((o) => o.type))).sort();

  return (
    <div className="flex flex-col gap-4 p-6 flex-1 min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">Lookup Options Admin</h1>
          <p className="text-xs text-muted-foreground">
            Manage all static option lists (party names, utilities, item types, etc.). Changes
            reflect immediately on the quotation process dashboard after reload.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] dark:bg-primary/85 px-4 text-sm font-semibold text-white dark:text-primary-foreground hover:bg-[#0353e9] dark:hover:bg-primary rounded-md"
        >
          Back to Quotation Process
        </Link>
      </div>

      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading options...</div>}>
        <LookupOptionsManager options={options} types={types} canEdit={canEdit} />
      </Suspense>
    </div>
  );
}
