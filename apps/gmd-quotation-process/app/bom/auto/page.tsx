import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canEditApm } from "@/lib/auth-helpers";
import { getBomRules } from "./actions";
import AutoBomManager from "./AutoBomManager";

export const metadata = {
  title: "Auto BOM | GMD One Person Lead Framework",
};

export const dynamic = "force-dynamic";

export default async function AutoBomPage() {
  const session = await auth();
  const role = (session?.user as any)?.role as string | undefined;
  // Same admin/developer gate the server actions enforce.
  if (!session) redirect("/login?callbackUrl=/bom/auto");
  if (!canEditApm(role)) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Auto BOM needs an admin or developer account. You are signed in as {session.user?.email} with role{" "}
        &quot;{role ?? "none"}&quot;.
      </div>
    );
  }

  const rules = await getBomRules();

  return (
    <div className="flex flex-col gap-4 p-6 flex-1 min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">Auto BOM</h1>
          <p className="text-xs text-muted-foreground">
            Rules that match a full item to raw materials and create BOMs for full items that have none.
            Preview a rule before creating anything.
          </p>
        </div>
        <Link
          href="/bom"
          className="inline-flex h-9 items-center gap-1.5 bg-[#0f62fe] dark:bg-primary/85 px-4 text-sm font-semibold text-white dark:text-primary-foreground hover:bg-[#0353e9] dark:hover:bg-primary rounded-md"
        >
          Back to FG BOM
        </Link>
      </div>

      <AutoBomManager rules={rules} />
    </div>
  );
}
