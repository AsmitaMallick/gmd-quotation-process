# schedular_function

Every ofelia-driven sync lives in this folder. Route handlers under
`app/api/scheduler/**` are deliberately thin — Next.js only routes `route.ts`
files that sit under `app/`, so that is the one place a route must live, but it
contains nothing but auth, status codes, and response shaping.

**No file here imports from `@/app/actions`.** That file is a top-level
`"use server"` module; a route handler must not reach into a server action.
Where an algorithm already existed there, it was copied rather than imported
(see *Relationship to existing code* below).

## Jobs

Eight hourly jobs plus `execution-tracking` and `erp-contract-no`, which run
every 2 hours. All are staggered so no two heavy ones collide.

| :00 | :05 | :10 | :15 | :20 | :30 | :35 | :40 | :45 | :50 |
|---|---|---|---|---|---|---|---|---|---|
| `raw-material` | `bom-mast` | `physical-stock-cost-bom` | `supply-history` | `docket-creation` | `contract-review` | `acc-master` | `execution-tracking` | `c-batch` | `erp-contract-no` |

| Job | Endpoint | Ofelia job name | Reads |
|---|---|---|---|
| Raw Material sync | `POST /api/scheduler/raw-material` | `raw-material-sync` | `GMD UPDATION`, `stock-phys` |
| BOM MAST ERP sync | `POST /api/scheduler/bom-mast` | `bom-mast-sync` | `BOM MAST ERP` |
| Physical Stock cost / BOM ID | `POST /api/scheduler/physical-stock-cost-bom` | `physical-stock-cost-bom-sync` | local `FullItem` / `Bom` / `BomItem` → stock DB `PhysicalStock` |
| Supply History MASTER sync | `POST /api/scheduler/supply-history` | `supply-history-sync` | `MASTER`, GMD Clientwise ORDER LIST, `SALE_BILL` (rate gap-fill) |
| Pending docket creation + duplicate cleanup | `POST /api/scheduler/docket-creation` | `docket-creation-sync` | `docket_quotation_threads`, `enquiries` |
| Contract Review sync | `POST /api/scheduler/contract-review` | `contract-review-sync` | `CONTRACTS`, `DUMP`, `stock-phys`, `INSPECTION OFFER DUMP` |
| ACC Master refresh | `POST /api/scheduler/acc-master` | `acc-master-sync` | `ACC_MASTER` |
| Execution Tracking sync | `POST /api/scheduler/execution-tracking` | `execution-tracking-sync` | `SALE_BILL` (+ the local `acc_master`) |
| PBG sheet sync *(every 1.2h)* | `POST /api/scheduler/pbg` | `pbg-sync` | PBG sheet tab → `PbgData` |
| PBG reminder emails *(daily, 09:00 IST)* | `POST /api/scheduler/pbg-reminders` | `pbg-reminders` | `PbgData`, `PbgReminderLog` -> direct SMTP |
| C Batch marks | `POST /api/scheduler/c-batch` | `c-batch-sync` | `ITEM MASTER ERP` |
| ERP Contract No sync | `POST /api/scheduler/erp-contract-no` | `erp-contract-no-sync` | `SALE_BILL`, `MC` |
| Ledger sync *(daily, 01:55)* | `POST /api/scheduler/ledger` | `ledger-sync` | `DEBTORS`, `CREDITORS`, `ADVANCE TO CREDITORS` -> `Debtor`, `Creditor`, `CreditorAdvance` |

The stagger is deliberate. `raw-material`, `supply-history` and
`contract-review` each full-table-read the tables the others write. `bom-mast`
runs at :05, after `raw-material` (which owns the `RawMaterial` rows its
components resolve against) and before `supply-history`, whose
`SupplyHistoryBomLink` rebuild reads the `Bom`/`BomItem` graph it writes — so
Supply History sees fresh BOMs in the same hourly pass. `acc-master` (:35) fills
the code -> name list `execution-tracking` (:40) joins on, and
`execution-tracking` runs after `supply-history` (:15) so it patches rows that
job just wrote — `execution-tracking` is the one job on a slower clock, firing at
:40 of every **even** hour (`0 40 */2 * * *`), so a 2-hourly run still lands in an
hour whose `:35` and `:15` already ran.
`erp-contract-no` (:50) is the second job on that even-hour clock
(`0 50 */2 * * *`): it runs after `execution-tracking` so the rows that job
inserted for a brand-new invoice at :40 get their contract number in the same
pass. `c-batch` runs last and can safely overlap
any of them: it writes
**only** the `cBatch` column, which no other scheduled job touches.
`docket-creation` runs at `:20`, between `supply-history` and `contract-review`,
so contract-review's same-hour pass can backfill `contractNo` on the dockets it
creates.


`pbg` is off this hourly grid: ofelia runs it on `@every 1h12m` (72 minutes).
`@every` is Go-duration syntax (the same syntax ofelia uses for `@every 30s`),
because a plain cron cannot express "every 72 minutes". The interval counts from
when ofelia starts, not wall-clock. It writes only `PbgData`, which no other
scheduled job touches, so overlap with any other job is harmless.

## `bom-mast`

Single step in `run-bom-mast.ts`, delegating to `runBomMastErpSync()`
(`bom-mast-sync.ts`):

- **`runBomMastErpSync()`** — `BOM MAST ERP` tab → `FullItem` / `Bom` /
  `BomItem`. `BOM_ID` → `Bom.bomId` (owner = the `FullItem` for `ITEM_CODE`),
  `RM_ITEM_CODE` → component (`RawMaterial.erpItemCode` first, else a sub-assembly
  `FullItem`). Missing owning `FullItem`s and `Bom`/`BomItem` rows are created;
  `BomItem` rows the sheet no longer backs are kept but unlinked (component
  pointers set to `null`). **Quantity and cost are deliberately not synced**, so
  manual `BomItem.cost` edits made from Supply History are preserved.

The manual route `POST /api/sync/bom_from_erp` is a thin wrapper around the same
`runBomMastErpSync()`, so the two paths cannot drift. The manual Supply History
sync (`POST /api/supply-history/sync`) also runs `runBomMastErpSync()` first, so
pressing the dashboard's Sync button refreshes BOMs without waiting for :05. No
file here imports `@/app/actions`, so a scheduled run can never be served a
cached Server Action result.


## `raw-material`

Four sequential steps in `run-gmd-update.ts`:

1. **`runGmdCatalogueSync()`** (`gmd-update-catalogue.ts`) — `GMD UPDATION`
   tab → `RawMaterial`. Creates rows for ERP codes not yet in the DB; on
   existing codes overwrites **only** the sheet-owned fields, and only when
   the sheet value is non-blank and differs. Rows whose `NEW ITEM STATUS` is
   `CLOSED` / `TO BE CLOSED` / `TO BE LOCKED` are dropped. Never deletes.
   Recomputes `ITEM NAME (derived)` for created and changed rows.
2. **`runStockPhysSync()`** (`gmd-update-stock-phys.ts`) — `stock-phys` tab's
   `SUM OF PHYSICAL STOCK` → `RawMaterial.availableStock`, overwriting stored
   values.
3. **`runRawMaterialItemNameSync()`** (`item-name-sync.ts`) — `ITEM MASTER ERP`
   (gid 253020709) `ITEM_NAME` → `RawMaterial.itemNameAuto`, matched on
   `erpItemCode` (trim + upper-case). Writes only when the name differs.
   `itemNameAuto` is excluded from step 1's overwrite set, so this step is the
   sole writer.
4. **`runActiveBomRules()`** (`lib/autoBomRun.ts`) — runs every **active**
   Auto BOM rule (`/bom/auto`) and creates `NEW-BOM-…` BOMs for full items
   that have no BOM. Inactive rules are skipped. Never throws: a failing rule
   is logged and counted in `steps.autoBom.failed`.

Steps are strictly sequential: a fatal failure in step 1 aborts before step 2,
because refreshing stock against a half-synced table is not useful.

### Why step 2 exists as a separate step

`availableStock` is user-editable, so the catalogue sync only ever sets it on
**newly created** rows — for an existing code it is skipped entirely. Before
this job, the only thing that refreshed stock was `npm run stock:sync -- --apply`,
run by hand. Step 2 is that refresh, on a schedule.

`SUM OF PHYSICAL STOCK` is a pre-aggregation maintained in the Google Sheet (a
pivot/QUERY result). Nothing here sums anything itself.

## `contract-review`

Five sequential steps in `run-contract-review.ts`:

| # | Step | File | What it writes |
|---|---|---|---|
| 1 | `runContractReviewSheetSync()` | `contract-review-sync.ts` | `ContractReview` (all mapped sheet columns) + owned side-effects `Enquiry.contractNo` and the not-current-reqt marks |
| 1b | `runContractReviewItemNameSync()` | `item-name-sync.ts` | `ContractReview.itemName` from `ITEM MASTER ERP` |
| 2 | `runContractReviewEnquirySync()` | `contract-review-enquiry.ts` | `ContractReview.state` / `.utility` / `.projectReference` |
| 3 | `runContractReviewRmAvailSync()` | `contract-review-rm-avail.ts` | `RawMaterial.availableStock`, `VerifyBom`, `ContractReview.noUse`, `ContractReview.rmPhysicalStock` |
| 4 | `runIcDumpSync()` | `contract-review-ic-dump.ts` | `ContractReview.offerNumber` / `.inspectionNumber` / `.diDate` |

Step 1 reads `CONTRACTS` (GID 734728893, header row 4) and `DUMP` (GID
1604813523, header row 1) from `CONTRACT_REVIEW_SPREADSHEET_ID`. Step 1b reads
`ITEM MASTER ERP` (gid 253020709) from the BOM MAST ERP workbook. Step 3 reads
`stock-phys` from `GOOGLE_SPREADSHEET_ID`. Step 4 reads `INSPECTION OFFER DUMP`
(GID 148043829) from the BOM MAST ERP workbook.

The order is a real dependency chain: step 3's RM AVAIL reads `VerifyBom`, whose
`itemName` is sourced from `ContractReview.itemName` ordered by `syncedAt desc`
(`lib/verifyBomLookup.ts:236`), so step 1b runs before step 3 to expose the ITEM
MASTER name. `ContractReview.itemName` is in step 1's `SKIP_FIELDS`, so step 1b
is its sole writer. Step 4 joins on the `mcNo` + `itemCode` pair that step 1
populates.

**Nothing in this job runs twice.** The manual SYNC route also performs the
VerifyBom and RM AVAIL recomputes, but here they are owned by step 3 only. Step
4 does not appear in any manual path except its own CLI (`npm run ic:sync`).

### Step 2 is normally a no-op

`app/api/contract-review/sync/route.ts:233-234` already calls the identical
`computeContractReviewEnquiryBackfill` + `applyContractReviewEnquiryBackfill`
pair, so by the time step 2 runs the diff is `changed === 0`. It is kept as its
own step because it is cheap (two queries, zero writes in steady state) and is
independently useful when the sheet sync is skipped. `steps.enquiry.noOp` makes
the redundancy visible rather than silent.

Worth knowing: a `ContractReview` row whose `contractNo` matches no Enquiry gets
all three fields set to `null`. This is the only code path that blanks them.

### Step 1 is a Map diff, not N lookups

`ContractReview` has **no `@@index` and no `@@unique`**. The manual route calls
`findFirst({ itemCode, contractNo })` once per sheet row, serially — so N
sequential full-table scans, roughly 2N round-trips total. This job loads the
existing rows once, keys them in a Map, and diffs in memory: ~1 query instead of
~2N. Same write policy, same result.

The preload's column list is derived at runtime from `mapContractReviewRow`
itself (`Object.keys(mapContractReviewRow([], null, [], []))`), so adding a column
to the mapper cannot silently desync it.

### Step 3 changed the stock policy on purpose

The manual button gap-fills `RawMaterial.availableStock`
(`availableStock IS NULL OR ''`), so stock is right on the first run and
permanently stale afterwards — useless hourly. This job overwrites when the sheet
value differs, skips blanks so a blank cell can never clear a real value, and
treats `"0"` as a real count.

Note `RawMaterial` is a **different table** from `GMDUpdateItem`, and it is the
one `recomputeVerifyBomValues` actually reads (`lib/verifyBomLookup.ts:257`).
The `raw-material` job writes `GMDUpdateItem`; this one writes `RawMaterial`.
Both are needed and neither feeds the other.

Step 3's `noUse` transaction is chunked at 200 with a 20 s timeout. The manual
version wraps every differing row in one unbounded `$transaction`
(`app/actions/*.ts:5260`) — a `P2028` waiting to happen.

### Cost of RM AVAIL's physical-stock sub-step

`rmPhysicalStock` needs `ContractReview.costCodeRef`, which step 1 **cannot**
populate: it is absent from `CONTRACTS_SHEET_COLUMNS`, so
`mapContractReviewRow` never emits it. It is published separately from the
Indent Listing by `recomputeIndentListingVersionsAction`. Until that has run,
that sub-step resolves nothing and writes `null`.

### Step 4 — IC dump (offer / inspection / DI)

`runIcDumpSync()` unions `offerNumber`, `inspectionNumber` and `diDate` onto
`ContractReview` rows matched on **MC No + Item Code**, from the
`INSPECTION OFFER DUMP` tab (gid 148043829) of the BOM MAST ERP workbook.

Column mapping is **positional**, because the sheet's header names do not match
our field names — column A is literally `VRNO` but lands in `offerNumber`:

| Col | Idx | Sheet header | → DB field |
|---|---|---|---|
| A | 0 | `VRNO` | `offerNumber[]` |
| C | 2 | `ITEM_CODE` | `itemCode` (key) |
| G | 6 | `CONTRACT_VRNO` | `mcNo` (key) |
| H | 7 | `INSPE_VRNO` | `inspectionNumber[]` |
| K | 10 | `DI_DATE` | `diDate[]` |

A **fail-fast header guard** asserts each index still carries the expected
header, so a column inserted or renamed in the sheet aborts the run instead of
silently writing the wrong data.

#### Union, never shrink

Values are **appended** if an equivalent one is not already present, compared
after normalisation (trim, collapse whitespace, upper-case) so `id22y-18` and
`ID22Y-18` are the same value. Existing values are never removed, and the DB's
own order and casing are preserved.

Two consequences:

- **A blank sheet cell can never clear a stored value** — `db ∪ [] = db`, so
  this falls out of the union rather than needing a separate guard.
- If the sheet has fewer comma-values than the DB, the DB array keeps all of
  them. This is the opposite of the other syncs' replace semantics, and it is
  deliberate.

It matters beyond tidiness: `offerPendingDone` is DONE iff
`itemCode + mcNo + offerNumber` are set, and `inspection` is DONE iff
`offerNumber + inspectionNumber` are set
(`app/contract_review/page.tsx:1223,1258`). Clearing one of these arrays would
silently flip a row from DONE back to PENDING.

#### Independent of the manual script — and the duplication that implies

`scripts/sync-ic-dump.ts` is the manual CLI (`npm run ic:sync` /
`ic:sync:apply`, dry-run by default) and was **deliberately left untouched**.
This step is an independent port, so the following exist in two places:

- `IC_DUMP_GID`, the five column indices, and `EXPECTED_HEADERS`
- the fetch → header-guard → match → write flow

The **merge rules are shared**, not duplicated — both sides import
`lib/gmd_lib/ic-dump-merge.ts`, which is unit-tested.

The header guard catches a column being reordered in the **sheet**, but it
cannot catch someone editing the indices in only one of the two files. The
constant block in `contract-review-ic-dump.ts` names the counterpart script and
its line numbers. **If you change the mapping, change both.** Collapsing these
into one shared implementation is a reasonable follow-up.

#### Differences from the CLI script

1. **No `--apply` gate** — the scheduled path always writes. `dryRun` is
   forwarded from the orchestrator for a manual check.
2. **Per-batch error containment** — each 200-row transaction is caught
   individually, so one failed batch increments `failedWrites` and the run
   continues, instead of aborting with the rest unwritten.

Because a failed batch still returns `200` with `success: true`,
`contract-review-sync.sh` greps for `"failedWrites":[1-9]` as well as
`"success": *false`.

## `supply-history`

Two steps, in order:

1. `runSupplyHistorySync()` in `supply-history-sync.ts`. Reads the `MASTER` tab of
   `SUPPLY_HISTORY_SPREADSHEET_ID` plus `buildGmdClientwiseOrderLinkMap()` for
   ORDER LIST links — **4 Google calls per run**. Writes only
   `SupplyHistoryItem`, joined on
   `normalizeKey(invoiceNo) + "||" + normalizeKey(itemName)`.
2. `runSupplyRateBackfill({ overwrite: true })` in `lib/supplyRateBackfill.ts`.
   Reads the `SALE_BILL_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` — **1
   more Google call** — and writes `rate`, `value = quantity x rate` and
   `grossTotalInvoiceValue = value x 1.18`. It runs second on purpose: MASTER
   still seeds `value` / gross total on INSERT, and both fields are in
   `SYNC_EXCLUDED_FIELDS`, so the backfill owns them afterwards and the two
   writers cannot fight.

This is the heaviest of the four: it full-table-reads `SupplyHistoryItem` and
stamps `syncedAt` on nearly every row, every hour.

### The rate backfill

The `SALE_BILL` tab is keyed on the exact `(VRNO, ITEM_CODE)` pair, normalised on
both sides — the same identity `execution-tracking` uses. It is read **without**
a fiscal-year filter, so rows from every year backfill in one pass. A line with
no item code cannot be attributed to one row when its invoice owns several, so
it is skipped and counted (`skippedNoCode`) rather than guessed.

Overwrite, not gap-fill: the matched sale-bill rate replaces a stored `rate`,
`value` is recomputed as `quantity x rate`, and the gross total is recomputed as
`value x 1.18`. A row with no matched rate keeps its stored rate, so `value` still
recomputes from it; a row with no rate at all keeps its stored `value`, and the
gross total follows that value. Nothing is ever cleared.

`value / quantity` is the RM unit cost in `lib/gmdBomCostLookup.ts`, so this step
moves quotation product cost — the unit cost becomes the sale-bill rate for every
matched row. The one-off overwrite of the existing table is
`scripts/backfill-supply-rate-value.ts` (`supply:rate-value`, dry run by default).

A failure here is caught and reported (`rateBackfillError`) rather than thrown —
the MASTER row sync is the job's contract, the backfill is enrichment.

### What changed from the manual route

The write policy is unchanged. Six things around it were changed to make it safe
on a schedule:

- **The `syncedAt` touch loop is one statement per chunk, not 500.** Every row in
  a chunk is stamped with the *same* `syncedAt`, so `updateMany` is exactly
  equivalent to the original's per-row updates. The comment there — "we need same
  syncedAt" — is the only reason it was never collapsed.
- **In-sheet duplicate keys are detected.** The join key is normalised but the
  Postgres `@@unique([invoiceNo, itemName])` is case- and whitespace-sensitive,
  and only `.trim()` is persisted. Two sheet rows differing only in case share a
  key, both take the `!existing` branch, and both insert; the next run then
  orphans one permanently. Now counted as `duplicateInSheet` and skipped.
- **Rejected writes are counted.** The original counted only fulfilled touches
  and never logged rejections, so a failed `syncedAt` bump vanished from the
  report. Now `failedWrites`.
- **The preload select is derived from `mapSheetRowToDb`** rather than
  hand-listed, so adding a column cannot silently desync it.
- **Concurrency is bounded** with `p-limit` at 10; the original fans out 200.
- **`SUPPLY_HISTORY_SPREADSHEET_ID` is validated up front** instead of letting
  `undefined` reach Google.

`count = inserted + patched + touched` in the original is meaningless as a
change metric, because `touched` is every unchanged row. Use `changed`
(`inserted + patched`).

`GMD_CLIENTWISE_SPREADSHEET_ID` was unset and silently falling back to a
hard-coded id inside `lib/gmd_lib/contract-order-links.ts`. It is now set
explicitly in `.env`.

## `c-batch`

Single step: `runCBatchSync()` in `c-batch.ts`. Marks `cBatch = "C"` on every
row whose item code carries `ITEM_STATUS = "C"` in the `ITEM MASTER ERP` tab
(gid 253020709) of the BOM MAST ERP workbook.

| Table | Code column(s) |
|---|---|
| `RawMaterial` | `erpItemCode` |
| `ContractReview` | `itemCode` |
| `SupplyHistoryItem` | `erpItemCode` |
| `EnquiryItem` | `erpItemCode` **or** `rmItemCode` |

`VerifyBom` is deliberately excluded — `/bom`'s `cBatch` comes from the BOM MAST
ERP `TO_DATE` flow, a different signal.

**Set-only by design.** Nothing is ever cleared, so a code that flips C → U keeps
its mark and re-running is idempotent.

This is the only job so far whose logic had to be genuinely *ported* rather than
delegated: `syncCBatchAction` has all its logic inline in `"use server"`. The
pure matching is in `planCBatchMarks()`, testable without a database.

### Five bugs fixed

1. **Rows were counted but never written.** The action built its `updateMany`
   filter from upper-cased codes while the code columns are persisted with the
   source sheet's casing — and Postgres `IN` is byte-exact. `RawMaterial` is the
   worst affected because its sync route stores the raw sheet value. Affected
   rows showed as `+N` in the dialog and were silently never marked, forever.
   Writes are now keyed on the primary key.
2. **Already-marked rows were rewritten every run.** The `where` filtered on the
   code, never on `cBatch`, so `pending > 0` made the loop iterate over *all*
   matched codes and churn `updatedAt` on all four tables. Only pending rows are
   written now, which also makes `rowsUpdated` truthful.
3. **O(n·m) in the `RawMaterial` block** — it used `Array.includes` where the
   other three correctly used a `Set`. Now a `Set` throughout.
4. **Duplicate `ITEM_CODE` rows lost their `"C"`.**
   `readItemMasterErp` guards duplicates on `nameByCode.has(code)`, so when a
   code's first row has an `ITEM_NAME` but a blank `ITEM_STATUS`, the later
   duplicate is skipped and its `"C"` is discarded. This job parses the sheet
   with a `seen` set keyed on the code, reusing the same module's exported
   `readSheetTabByGid` / `requireColumns` / `cell`, so no sheet-read plumbing is
   duplicated. `duplicateSheetCodes` is now reported (the action discarded it).
5. **A table failure hid the others.** All four ran inside one `try`/`catch`
   that discarded the accumulated `perTable`, so a partial write looked
   identical to no write. Tables are now attempted independently and failures
   surface in `failedTables`.

### `RawMaterial`, not `GMDUpdateItem`

The comment in the original says "GMDUpdateItem.erpItemCode" but the code reads
`prisma.rawMaterial`. The code is right — the UI reads `prisma.rawMaterial`
(`app/raw_material/api/gmd-update/route.ts:9`). These are **two different
tables**, and `schedular_function/contract-review-rm-avail.ts` also writes the
`RawMaterial` one.

### Scaling note

Three of the four code columns have **no index**: `SupplyHistoryItem.erpItemCode`,
`EnquiryItem.erpItemCode` / `rmItemCode`, and `ContractReview.itemCode`. Only
`RawMaterial.erpItemCode` is indexed. Selecting by `id` avoids `IN` on those
columns, so the job is cheaper than the original — but `ContractReview` and
`EnquiryItem` are still full scans.

## `physical-stock-cost-bom`

Single step in `run-physical-stock-cost-bom.ts`, delegating to
`applyPhysicalStockDerivations()` (`lib/gmd_lib/physical-stock-derive.ts`),
which recomputes `cost` / `bom_id` / `majorminor_marking` for every row of the
**stock DB** `PhysicalStock` table.

This is the scheduled form of `npm run physical:cost` / `physical:cost:apply`
(`scripts/backfill-physical-stock-cost-bom.ts`, dry-run by default — the
scheduler always writes).

**Cross-database.** The BOM graph is read from the **local** database:
candidate BOMs for an `erp_code` are the union of BOMs owned by the `FullItem`
whose `itemCode` = the code, plus BOMs that consume the code as a component
(`BomItem.rawMaterial` / `BomItem.fullItem`). Effective cost per candidate is
the owning `FullItem.cost` — the DB trigger keeps `FullItem.cost =
MAX(BomItem.cost)` — falling back to `RawMaterial.cost`. The chosen values are
written to the **stock DB** `PhysicalStock` table. There is **no shared
transaction**; the step is idempotent and safe to re-run.

**Write policy:** an existing `bom_id` is preserved while it is still a valid
candidate; otherwise the highest-cost BOM becomes the default. `cost` is always
refreshed to the effective cost of the selected (or default) BOM.
`majorminor_marking` is derived from `RawMaterial.majorMarking` matched on
`erpItemCode`: `true` for `'true'`, `false` for `'false'`, `null` when no
RawMaterial matches (or the flag is blank). **No other column is ever touched**
— not the user-editable fields (`remarks`, `item_type`,
`price`, `moq`, `if_less_than_moq_extra_charges`, `drawing_technical_data`) and
not the sheet-owned fields. Writes are chunked at 100 inside a stock DB
transaction with an extended timeout (large first-run batches exceed the
default 5s).

Scheduled at :10 — after `bom-mast` (:05), whose `FullItem` / `Bom` / `BomItem`
rows this step reads. It writes only the stock DB, so it never contends with another job
for the local database.

`physical-stock-cost-bom-sync.sh` only needs the same failure guards as
`bom-mast-sync.sh`: a fatal error throws out of the orchestrator and arrives as a
non-200/`success:false`.

**Deployment prerequisite:** `STOCK_DATABASE_URL` must be present in the app's
production env (`.env.production`) for this job (and the Physical Stock page)
to reach the stock DB.

## `pbg`

Single step in `run-pbg.ts`, delegating to `syncPbgData()`
(`lib/pbg/pbg-data.ts`) — the **same function** the PBG dashboard's Sync button
calls (`syncPbgDataAction`), so the scheduled and manual paths cannot drift.

Reads the PBG sheet tab and upserts only the sheet-owned columns, keyed on the
BG number: `BG_NO`, `BG_AMT` → `bgAmtFc`, `CANCELLED_STATUS` → `status`,
`MARGIN %` → `marginPct`, `MARGIN_AMT` → `marginAmount` and
`BENEFICIARY_NAME` → `clientName`. A BG number absent from the DB is inserted;
an existing row is updated only where the sheet value is non-blank and differs.
A blank (`-`, `--`, `—`, `–`) never clears a stored value. Nothing is ever
deleted, and every other column (PO no., PO date, `bankGuarantee`,
`validityOn`, …) is left untouched.

Run by ofelia on `@every 1h12m` (72 minutes) — see the *Jobs* grid note. It
writes only `PbgData`, which no other scheduled job touches, so overlap with any
other job is harmless.

`pbg-sync.sh` needs only the credential probe and the `success:false` guard:
`syncPbgData()` throws on a failed write rather than counting rejects, so there
is no `failedWrites` counter to grep for.

### Deployment (infra repo)

The app side ships with the normal image. The schedule itself lives in the infra
repo/container:

1. Add the `[job-local "pbg-sync"]` block from `infra/pbg.conf` to the ofelia
   config the daemon loads.
2. Place `infra/pbg-sync.sh` at `/scripts/api/pbg-sync.sh` and `chmod +x`.
3. `GMD_APP_SERVER` and `GMD_SYNC_API_KEY` are already set for the other seven
   jobs — no new secret is needed.
4. Reload or restart ofelia.

Verify: `GET $GMD_APP_SERVER/api/scheduler/pbg` with `x-api-key` returns
`auth:"ok"`; `docker logs <ofelia> | grep pbg` shows the run; the app logs a
`[SCHEDULER] pbg ... done` block.

## `docket-creation`

Two steps in `run-docket-creation.ts`:

1. `runPendingDocketCreation()` (`docket-creation.ts`) — creates dockets for new mail.
2. `runPendingDocketDedupe()` (`docket-dedupe.ts`) — deletes pending duplicates of
   a mail that already has a docket.

Step 1: for **recent** `DocketQuotationThread` rows (today's IST calendar day plus
the previous `BACKLOG_DAYS` = 5, via `istDayWindow` in `lib/docketPending`,
because the container runs UTC) with `pendingDocket = true`, `docketNo = null`, no
docket already linked to the mail and `duplicateOfDocket = null`, it creates an
`Enquiry`, extracting line items from the mail content:

1. Allocates the next fiscal docket number(s) via `nextDocketSerials`
   (`lib/docketNumber`) from the current fiscal year's existing dockets.
2. Resolves the party name via `resolvePartyForThread`
   (`lib/pendingDocketMaterializer`): first email match against previous dockets,
   then the thread's own `partyName`, then `sub_category`, else `"Unknown"`.
3. Splits the thread's addresses via `splitThreadEmails`: `senderEmail` is the
   **single** external sender (future email "To") and `emailAddress` is the
   remaining cc list. Internal addresses are **never** stored. When the thread
   has no usable external email (internal-only/empty) or any of its
   `sender`/`to`/`cc` carries an internal address, the party's emails are taken
   from the **most recent docket** of that party name (resolved from its source
   thread, not the union across dockets); threads with the same `sub_category`
   only bootstrap parties that have no docket.
4. Extracts `{ itemName, quantity }` pairs from the mail content — see *Item
   extraction* below.
5. Links the mail file attachments as-is (`parseThreadAttachments`) and renders a
   mail-snapshot PDF, uploading it to Google Drive (`buildSnapshotAttachment`).
6. In one `$transaction`, creates the `Enquiry` **with its `EnquiryItem` rows**
   and stamps the thread with the new `docketNo` + clears `pendingDocket`.

### One docket per mail, and a rolling backlog window

Two limits, both deliberate:

- **Recent mail only.** Threads dated today plus the previous `BACKLOG_DAYS`
  (5) IST days are eligible; anything older is left alone. The window reaches
  back because the mail ingestion can lag — on 2026-10-21 a whole day's mail
  arrived the next morning — and a today-only window loses every late mail
  permanently. A thread with a null `date` is never picked up.
- **One docket per mail.** Candidates are skipped when `Enquiry.sourceThreadId`
  already names their thread. This is the limit that actually holds: the stamp
  written on the thread in step 6 is **not** durable, because the external mail
  ingestion re-syncs the row and clears `docketNo` back to NULL with
  `pendingDocket = true` within the hour. Before `sourceThreadId` existed, each
  hourly run docketed the same NCC mail again — one thread reached 11 dockets.
  The link lives on the `Enquiry`, which the ingestion never touches. It is also
  re-checked immediately before each write (extraction can take minutes) and
  `Enquiry.sourceThreadId` is `@unique`, so an overlapping run cannot double-create
  even by accident; `POST /api/docket/automatic_create` sets the same link when
  a docket is created by hand. Skipped threads are counted in
  `skippedAlreadyDocketed`.

### Scheduled duplicate cleanup (step 2)

`runPendingDocketDedupe()` (`docket-dedupe.ts`) runs every hour immediately after
creation, even when the creation step has nothing to create. It reads every
zero-item docket — the blank subset of the dashboard's auto-created pending set —
and every thread, resolves each docket back to its source mail by
`Enquiry.sourceThreadId`, `thread.docketNo` or a unique attachment URL, and folds
threads whose normalised snapshot fingerprint matches (subject + sender + exact
mail date + body preview + attachment names). That last rule catches the mail
ingestion importing the same mail under a second Gmail thread id, which
`sourceThreadId` alone cannot.

Only zero-item dockets are deleted, and only when a keeper exists. The keeper is
the docket with items, else the one already linked to the thread, else the
earliest. A pending docket carrying work (`selectedContractNo`,
`offerPdfGeneratedAt`, `emailApproved`, `emailSentBy`, `duplicate` /
`duplicateOfDocket`) is reported and left alone. Unresolved or ambiguous groups
are reported, never deleted. The per-run cap is 50; the rest is picked up next
hour. Forwarded copies with a changed subject or sender are out of scope — the
manual `--rule-c-threads` path below remains for those.

Every folded thread is stamped `docketNo = keeper`, `pendingDocket = false` and
`duplicateOfDocket = keeper.docketNumber`. The ingestion clears the first two on
its next re-sync but never the last one, and `docket-creation` skips threads
where it is set, so a deleted duplicate cannot be recreated.

Counters are in `steps.dedupe`: `deleted`/`planned`, `deferred`, `skippedWork`,
`skippedAmbiguous`, `unresolved`, `failed`. A failing group is caught
individually and counted; `docket-creation-sync.sh` fails the run on
`"failed":[1-9]`.

Preview without writing (both steps are dry-run):

```sh
curl -X POST "$GMD_APP_SERVER/api/scheduler/docket-creation?dryRun=1" \
  -H "x-api-key: $GMD_SYNC_API_KEY"
```

### Cleaning up dockets that were created more than once

`scripts/dedupe-docket-threads.ts` (`npm run docket:dedupe` / `:apply`) is the
manual repair for everything the scheduled step leaves alone — older groups, and
rule C below. It also stamps `duplicateOfDocket` on the threads it re-points, so
its repairs are durable too. It resolves every docket back to its source thread
by three rules, in order:

- **A** — `thread.docketNo == docketNumber`.
- **B** — an exact match on the mail attachment URLs the job linked as-is.
- **C** — fallback for a mail that had **no attachments**, where B can never fire:
  the single thread sharing the docket's `partyName`, in the same IST day, that
  itself has no attachment links. Several candidates → left alone.

Dockets resolving to the same thread are duplicates. Rule A/B groups are deduped
automatically: keep the docket with items (else the earliest), re-point the thread
at the keeper, link the keeper with `sourceThreadId`. A duplicate carrying work
the keeper lacks (items, a selected contract, an offer PDF, an approved email, a
duplicate pointer) is reported and **skipped**, never deleted — the same content
check applies to items, so a duplicate with different lines is never dropped.

Rule C is a heuristic, so a group resting on it is **reported only, never
deleted**. Name it to act: `--rule-c-threads=<threadId>[,<threadId>]` deletes
every docket in those groups and keeps none — for a mail whose real docket already
exists under a different party name. An internal forward of a customer enquiry is
the case that needs it: the forward is docketed under the company's own name while
the customer's mail is docketed correctly, so every auto-created docket for the
forward should go. A named group needs at least two dockets, and any docket a
thread still points at is skipped rather than left dangling.

Dry run by default:

```bash
npm run docket:dedupe                                  # report
npm run docket:dedupe:apply                            # dedupe A/B groups
npx tsx scripts/dedupe-docket-threads.ts --apply --rule-c-threads=<threadId>
```

### Item extraction

`docket-item-extraction.ts` runs two stages over the thread's content: every
message body (`body` + `bodyPreview`), `ocrText`, and every attachment file.

- **Stage 1 — deterministic parser** (`docket-item-parser.ts`, pure and unit
  tested in `tests/docketItemParser.test.ts`). The email **body** is parsed
  line-by-line **and** as tables; `ocrText` and attachment text are parsed as
  **tables only**, so free-form OCR fragments (specs, inspection reports) cannot
  masquerade as line items. It handles numbered/bulleted lines with quantity
  units (`2 Nos`, `4 pcs`, `3 SET`), `Qty: 6` / `Quantity = 10` labels, tight
  ranges (`2-3 Nos` → 2), and pipe/tab tables with description + qty columns
  (preferring `Total Qty`, and folding an adjacent `Size / DN` column into the
  name). `itemName` is preserved verbatim; email headers, totals, rates,
  pressure/serial fragments, signatures and quoted lines are dropped. **A line
  with no explicit quantity is skipped.** Quoted reply history is de-duplicated
  on `itemName`+`quantity`.
- **Stage 2 — AI fallback** runs only when the parser finds **zero** items. It is
  off unless `AI_FALLBACK_ENABLED=true` and `OPENAI_API_KEY` is set. Model is
  `AI_EXTRACTION_MODEL` (default `gpt-6-luna`), `temperature: 0`, strict zod
  schema via `Output.object`, and it also drops items without a quantity.

Attachments are read by `docket-attachments.ts`: Drive links are downloaded via
the OAuth client, S3/public links via `fetch`. PDFs use `unpdf`, Excel/CSV use
`xlsx`, text files are read as utf8, and images are covered by `ocrText`. Each
file is bounded (max 10 files, 10 MB, 20 s); a failure is counted in
`attachmentFetchFailures` and never aborts the docket.

A thread with nothing extractable still gets a header-only docket, exactly as
before.

### Backfilling existing blank dockets

Dockets created before item extraction existed are backfilled by
`scripts/backfill-pending-docket-items.ts` (`npm run docket:backfill-items` /
`:apply`). It targets every `Enquiry` with zero items that has a source thread,
runs the same extraction pipeline, and inserts the items. Dry run by default;
`--apply` writes. Idempotent: a docket that already has items is not a target.

### `pendingDocket` is set upstream

Nothing in this repo sets `pendingDocket = true` for the creation job — the
external mail ingestion does. This job only **consumes** the flag. If no
ingestion is running, the job reports `pending: 0` and does nothing.

The ingestion also **clears** `docketNo` back to NULL and re-sets
`pendingDocket = true` when it re-syncs a thread row, so the stamp this job
writes on the thread does not survive the hour. That is why the per-mail guard is
`Enquiry.sourceThreadId` and not the stamp.

### Snapshot failures never abort a docket

A snapshot that cannot be rendered or uploaded is caught per docket, counted in
`snapshotFailures`, and the docket is still created with its mail attachments.
A failure of the `$transaction` itself is counted in `failed`, which is what
`docket-creation-sync.sh` greps for.

### Relationship to the old manual action

The manual `createPendingDocketsAction` in `app/actions/*.ts` and the two "Create
Pending Dockets" buttons (`EnquiryTable.tsx`, `app/docket_follow_up/page.tsx`)
were **removed**. The action is retained as a commented-out `LEGACY` block in
`app/actions/*.ts`, with its now-unused imports commented alongside it. This folder
is the source of truth for scheduled docket creation.

## `acc-master`

Single step: `runAccMasterSync()` in `acc-master-sync.ts`. Reads the
`ACC_MASTER_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID`
(`FORMATTED_VALUE`, header row 1) and copies `ACC_CODE` / `ACC_NAME` into the
local `acc_master` table.

The point is to keep Google out of `execution-tracking`'s hot path: that job
needs one name per consignee code, on every row it touches, every hour.
`acc-master` publishes the whole list once, `lib/accMasterLookup.ts` reads it in
one query, and the sync joins in memory.

Notes:

- Rows are matched on the **normalised** code (trim, collapse whitespace,
  upper-case), so a casing change in the sheet updates the existing row instead
  of creating a second one. The sheet's spelling is then kept as the stored
  value.
- A blank `ACC_NAME` never clears a stored name.
- A duplicate `ACC_CODE` in the sheet keeps the first row and is counted
  (`duplicateCodes`) — the codes are meant to be unique, so a duplicate is a
  sheet problem the report should surface, not a reason to fail the run.
- Rows the sheet no longer carries are **kept**. The list can only ever get more
  complete, never wrong, which keeps the sync that reads it safe.
- `execution-tracking` refreshes this table before it runs, so the manual path
  does not depend on the :35 job having fired.

## `ledger`

Daily at **01:55** (`0 55 1 * * *`, ofelia 6-field cron): after the hourly block and
before the working day, so the debtors and creditors pages open on that
morning's ledger. Entry: `runScheduledLedgerSync()` -> `runLedgerSync()` in
`ledger-sync.ts`, which `scripts/sync-debtors.ts` and `scripts/sync-creditors.ts`
also call (dry-run default, `--apply`, `--dump-headers` unchanged).

- Snapshot copy: each of `Debtor`, `Creditor`, `CreditorAdvance` is deleted and
  refilled **in its own transaction**. A renamed tab or column fails that ledger
  (`report.<ledger>.error`), leaves its table as it was, and does not stop the
  others. The route then returns `success:false` (HTTP 200) and the Ofelia script
  exits 1.
- Skipped rows (blank ACC_CODE, bad number/date) are counted, not fatal.
- Report: `{ debtors, creditors, advances }`, each `{ read, mapped, skipped,
  skippedRows, written, inDb, error? }`.
- The latch is in-process only; see the `shortcut:` comment in `ledger-sync.ts`.

## `execution-tracking`

Single step: `runExecutionTrackingStep()` in `execution-tracking-sync.ts` — the
ACC master refresh above, then `runExecutionTrackingSync()` from
`lib/executionTrackingSync.ts`, the same engine the CLI
(`npm run exec:sync`) and the `/supply_history` button use.

Reads the `SALE_BILL_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` and
diffs it into `SupplyHistoryItem`, for **one fiscal year**. The scheduler uses
the current fiscal year (`getFiscalYearLabel`, April start, the same helper the
docket numbers use — it yields the `2026-27` form the table stores); the button
passes a year chosen in the UI; the CLI takes `--fy`.

Column mapping is declarative — `SALE_BILL_COLUMN_MAP` in
`lib/gmd_lib/execution-tracking-columns.ts` is a list of
`{ sheetHeader, dbField }`, and the engine's preload, insert payload, diff loop
and report all iterate it. **Adding a column is one line.**

`consigneeName` is the one field not on the sheet: it is `ACC_NAME` for the row's
account code — SALE BILL's **`ACC_CODE`**, resolved through `acc_master`.

The tab also carries a `CONSIGNEE_CODE` column, and the two are not the same
thing: `ACC_CODE` is the **billed party**, `CONSIGNEE_CODE` is the **ship-to**.
They disagree on 357 of the 5,117 rows. Measured on the FY 26-27 disagreements,
the DB's stored `consigneeName` matched the `CONSIGNEE_CODE` name in 15 of 15
non-blank cases and the `ACC_CODE` name in none — so a run keyed on `ACC_CODE`
rewrites those rows to the billed party. That is the intended behaviour here
(the name always lands in `consigneeName` either way); switching back is a
one-line change to `SALE_BILL_KEY_HEADERS.accountCode`.

### The sheet is a line ledger; the table is one row per (invoice, item)

This is the shape that matters, and it was measured rather than assumed. For FY
2026-27: the sheet's 487 rows are **401 distinct `(VRNO, ITEM_CODE)` groups over
138 invoices** — the same item code appears on the same invoice more than once
(31 groups), because the sheet records each issue line. `SupplyHistoryItem` holds
**one** row per `(invoiceNo, erpItemCode)` — that pair is unique in the year, 0
duplicates — and its `quantity` is the **sum** of the sheet's lines. Verified on
all 320 pairs the two sides share: the sum matched the stored quantity in every
single case, with zero exceptions.

So the engine **folds the sheet's lines per `(invoiceNo, ITEM_CODE)` and sums
`QTYISSUED`** before diffing. This is not a nicety: taking the first line would
have written `96` over a stored `627` on GD26Y-00014 (three lines: 96 + 106 +
425) and corrupted 23 of those 320 rows. The first dry run did exactly that, which
is what the smoke test is for.

Grouping is on the item code, so a line that carries no code stays its own group
and is matched by invoice number alone (see below).

### Matching is the exact (invoice, item code) pair

A group matches the DB row with the same invoice number **and** item code. When no
such row exists it is a genuine new line, so the engine inserts rather than
touching a sibling — the earlier `invoiceNo`-only rule would have written a new
line's values onto whatever row the invoice happened to have.

Two cases stay conservative, both counted as `ambiguous` and skipped:

- **no item code on the sheet and the invoice owns several DB rows** — nothing can
  tell which row the line belongs to;
- **several DB rows share one `(invoice, item code)` pair** — 7 such pairs exist in
  the whole table, none in this year.

### Inserting needs a name, so it is resolved locally

`SupplyHistoryItem.itemName` is `NOT NULL`, and in practice never blank (0 of
15,467 rows). The sheet has no item name, so `lib/erpItemNameLookup.ts` resolves
one from what the DB already knows, in order: the name the item was supplied
under before (`SupplyHistoryItem`, most recent), then `FullItem.itemName`, then
`RawMaterial.itemNameAuto` / `itemNameDerived`, then `VerifyBom.itemName`.

Measured on the 54 codes FY 2026-27 needs but the table does not hold: 40 resolved
from step 1, all the rest from the following steps. Only a code no source knows
stays blank, and that is counted as `unnamedInserts` so the gap is visible rather
than invented.

An insert whose resolved name the invoice already uses is counted as
`blockedInserts` and skipped: the DB unique key is `(invoiceNo, itemName)`, so two
different item codes carrying the same name text on one invoice cannot both be
stored. Three such rows exist in FY 2026-27. Disambiguating them (appending the
item code to the name) is a one-line change if that ever matters; leaving the DB's
key alone was the deliberate choice.

### Two more layers: the description is what the table keys on

The table's identity is `(invoiceNo, itemName)` — a **description**, not a code —
so two rows that share a description on one invoice cannot both be stored. Two
layers keep that from losing data. Both are pure functions in
`lib/executionTrackingSync.ts`, unit-tested.

**1. Folding across item codes** (`mergeByDescription`). When different item codes
share a description on the same invoice, their rows fold into one and the
quantities are added — exactly what happens when the same code is listed twice.
Measured live in FY 2026-27:

```
GD26Y-00055  FRD020002 (6) + FSD040001 (20)   ->  FSD040001 qty 26
GD26Y-00098  FSD040001     + FRD020002        ->  FRD020002 qty 103
GD26Y-00126  FSD040113 (9) + FSD040050 (32)   ->  FSD040050 qty 41
GD26Y-00126  FSD040001 (1) + FRD020002 (16)   ->  FRD020002 qty 17
GD26Y-00136  FSD040038     + FSD040025        ->  FSD040025 qty 69
```

**The fold keys on the ERP master name** (`resolveMasterNames`: `FullItem` →
`RawMaterial` → `VerifyBom`, trailing `_` trimmed, `SupplyHistoryItem` excluded),
**never on the stored supply name.** That distinction is load-bearing:
`FVC030011` (`..._150_...`) and `FVC030012` (`..._200_...`) are different
products, but their *stored* names both read `..._200` because one is mislabelled.
Keying on the stored name merged a 150 mm into a 200 mm (`GD26Y-00019`,
`GD26Y-00082`, `GD26Y-00086`) and a gear box into an O-ring (`GD26Y-00092`). Keyed
on the master name, neither folds, and both invoices are plain updates.

Rules: the fold happens only when **everything except the quantity and the item
code matches** — uom, LR, canonical state, consignee address, account code. If any
differ, the rows are genuinely different entries and are left to the refusal path
below. The survivor is a code the invoice **already has a row for** where one
exists, so the fold lands as an update rather than a second insert that would
double-count; otherwise the lexicographically lowest. A code with no master name is
never folded. As with the line merge, a non-numeric quantity is never summed.

**2. Refreshing a stale stored name** (`planNameRefresh`). Sometimes the name an
insert needs is already held by a row whose *own* item code uses a different
description elsewhere in the table. On `GD26Y-00055` the `FSD040001` row sat under
the description the ERP master gives `FRD020002`, while every other `FSD040001` row
reads `Sluice Valve Ductile Iron Resilient Seated PN 1.0 HW OP. 100 MM`.
Refreshing that row to its own current name frees the other code's name and both
lines land.

Since the fold above now handles `GD26Y-00055` (it folds `FRD020002` into the
existing `FSD040001` row), this repair did not fire in the last dry run —
`nameRefreshes` was 0. It is kept because a collision can still arise that the fold
cannot settle.

This is the only case in which the sync writes `itemName` on an existing row. It
refuses — leaving the insert counted in `blockedInserts` — when there is no such
row, when that row was already refreshed in this run, when its code has no known
current name, when the current name *is* the name we want to free (the rename
would collide immediately), or when the invoice already uses that name elsewhere.
Refreshes are applied **before** the inserts, since an insert needing the freed
name would otherwise be rejected.

**Insert naming.** A new row is stored under its **supply** name (`resolveItemNames`),
because that is the vocabulary the MASTER sync matches on. Only when that name is
already taken on the invoice — and the stale-name repair did not apply — does the
row fall back to its **ERP master name**, which is what distinguishes two codes
whose stored names collide. Using the master name for *every* insert would desync
185 of the 979 codes that have both names (they use a different vocabulary), so the
fallback is deliberately narrow.

Together these are why `blockedInserts` is 0 for FY 2026-27 where it was 2, and why
`GD26Y-00126` contributes 12 rows instead of 11 plus a refusal.

### The fiscal year must match on both sides

A row is only considered when the sheet's own FY column — `ACC_YEAR` on the live
sheet, values `25-26` / `26-27` — equals the requested year (any spelling:
`26-27`, `2026-27`, `2026-2027`, `2627`; see `normalizeFiscalYear`), and the DB
preload is scoped to the same year. Because `financialYear` is free text that
older rows may have written differently, the preload queries the variants in
`fiscalYearVariants` and the comparison is on the normalised form.

Rows whose `financialYear` is **blank** are outside every variant, so the preload
also loads them (by invoice + item code) and fills the blank FY from `ACC_YEAR`.
Without that a blank-FY row can never match — by this job or by
`erp-contract-no` — and its quantity, state and date stay empty forever. Blanks
this job never reaches are filled once by `supply:fy:apply`
(`lib/supplyFiscalYearBackfill.ts`).

### Two writes the engine deliberately refuses

- **A blank cell never clears a value**, including the dash sentinels `-` `--`
  `—` `–`. Same rule as the MASTER sync.
- **`state` is written only when the sheet value is a recognised Indian state**
  (`canonicalizeState` in `lib/supplyStateResolver.ts`), and written in the DB's
  Title Case. Comparison is on the canonical form, so a row that already means
  the same thing (`Chattisgarh` vs `CHATTISGARH`) is never rewritten. An
  unrecognised value (`MH`, `Other`) leaves the field alone and lands in the
  report's `stateSkipped` samples.

### Every run is logged

`lib/syncLog.ts` writes one `sync_log` row per run — headline counts plus
`details`, the before/after of every add and change, capped at
`DETAIL_CAP` (2,000). A dry run is logged too (`mode = "dry-run"`), so the preview
an operator looked at sits next to the apply that followed it. `kind` keeps the
table shared: `"execution-tracking"` and `"acc-master"` today.

### Manual control

```sh
npm run exec:headers                                  # read-only: real headers + column map + acc_master state
npm run exec:sync -- --acc-only --apply               # fill acc_master (cache refresh, not business data)
npm run exec:sync -- --fy 26-27                       # dry run, prints the report
npm run exec:sync -- --fy 26-27 --limit 20            # smoke test the first 20 rows
npm run exec:sync -- --fy 26-27 --apply               # write
npm run exec:sync -- --fy 26-27 --apply --no-log      # write without a sync_log row

# the same engine over HTTP (dryRun / fy are optional)
curl -X POST "$BASE/execution-tracking?dryRun=1&fy=2025-26" -H "x-api-key: $GMD_SYNC_API_KEY"
```

## `erp-contract-no`

Single step: `runErpContractNoStep()` in `erp-contract-no-sync.ts`, delegating to
`runErpContractNoSync()` (`lib/erpContractNoSync.ts`) — the same engine the CLI
(`npm run contractno:sync`) and `POST /api/scheduler/erp-contract-no` use.

Reads the `SALE_BILL_GID` and `MC_GID` tabs of
`GMD_EXECUTION_TRACKING_SPREADSHEET_ID` and writes
`SupplyHistoryItem.erpContractNo`. The scheduler uses the current fiscal year
(April start); the CLI takes `--fy`.

### The join is invoice-level, and that was measured

`SALE BILL.ORDER_VRNO = MC.VRNO -> MC.CONTRACT_VRNO`. Measured on FY 2026-27:

- 487 SALE BILL rows, **103 distinct `ORDER_VRNO`** (136 distinct invoices — two
  invoices can share one order), 2 rows with a blank `ORDER_VRNO`;
- all 103 orders are present in MC;
- MC carries **708 `VRNO`s and none holds more than one `CONTRACT_VRNO`**, so the
  order -> contract lookup is 1:1 and the write is per **invoice** (`VRNO`):
  every `SupplyHistoryItem` row of a matched invoice gets the same contract.

The `rowIds` actually written are only the rows whose stored value differs, so an
invoice that is already correct produces no write and no `syncedAt` bump.

### Write policy

| Case | Rule |
|---|---|
| stored `erpContractNo` equals MC's `CONTRACT_VRNO` | **left alone**, counted `unchangedInvoices` |
| stored value blank | **filled** (`filledRows`) |
| stored value non-blank **and different** | **overwritten** — MC wins (`overwrittenRows`); `--gap-fill` turns this into a no-op |
| MC `CONTRACT_VRNO` blank, or the `ORDER_VRNO` unknown to MC | **no write**, counted `noContractOnMc` / `unmatchedOrderVrno` — a blank cell never clears a value |
| SALE BILL lines carry no `ORDER_VRNO` for a DB invoice | **no write**, counted `noOrderVrnoInSheet` |
| MC `VRNO` with more than one `CONTRACT_VRNO` | reported as `mcConflicts`; the lexicographically first value is used |
| deletions | none |

### Two writers of `erpContractNo`

`supply-history` (:15) also writes this column, from MASTER's `ERP CONTRACT NO`.
On FY 2026-27 the two sources agree on every comparable row (254 of 254), so
there is no flip-flop — but `overwrittenRows > 0` is the signal to watch: if
MASTER ever carries a different spelling for the same row, the two jobs will
rewrite each other every hour. Making `supply-history` stop owning the column is
the clean follow-up if that ever happens.

### Manual control

```sh
npm run contractno:headers                             # read-only: both tabs' headers + column map + DB counts
npm run contractno:sync -- --fy 26-27                  # dry run, prints the report
npm run contractno:sync -- --fy 26-27 --limit 20        # smoke test the first 20 invoices
npm run contractno:sync -- --fy 26-27 --apply           # write
npm run contractno:sync -- --fy 26-27 --apply --gap-fill # write, but never overwrite a stored value
npm run contractno:sync -- --fy 26-27 --apply --no-log   # write without a sync_log row

# the same engine over HTTP (dryRun / fy are optional)
curl -X POST "$BASE/erp-contract-no?dryRun=1&fy=2025-26" -H "x-api-key: $GMD_SYNC_API_KEY"
```

## Write policy

### `acc-master`

| Column | Rule |
|---|---|
| `acc_code`, `acc_name` on a **new** code | written |
| `acc_name` on an existing code | overwritten when the sheet value is non-blank and differs; a blank never clears |
| `acc_code` on an existing code | updated to the sheet's spelling when it differs only in case/spacing; matched on the normalised form |
| codes the sheet no longer lists | **kept** |
| deletions | none |

### `execution-tracking`

| Column | Rule |
|---|---|
| `quantity` | the **sum** of the sheet's lines for that `(invoice, item code)`, **plus** any row folded in by the description merge; a non-numeric value is never summed — the first non-blank is kept |
| `uom`, `lrNoDt`, `consigneeAddress`, `erpItemCode`, `consigneeName` | overwritten when the merged sheet value is non-blank and differs |
| `state` | overwritten when the sheet value is a recognised Indian state and the canonical form differs; written in Title Case |
| `date` | **gap-fill only**, from `VRDATE` normalised to `dd-MMM-yyyy`: written when the DB cell is blank, never over a date MASTER supplied; also set on insert. Skipped when the tab has no `VRDATE` column |
| blank / `-` `--` `—` `–` cells | never overwrite, never clear |
| `invoiceNo` | match key, never written |
| `itemName` | resolved by `lib/erpItemNameLookup.ts` on insert; on an existing row it is written **only** by the stale-name refresh (`planNameRefresh`), which frees a name a colliding insert needs |
| `financialYear` | set from `ACC_YEAR` (as `2026-27`) on insert; on an existing row it is **gap-filled only when blank** — a blank FY sits outside every job's scope filter, so this is the only path that can repair it. A stored value is never rewritten, not even a differently-spelled one (`26-27`) |
| item codes sharing a description | folded into one row by `mergeByDescription` when every other field agrees |
| new rows | inserted for a `(invoice, item code)` pair the year does not hold; refused and counted in `blockedInserts` only when no fold and no refresh can resolve the name |
| `syncedAt` | stamped only on rows actually written |
| deletions | none |

### `erp-contract-no`

| Column | Rule |
|---|---|
| `erpContractNo` | set to MC's `CONTRACT_VRNO` for the invoice, keyed on `SALE BILL.ORDER_VRNO = MC.VRNO`. **Filled** when blank, **overwritten** when it differs (MC wins; `--gap-fill` prevents the overwrite) |
| `erpContractNo`, MC value blank or order unmatched | left alone — a blank never clears a stored value |
| `syncedAt` | stamped only on rows actually written |
| every other column | never touched |
| deletions | none |

### `raw-material`

| Column | Catalogue step | Stock step |
|---|---|---|
| 25 sheet columns, on **new** rows | written | — |
| 12 sheet-owned columns on **existing** rows | overwritten if non-blank and changed | — |
| 13 user-owned columns (cost, aum, hsnCode, …) | never touched | never touched |
| `availableStock` on new rows | seeded from stock-phys | — |
| `availableStock` on existing rows | never touched | overwritten |
| `itemNameDerived` | recomputed for created/changed | — |
| deletions | none | none |

Stock-step edge cases:

- A blank `stock-phys` cell **never clears** a stored value.
- `"0"` is a real count and **is** written.
- Writes are keyed on the primary key, so a code stored lower-case or padded
  still updates.

### `contract-review`

| Column | Written by | Rule |
|---|---|---|
| mapped sheet columns, **new** rows | step 1 | written, except `itemType` / `rmCodeForActuator` |
| 11 `PRESERVE_UI_FIELDS` | step 1 | **gap-fill only** — an existing DB value is never overwritten |
| 6 `SKIP_FIELDS` (`itemType`, `rmCodeForActuator`, `diagramUrl`, `diagramVerdict`, `cBatch`, `nBatch`) | — | never written |
| every other mapped column | step 1 | overwritten when the sheet value is non-blank and differs; a blank never clears |
| `contractNo` / `itemCode` | — | immutable keys |
| `state` / `utility` / `projectReference` | step 2 | **full replace**, and set to `null` when no Enquiry matches |
| `costCodeRef` | — | never written by this job |
| `RawMaterial.availableStock` | step 3 | overwritten when the sheet differs; blank skipped; `"0"` written |
| `VerifyBom.*` | step 3 | only where a value actually differs |
| `ContractReview.noUse` | step 3 | overwritten |
| `ContractReview.rmPhysicalStock` | step 3 | overwritten, including to `null` when `costCodeRef` resolves to nothing |
| `offerNumber` / `inspectionNumber` / `diDate` | step 4 | **union, never shrink** — values are appended, never removed or overwritten. A blank sheet cell adds nothing, so it can never clear a value |
| deletions | — | none, in any step |

### `supply-history`

| Column | Rule |
|---|---|
| `partyMailAddress`, `state`, `utility` | **gap-fill only** — an existing DB value is never overwritten |
| `orderList` | **monotonic CSV union** — links are only ever added, so a removed attachment stays in the DB |
| every other mapped column | overwritten when the sheet value is non-blank and differs |
| blank sheet values, including `-` `--` `—` `–` | **never** overwrite and **never** clear a stored value |
| `derivedItemType`, `derivedMoc`, `derivedSize` | never touched — populated out of band by `scripts/derive-supply-fields.ts` and the UI |
| `cBatch` | never touched (owned by the `c-batch` job) |
| `rate` | **gap-fill only** — filled from the `SALE_BILL` tab's `RATE` where blank; never the MASTER sync's (not in `mapSheetRowToDb`) |
| `value` | two writers: the MASTER sync overwrites from MASTER's `Value` when non-blank and different; the rate backfill fills it where still blank, as `quantity x rate` |
| `invoiceNo` / `itemName` | immutable join keys |
| deletions | none |

### `pbg`

| Column | Rule |
|---|---|
| `bgNo` (`BG_NO`) | join key — immutable |
| `bgAmtFc` (`BG_AMT`), `status` (`CANCELLED_STATUS`), `marginPct` (`MARGIN %`), `marginAmount` (`MARGIN_AMT`), `clientName` (`BENEFICIARY_NAME`) | inserted for new BG numbers; overwritten on existing rows only when the sheet value is non-blank and differs |
| blank sheet values, including `-` `--` `—` `–` | **never** overwrite and **never** clear a stored value |
| `poNumber`, `poDate`, `bgDate`, `expiryDate`, `claimDate`, `contactPerson`, `contactNumber`, `remark`, `bankGuarantee`, `validityOn` | never touched (PO/PO date are derived at read time from Supply History) |
| deletions | none |

### `c-batch`

| Table | Column | Rule |
| `RawMaterial`, `ContractReview`, `SupplyHistoryItem`, `EnquiryItem` | `cBatch` | set to `"C"` when any code column matches. **Set-only** — never cleared, never overwritten once marked. No other column is touched, and `VerifyBom` is not touched at all. |

### `docket-creation`

| Table | Column | Rule |
|---|---|---|
| `Enquiry` | `docketNumber`, `partyName`, `enquiryDate`, `senderEmail`, `emailAddress` | **create only** — a new docket per pending thread. `senderEmail` holds the thread sender (future "To"); `emailAddress` holds the cc/rest list. Existing dockets are never touched. |
| `Enquiry` | attachments | mail attachments linked as-is + one generated snapshot PDF. |
| `EnquiryItem` | `itemName`, `quantity`, `position` | **create only** — one row per extracted line item. A thread with nothing extractable gets no items. `erpItemCode` is left null. |
| `DocketQuotationThread` | `docketNo`, `pendingDocket` | stamped with the new number and `pendingDocket` set to `false`. Never cleared or re-pointed. |
| deletions | — | none. |

## Auth

`requireSyncApiKey()` in `auth.ts`, shared by every scheduled endpoint:

- Header: `x-api-key`
- Env var: `GMD_SYNC_API_KEY` (configured in the infra container; never committed)
- Comparison: `sha256` both sides, then `crypto.timingSafeEqual` — constant
  length, no timing or length leak.
- **Fails closed.** Unset env var → `503`. Missing or wrong key → `401`.

Leading/trailing whitespace on the header value is stripped by the WHATWG
`Headers` API before comparison, so a secret that picked up a trailing newline
in the infra env file still works. Interior whitespace is not stripped and
still fails.

Every other route in this app is unauthenticated (`proxy.ts` is a no-op and
`auth.ts`'s `authorized` callback always returns true). These are the only
routes that enforce anything, which is why an unset secret must mean "refuse",
not "allow".

## Response

`200` on success. `raw-material`:

```json
{
  "success": true,
  "job": "gmd-update",
  "startedAt": "2026-10-05T04:00:00.000Z",
  "elapsedMs": 41233,
  "steps": {
    "catalogue": {
      "syncedAt": "...", "totalInSheet": 496, "created": 3, "updated": 12,
      "unchanged": 480, "skippedByStatus": 2, "blankCode": 0,
      "duplicateInSheet": 1, "noStockInSheet": 5, "failedWrites": 0,
      "changedColumns": { "l1": 3 }, "createdCodes": ["..."],
      "derivedCount": 15, "derivedFailed": 0, "elapsedMs": 30000
    },
    "stock": {
      "sheetCodes": 1204, "matched": 480, "changed": 42, "unchanged": 438,
      "updatedRows": 42, "notInSheet": 5, "skippedBlank": 1,
      "sheetCodesWithoutRow": 700, "failedWrites": 0, "elapsedMs": 8000
    }
  }
}
```

`contract-review`:

```json
{
  "success": true,
  "job": "contract-review",
  "startedAt": "2026-10-05T04:30:00.000Z",
  "elapsedMs": 188402,
  "steps": {
    "sheetSync": {
      "syncedAt": "...", "totalInContracts": 9000, "created": 0,
      "updated": 4, "unchanged": 8996, "blankKeyRows": 0,
      "duplicateInSheet": 0, "failedWrites": 0, "changedColumns": { "rate": 4 },
      "contractNoSynced": { "updated": 0, "matched": 0 },
      "notCurrentReqt": {
        "contractReview": { "marked": 0, "cleared": 0 },
        "enquiryItem": { "marked": 0, "cleared": 0 }
      },
      "warnings": [], "elapsedMs": 120000
    },
    "enquiry": {
      "matched": 8000, "changed": 0, "unmatched": 1000, "updated": 0,
      "dryRun": false, "noOp": true, "elapsedMs": 3000
    },
    "rmAvail": {
      "stockPhysCodes": 1204, "stockUpdated": 12, "stockUnchanged": 300,
      "stockSkippedBlank": 1, "stockNotInSheet": 20,
      "verifyBomElapsedMs": 45000, "rmAvailUpdated": 3,
      "physicalStockUpdated": 2, "physicalStockCleared": 0,
      "failedWrites": 0, "elapsedMs": 60000
    }
  }
}
```

`docket-creation`:

```json
{
  "success": true,
  "job": "docket-creation",
  "startedAt": "2026-10-05T04:20:00.000Z",
  "elapsedMs": 15320,
  "steps": {
    "creation": {
      "pending": 3, "created": 3, "failed": 0, "snapshotFailures": 0,
      "itemsExtracted": 11, "threadsWithItems": 2, "threadsWithoutItems": 1,
      "parserHits": 2, "aiFallbacks": 0, "attachmentFetchFailures": 0,
      "dryRun": false,
      "dockets": [{ "docketNumber": "GMD/2026-27/431", "partyName": "ACME", "threadId": "...", "source": "email", "itemCount": 6 }]
    }
  }
}
```

| Status | Meaning |
|---|---|
| `200` | ran; `success: true` |
| `401` | missing/wrong `x-api-key` |
| `409` | this job is already running |
| `500` | fatal; body has `success: false` + `error` |
| `503` | `GMD_SYNC_API_KEY` unset on the server |

The `success` boolean exists so the ofelia script can do
`grep -q '"success": *false'`. `JSON.stringify` emits `"success":false` and the
`*` matches zero spaces.

`GET /api/scheduler/contract-review` authenticates and returns
`{ success: true, auth: "ok" }` **without running the job**, so a key mismatch
surfaces in milliseconds instead of after a full sync. The ofelia script uses
this as a pre-flight probe.

## Concurrency

- **`no-overlap = true`** in each ofelia config stops that job overlapping
  itself. It cannot stop a manual button click from overlapping an hourly run,
  so each orchestrator holds its own in-process latch and answers `409` to a
  second concurrent caller. The latch is released in a `finally`, so a throw
  cannot wedge the next run. The two jobs have separate latches, so
  `contract-review` never blocks `raw-material`.
- Prisma writes are bounded with `p-limit` at **10 in flight**, in chunks of
  200. The manual syncs fan out 200 concurrent calls per chunk; that is fine for
  an occasional button press but not for a job running every hour against the
  production DB.
- `contract-review` step 1 replaces the manual route's N sequential
  `findFirst` calls with a single `findMany` + in-memory Map diff, because
  `ContractReview` has no index on `(itemCode, contractNo)`.

## Relationship to existing code

Nothing in the app was deleted or modified. The manual paths are untouched and
still work:

| Existing path | Status |
|---|---|
| `app/raw_material/api/gmd-update/sync/route.ts` | untouched — Sync button, same behaviour |
| `app/actions/*.ts` `updateDerivedItemName` | untouched |
| `scripts/sync-available-stock-from-stock-phys.ts` | untouched — `npm run stock:sync` |
| `scripts/populate-derived-item-name.ts` | untouched |
| `app/api/contract-review/sync/route.ts` | untouched — Contract Review SYNC button |
| `app/actions/*.ts` `syncContractReviewEnquiryFieldsAllAction` | untouched — Sync Enquiry Fields button |
| `app/actions/*.ts` `syncContractReviewRmAvailAction` | untouched — Sync RM AVAIL button |
| `scripts/sync-ic-dump.ts` | untouched — `npm run ic:sync` (see *Step 4 — IC dump* for the duplication this implies) |

**Contract review steps 2 and 3 duplicate no logic.** Both server-action wrappers
already delegate entirely to action-free libs
(`lib/gmd_lib/contract-review-enquiry-backfill.ts`, `lib/verifyBomLookup.ts`,
`lib/contractPhysicalStock.ts`), so those steps call the libs directly. Only
step 1 is a genuine port, because that logic lived inside a route handler.
Step 4 is a deliberate independent port of the CLI script.

For `raw-material` and contract review step 4, logic does now exist in more than
one place. **`schedular_function/` is the source of truth for scheduled
behaviour.** If you change a sheet's columns or the derivation/merge rules,
update this folder as well.

`gmd-update-stock-phys.ts` intentionally fixes three bugs that remain in the
CLI script: a case-sensitive `updateMany` where-clause that could silently
write zero rows, blank cells wiping real stock values, and untrimmed comparison.
The CLI script still has them.

## Adding the next job

1. Create `schedular_function/<job>.ts` exporting a `runScheduled<Job>()`.
2. Give it its own in-flight latch — see `run-contract-review.ts`.
3. Add `app/api/scheduler/<job>/route.ts` as a thin shim — auth, status codes,
   response. No business logic.
4. Add `infra/<job>.sh` (copy `contract-review-sync.sh`, which has the
   fail-loudly guards and the credential probe) and a `[job-local]` block.
   Pick a minute offset that does not collide with an existing heavy job.
5. Export it from `index.ts` and document it in the table at the top.

Prefer calling existing `lib/` helpers over copying logic — check whether the
button you are wrapping is already a thin wrapper over a lib.
6. Add any new env vars to `documentation/10-glossary-appendix.md`.

## `pbg-reminders`

`runScheduledPbgReminders()` in `pbg-reminders.ts` sends the PBG reminder mails
directly over SMTP (no n8n). It reads only rows whose `mail_trigger` is
`CONTINUE` and whose status is `OPEN`, `Running` or `Expired`.

- **Pre-expiry:** exactly 30 calendar days before `expiry_date`, once per BG,
  grouped by party (`client_name`) + contact.
- **Post-expiry:** one 7-day cycle per **party + contact**. Each cycle includes
  every currently expired, non-closed BG for that party across all its POs. A
  BG that expires between cycles joins the next cycle automatically.
- **Recipients:** parsed from the `contact_person` column; one mail per party +
  contact group.
- **Mail body:** one table per PO with PO number, project, BG details, invoice
  numbers and a PO total. Pre-expiry uses the 30-day notice wording; the
  expiry-day mail uses the confirmation/discharge wording; later 7-day cycles
  use the MSME/GFR reminder wording with reminder number and earlier-mail dates.
- **Branding:** the GMD logo is embedded inline at the top of every HTML mail.
- **Signature:** all PBG mails close with Ms. Puja Agarwal, Director.
- **Invoice numbers:** matched from `SupplyHistoryItem` by BG number first, then
  by PO number. All distinct invoices are shown; SR-series invoices are ignored.
- **Udyam number:** interval mails read `PBG_UDYAM_NO`; when unset they show
  `[UDYAM-XX-00-0000000]`.
- **No party / no PO:** rows with a blank party or PO number are skipped and
  counted in the job result (`skippedNoParty`, `skippedNoPo`,
  `skippedNoPoBgNos`) for manual cleanup.
- **Audit:** every attempt writes `pbg_reminder_log` (`SENT`/`FAILED`) with the
  PO number and recipient key. Failed sends retry on the next daily run.
- **Env:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
  `MAIL_FROM`, `MAIL_FROM_NAME`, optional `PBG_REMINDER_CC`,
  `PBG_UDYAM_NO`, `PBG_REMINDER_BATCH_SIZE`, `PBG_REMINDER_DELAY_MS`.

Dry-run (prints recipients and rows without sending):

```sh
pnpm --filter gmd-quotation-process pbg:reminders:dry
```

Test SMTP credentials without sending:

```sh
pnpm --filter gmd-quotation-process pbg:reminders:verify
```

Send one live pass:

```sh
pnpm --filter gmd-quotation-process pbg:reminders:send
```

Send a test mail for one party (defaults to `MAIL_FROM` when `--to` is omitted):

```sh
pnpm --filter gmd-quotation-process pbg:test-mail -- --party="G V P R ENGINEERS LIMITED" --template=before
pnpm --filter gmd-quotation-process pbg:test-mail -- --party="G V P R ENGINEERS LIMITED" --template=expired --reminder-no=1 --earlier-dates=2026-10-26
pnpm --filter gmd-quotation-process pbg:test-mail -- --party="KALPATARU PROJECTS INTERNATIONAL LIMITED" --template=expired --to=ops@example.com --dry
```

Backfill the PO number / recipient key on older log rows (dry-run, then apply):

```sh
pnpm --filter gmd-quotation-process pbg:reminder-log:backfill
pnpm --filter gmd-quotation-process pbg:reminder-log:backfill:apply
```

Ofelia wiring is provided at the repo root:

- `infra/pbg-reminders.sh`
- `infra/pbg-reminders.ofelia.ini`
- `infra/README.md`

Schedule it **daily** at 09:00 IST. The 7-day cadence is internal to the app.

## Manual testing

`BASE=http://localhost:4570/api/scheduler`

```sh
# fail-closed: GMD_SYNC_API_KEY unset on the server -> 503
curl -i -X POST "$BASE/raw-material"
curl -i -X POST "$BASE/contract-review"

# wrong key -> 401
curl -i -X POST -H "x-api-key: nope" "$BASE/raw-material"

# correct key -> 200 (runs the job)
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/raw-material"
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/contract-review"

# the execution-tracking pair: refresh the name list, then preview a year
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/acc-master"
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/execution-tracking?dryRun=1&fy=2026-27"

# verify credentials WITHOUT running the job
curl -i -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/contract-review"
curl -i -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/pbg"

# run the PBG sheet sync
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/pbg"

# run the PBG reminder pass (direct SMTP)
curl -i -X POST -H "x-api-key: $GMD_SYNC_API_KEY" "$BASE/pbg-reminders"
```

Inspect the container logs for the `[SCHEDULER]` blocks, which print the full
per-step diff:

```
docker logs -f gmd-quotation-process | grep SCHEDULER
```