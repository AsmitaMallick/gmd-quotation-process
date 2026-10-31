# Purchase dashboard and in-transit stock — the logic

How a Purchase dashboard is built from data that already exists, and how it tags
in-transit (ordered, GRN pending) material onto physical stock.

Built on 2026-10-31. Every number below was read from the live workbooks the
same day.

**Status:** live. The table exists, the first sync has run (3,439 lines), both
pages and the Physical Stock `IN TRANSIT` column were checked in a browser on
2026-10-31. Only the scheduled job is outstanding — see *Still to do*.

## 1. The source already has everything

`GMD EXECUTION TRACKING` (`GMD_EXECUTION_TRACKING_SPREADSHEET_ID`) carries the
purchase side in two tabs:

| Tab | gid | Size | What it is |
|---|---|---|---|
| `PURCHASE ORD AND GRN` | 1895689370 | 13,791 × 23 | **PO line level, with GRN progress already joined** |
| `GRN` | 372231442 | 5,500 × 11 | Individual GRN receipts |

`PURCHASE ORD AND GRN` columns:

```
ACC_CODE  AUM  ITEM_CODE  VRNO  SLNO  VRDATE  UM  BALANCE  BASIC_AMT
DELIVERY_SCH  GRN_VRDATE  LAST_PO_RATE  MIN_PO_RATE  LAST_PO_DATE
NET_QTYORDER  QTYEXECUTE  RATE  SALES_CONT  EXCHANGE_RATE
PARTYREFNO  PARTYREFDATE  ITEM_NAME  ACC_NAME
```

The three that matter most:

- `NET_QTYORDER` — ordered quantity, cancellations already deducted
- `QTYEXECUTE` — quantity received against GRN
- `BALANCE` — **what is still to come. The sheet computes it already.**

And the one that makes the whole feature possible:

- `SALES_CONT` — the sales contract this purchase line was raised against.

That column is the link the request is really about: it is what lets an in-transit
quantity be tagged *to an order* rather than floating as a bare number.

> **In transit = `BALANCE`** on a PO line, or equivalently `NET_QTYORDER − QTYEXECUTE`.
> Derive it, do not re-invent it. Where the two disagree, trust `BALANCE` and log
> the row — a mismatch means the ERP cancelled or amended something.

A cross-check exists in the physical stock workbook (`Laser_Item Master`), tab
`PO LIST` (gid 1440127265), in friendlier wording: `Net Order Qty Um`,
`Executed Qty (Grn) Um`, **`Bal. Order Qty Um`**, `ITEM CODE`, `TO BE CLOSED`.
Same numbers, so `PO LIST` is a reconciliation source, not a second truth.

## 2. The join to physical stock

`PhysicalStock.erp_code` (`packages/db-stock`) mirrors the `stock-phys` tab's
**ERP CODE**, and `PURCHASE ORD AND GRN.ITEM_CODE` is the same ERP item code.

```
PURCHASE ORD AND GRN.ITEM_CODE  ──┐
                                  ├──►  PhysicalStock.erp_code
stock-phys."ERP CODE"           ──┘
```

So in-transit per item is a plain aggregate:

```
inTransitQty(item) = Σ BALANCE  over open PO lines where ITEM_CODE = item
```

`PhysicalStock` already has `order_in_hand_qty` and `shortage_qty`. In-transit
sits beside them and changes what shortage means:

```
true shortage = order_in_hand_qty − available_qty − inTransitQty
```

That is the number worth putting on the page. Today's `shortage_qty` ignores
material that is already bought and on its way, so it overstates what must be
ordered.

## 3. Shape of the build

The repo already has the pattern for exactly this, twice over
(`packages/contract-review`, `packages/physical-stock`): **one shared package,
one thin page per app, flags per app.** Follow it rather than inventing a
structure.

```
packages/purchase/
  src/
    lib/columns.ts        PURCHASE ORD AND GRN header → DB field map
    lib/inTransit.ts      BALANCE aggregation, the shortage maths
    server/index.ts       queries + server actions
    ui/PurchaseDashboard.tsx
    flags.ts              disabledColumns / readOnlyColumns / hiddenSidebar
```

Mounted in both places the request names:

- `apps/stock-physical/app/purchase/page.tsx` — the separate dashboard
- `apps/gmd-quotation-process/app/purchase/page.tsx` — plus one line in
  `components/layout/nav-items.ts` under **Materials**

Each page is ~10 lines: render the shared component, pass that app's flags and
server actions. Same as `apps/gmd-tender-dashboard/app/contract-review/page.tsx`.

### Storage

New model in `packages/db-stock` (it is stock data, and it joins `PhysicalStock`):

```prisma
model PurchaseOrderLine {
  id             String    @id @default(cuid())
  poNo           String    // VRNO
  poLineNo       String    // SLNO
  poDate         String?   // VRDATE, dd-MMM-yyyy like the rest of the codebase
  itemCode       String?   // ITEM_CODE  → PhysicalStock.erp_code
  itemName       String?
  supplierCode   String?   // ACC_CODE
  supplierName   String?   // ACC_NAME
  uom            String?
  netQtyOrder    String?
  qtyExecuted    String?   // QTYEXECUTE
  balanceQty     String?   // BALANCE — the in-transit quantity
  rate           String?
  basicAmount    String?
  deliverySched  String?   // DELIVERY_SCH
  grnDate        String?   // GRN_VRDATE
  salesContract  String?   // SALES_CONT — the tag back to the order
  partyRefNo     String?
  partyRefDate   String?
  created_at     DateTime  @default(now())
  updated_at     DateTime  @updatedAt

  @@unique([poNo, poLineNo])
  @@index([itemCode])
  @@index([salesContract])
}
```

Strings, not numbers, because every other sheet-mirroring model in this repo
stores strings and the sheet cells are not clean.

### Sync

Clone `lib/executionTrackingSync.ts`. Its rules are already correct for this and
were argued out with the sheet owner:

- resolve the tab **by gid, never by title** — add `PURCHASE_ORD_GRN_GID` to env
- a blank cell (including `-` `--` `—` `–`) never clears a stored value
- nothing is ever deleted
- match key here is `(VRNO, SLNO)`, as invoice number is for SALE BILL

Run it from `app/api/scheduler/`, next to the existing jobs.

## 4. What the live tab actually holds

Measured before the first run, over all 3,439 data rows:

| | |
|---|---|
| Data rows | 3,439 (plus 1 repeated header row, dropped) |
| Duplicate `(VRNO, SLNO)` | 0 — the unique key holds |
| Columns mapped | 18 of 18 |
| Open lines (material to come) | 385 |
| …of those, no `SALES_CONT` | 236 (61%) |
| Over-received lines (negative balance) | 7 |
| `BALANCE` ≠ ordered − received | 0 |
| Items with stock on the way | 263 |
| Items with mixed units | 0 |

That settles two of the three questions this design opened with:

- **`SALES_CONT` coverage is 39% of open lines.** Order-level tagging is real
  but partial, so the dashboard counts untagged lines separately instead of
  implying every in-transit item belongs to an order.
- **Mixed units are not a problem today** (0 items). The guard stays, because
  one mixed item would otherwise add kilograms to pieces silently.

The seven over-received lines are genuine, not parse failures — e.g.
`PE24Y-00065/11`, ordered 3, received 25. Their in-transit is floored at zero so
they can never subtract from another line's, and the row is tinted red.

### Still open

**What closes a PO line.** `BALANCE > 0` is the test in use, but `PO LIST`
carries a `TO BE CLOSED` flag, which suggests some lines sit at a small non-zero
balance and are closed by hand. If that is so, those lines are counted as in
transit when they are not. Needs a rule from whoever maintains that flag.

## 5. Still to do

Done on 2026-10-31: the table was created, the first sync wrote 3,439 lines
(385 open, 236 untagged — exactly the dry run), and both pages plus the
Physical Stock `IN TRANSIT` column were checked against live data in a browser.

1. **Schedule it.** Add `infra/purchase-orders.sh` and a
   `[job-local "purchase-orders-sync"]` block in the infra repo, like the other
   jobs. Until then the table is a one-off snapshot of 2026-10-31.
2. **Add `prisma migrate deploy` to `deploy.yml`.** This table had to be
   created by hand because the deploy workflow runs no migration step — the same
   gap that took Contract Review down.

### Items on order that physical stock has never seen

263 items have stock on the way; **164 match a `PhysicalStock` row, 99 do not**
(not a casing or whitespace mismatch — checked). `PhysicalStock` holds 1,180
items, so those 99 are simply items that have been ordered but never physically
stocked or counted.

They are not lost: the Purchase dashboard counts them in full. But their
in-transit quantity cannot appear on the Physical Stock page, because there is no
row to put it on. Anyone reading `IN TRANSIT` there is seeing 62% of the items on
order, not all of them.

## 6. Why this is small

No new data is created. The ERP already computes the balance, the sheet already
carries it, the item code already matches physical stock, and the repo already
has the package/page/flags pattern and a sync engine to copy. The work is a
column map, an aggregate, a table, and two ten-line pages.
