import { Suspense } from "react";
import type { Metadata } from "next";
import EngineeringDataPage from "@/components/technical/EngineeringDataPage";

export const metadata: Metadata = {
  title: "Technical | GMD One Person Lead Framework",
  description:
    "Live engineering tables for gate valves, flanges, gear boxes and actuators.",
};

/**
 * /technical — the GMD engineering tables, one per subtab.
 *
 * The page component reads `?tab=` through `useSearchParams`, which opts the
 * subtree out of static rendering, so it is wrapped in Suspense here. Everything
 * inside renders the same on the server and the client.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <EngineeringDataPage />
    </Suspense>
  );
}
