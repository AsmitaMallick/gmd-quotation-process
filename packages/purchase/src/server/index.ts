import "server-only";
import { stockPrisma } from "@gmd/db-stock";
import type { PurchaseRow } from "../columns";
import type { ActionResult, PurchasePage, PurchaseSummary, PurchaseView } from "../types";
import { balanceDisagrees } from "../lib/inTransit";

// Reads of the PurchaseOrderLine table (stock DB). No auth and no flags lookup:
// the host app's Server Actions own those. Same split as @gmd/physical-stock.
//
// Every filter and total runs in SQL against the derived `inTransit` /
// `lineValue` columns the sync writes, so a page load never parses 13k strings.

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type LineWhere = NonNullable<Parameters<typeof stockPrisma.purchaseOrderLine.findMany>[0]>["where"];

function whereFor(view: PurchaseView): LineWhere {
  const and: NonNullable<LineWhere>[] = [];

  if (view.openOnly) and.push({ inTransit: { gt: 0 } });
  if (view.salesContract) and.push({ salesContract: view.salesContract });
  if (view.itemCode) and.push({ itemCode: view.itemCode });
  if (view.supplierName) and.push({ supplierName: view.supplierName });

  const search = view.search?.trim();
  if (search) {
    and.push({
      OR: [
        { poNo: { contains: search, mode: "insensitive" } },
        { itemCode: { contains: search, mode: "insensitive" } },
        { itemName: { contains: search, mode: "insensitive" } },
        { supplierName: { contains: search, mode: "insensitive" } },
        { salesContract: { contains: search, mode: "insensitive" } },
        { partyRefNo: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}

function toRow(line: {
  id: string;
  poNo: string;
  poLineNo: string;
  poDate: string | null;
  itemCode: string | null;
  itemName: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  uom: string | null;
  altUom: string | null;
  netQtyOrder: string | null;
  qtyExecuted: string | null;
  balanceQty: string | null;
  rate: string | null;
  basicAmount: string | null;
  exchangeRate: string | null;
  deliverySched: string | null;
  grnDate: string | null;
  salesContract: string | null;
  partyRefNo: string | null;
  partyRefDate: string | null;
  inTransit: number | null;
  lineValue: number | null;
}): PurchaseRow {
  return line;
}

/**
 * Totals for the current view.
 *
 * `disagreeingLineCount` is the one figure that cannot be aggregated in SQL —
 * it compares three string columns — so it is counted over the open lines only,
 * which is the slice a human would act on.
 */
async function summarize(where: LineWhere): Promise<PurchaseSummary> {
  const openWhere: LineWhere = { AND: [where ?? {}, { inTransit: { gt: 0 } }] };

  const [lineCount, openAgg, untaggedLineCount, contracts, openLines] = await Promise.all([
    stockPrisma.purchaseOrderLine.count({ where }),
    stockPrisma.purchaseOrderLine.aggregate({
      where: openWhere,
      _count: { _all: true },
      _sum: { inTransit: true, lineValue: true },
    }),
    stockPrisma.purchaseOrderLine.count({
      where: { AND: [openWhere, { OR: [{ salesContract: null }, { salesContract: "" }] }] },
    }),
    stockPrisma.purchaseOrderLine.findMany({
      where: { AND: [openWhere, { NOT: { salesContract: null } }, { NOT: { salesContract: "" } }] },
      distinct: ["salesContract"],
      select: { salesContract: true },
    }),
    stockPrisma.purchaseOrderLine.findMany({
      where: openWhere,
      select: { balanceQty: true, netQtyOrder: true, qtyExecuted: true },
    }),
  ]);

  return {
    lineCount,
    openLineCount: openAgg._count._all,
    inTransitQty: openAgg._sum.inTransit ?? 0,
    inTransitValue: openAgg._sum.lineValue ?? 0,
    untaggedLineCount,
    disagreeingLineCount: openLines.filter(balanceDisagrees).length,
    contractCount: contracts.length,
  };
}

/** One filtered page plus the totals for the whole filtered set. */
export async function loadPurchaseView(view: PurchaseView = {}): Promise<ActionResult<PurchasePage>> {
  return run(async () => {
    const where = whereFor(view);
    const page = Math.max(1, view.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, view.pageSize ?? DEFAULT_PAGE_SIZE));

    const [rows, total, summary, latest] = await Promise.all([
      stockPrisma.purchaseOrderLine.findMany({
        where,
        // Most material still to come first; it is what the page exists for.
        orderBy: [{ inTransit: "desc" }, { poDate: "desc" }, { poNo: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      stockPrisma.purchaseOrderLine.count({ where }),
      summarize(where),
      stockPrisma.purchaseOrderLine.aggregate({ _max: { syncedAt: true } }),
    ]);

    return {
      rows: rows.map(toRow),
      total,
      page,
      pageSize,
      summary,
      syncedAt: latest._max.syncedAt ? latest._max.syncedAt.toISOString() : null,
    };
  });
}

/**
 * In-transit quantity per ERP item code, for the physical stock page.
 *
 * Aggregated in SQL over open lines. Call it with the codes on screen; with no
 * codes it returns every item that has material on the way.
 */
export async function inTransitForItems(itemCodes?: readonly string[]): Promise<Map<string, number>> {
  const codes = itemCodes?.filter((c) => c && c.trim()).map((c) => c.trim());
  if (codes && codes.length === 0) return new Map();

  const grouped = await stockPrisma.purchaseOrderLine.groupBy({
    by: ["itemCode"],
    where: {
      AND: [
        { inTransit: { gt: 0 } },
        { NOT: { itemCode: null } },
        ...(codes ? [{ itemCode: { in: codes } }] : []),
      ],
    },
    _sum: { inTransit: true },
  });

  const out = new Map<string, number>();
  for (const g of grouped) {
    if (!g.itemCode) continue;
    out.set(g.itemCode, g._sum.inTransit ?? 0);
  }
  return out;
}

/** Distinct values for the table's filter dropdowns. */
export async function purchaseFacets(): Promise<{ suppliers: string[]; contracts: string[] }> {
  const [suppliers, contracts] = await Promise.all([
    stockPrisma.purchaseOrderLine.findMany({
      where: { NOT: { supplierName: null } },
      distinct: ["supplierName"],
      select: { supplierName: true },
      orderBy: { supplierName: "asc" },
    }),
    stockPrisma.purchaseOrderLine.findMany({
      where: { AND: [{ inTransit: { gt: 0 } }, { NOT: { salesContract: null } }, { NOT: { salesContract: "" } }] },
      distinct: ["salesContract"],
      select: { salesContract: true },
      orderBy: { salesContract: "asc" },
    }),
  ]);

  return {
    suppliers: suppliers.map((s) => s.supplierName).filter((s): s is string => Boolean(s)),
    contracts: contracts.map((c) => c.salesContract).filter((c): c is string => Boolean(c)),
  };
}
