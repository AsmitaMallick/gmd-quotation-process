import type { Metadata } from "next";
import { PurchaseDashboard } from "@gmd/purchase/ui";
import { getPurchaseFlags } from "@/lib/purchase-flags";
import * as actions from "./actions";

export const metadata: Metadata = {
  title: "Purchase | Stock Physical Dashboard",
};

// pg + Prisma need the Node.js runtime.
export const runtime = "nodejs";

export default async function Page() {
  return <PurchaseDashboard flags={await getPurchaseFlags()} actions={{ ...actions }} />;
}
