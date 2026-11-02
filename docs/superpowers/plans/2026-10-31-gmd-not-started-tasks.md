# GMD Quotation — Not-Started Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two buildable not-started Notion tasks — a Creditors (payables) dashboard and a Debtors daily sync + MSME follow-up workflow — by reusing the Debtors code that already exists.

**Architecture:** Debtors already has a sheet→DB snapshot sync (`lib/debtorsSync.ts` + `scripts/sync-debtors.ts`), pure ageing maths (`lib/debtorsAgeing.ts`), joins (`lib/debtorJoins.ts`), a read API and a table component. Creditors is the same shape with the sign flipped and a second "advances" tab, so the plan generalises the three pure libs rather than copying them. Follow-up data moves out of optional Google Sheet tabs into one `LedgerFollowUp` table shared by both ledgers. MSME fields are computed from that table plus settings held as `LookupOption` rows (so the existing `/admin/lookup-options` screen is the settings UI — no new screen).

**Tech Stack:** Next.js 16 App Router, Prisma 7 / Postgres (`@gmd/db-quotation`), hand-written migrations, Ofelia cron in Docker, `node:test` via tsx.

**Spec:** Notion tasks —
[GMD Creditors Dashboard (Payables)](https://app.notion.com/p/40abc0e241508114a8e0ff9fc4bd9f32),
[Debtors – daily sync + client payment follow-up workflow](https://app.notion.com/p/40abc0e24150814b9404d897cf6bdeba),
plus the project KB [gmd-quotation-process context](https://app.notion.com/p/409bc0e241508192a4ced61f82924512).

## Not in this plan (and why)

- **"Test & close – 24 tasks waiting in In Testing"** — human sign-off on the live dashboard at `192.168.1.190:4570`, not code. Left for the user.
- **"Valve Serial No dashboard"** — nothing matching it exists in this repo (`grep -i serial` finds only engineering master data and physical-stock). Its own step 1 is "Bidyut: update this task with the current status". Blocked on that input; building it blind would duplicate whatever Bidyut has.
- **MSME items 4b/6 from the Debtors spec** (interest-statement/notice PDF, Samadhaan case tracking, Udyam no. + MSME clause on quotations and invoices) — these are Task 7, deliberately last, because they need Koushal's Udyam category confirmation and a decision on the invoice footer wording.

## Global Constraints

- **Never run `prisma db push`.** Edit `packages/db-quotation/prisma/schema.prisma` and hand-write `migration.sql` under `packages/db-quotation/prisma/migrations/`. The user runs `db:deploy`.
- Scheduler code must **never** import `@/app/actions`.
- Server actions live in `app/actions/*.ts`, start with `requireAccess()`/`loginRequired()`, and return `{success, error}` instead of throwing.
- Business logic goes in pure `lib/` helpers so it is testable; tests are `node:test` files in `apps/gmd-quotation-process/tests/`.
- Known limits get a `shortcut: <limit>, <when to upgrade>` comment.
- MSME interest rate is **3 × RBI Bank Rate, compounded monthly**, Bank Rate 5.75% from 7 Oct 2026 → 17.25% p.a. **Kept as a setting, never hard-coded.** Default credit days 45.
- Money reaches the UI as `number` (flatten Prisma `Decimal` in the server lib, as `lib/debtors-server.ts` already does).

## Review Focus

Inputs the spec implies but no acceptance criterion exercises:

1. **A party with advances but no bills** (creditors): net payable is negative. Must show as "recover/adjust", not drop out of the table or make a bucket total go negative.
2. **A bill with no DUEDATE**: creditors spec says fall back to VRDATE. Debtors today silently buckets a null due date as "Not due" — for creditors the fallback is required, so ageing must use it.
3. **Two follow-up edits to the same party from two users**: last write wins is fine, but the earlier edit must not be silently resurrected by the 5-minute sheet cache that `lib/debtors-server.ts` holds today. That cache must go when the DB becomes authoritative.
4. **MSME due date when the invoice has no agreed credit days**: the Act says 15 days with no written agreement, 45 with one. A missing credit-days value must not default to 45 and understate the breach.
5. **A sheet whose tab was renamed or whose column was renamed**: `requireColumns` already fails loudly for Debtors. The Creditors sync must fail the same way instead of writing nulls — a silent zero here reads as "we owe nothing".

---

### Task 1: Shared ageing maths for both ledgers

Creditors ageing is debtors ageing with the sign flipped and a VRDATE fallback. Generalise in place; do not copy the file.

**Files:**
- Modify: `apps/gmd-quotation-process/lib/debtorsAgeing.ts`
- Test: `apps/gmd-quotation-process/tests/debtorsAgeing.test.ts`

**Interfaces:**
- Consumes: `DebtorRow` from `lib/debtors.ts`.
- Produces:
  - `type LedgerSide = "debtor" | "creditor"`
  - `outstanding(r: Pick<LedgerRow,"unAllocDr"|"unAllocCr">, side?: LedgerSide): number` — `side` defaults to `"debtor"` so every existing caller is unchanged; `"creditor"` returns `unAllocCr - unAllocDr`.
  - `summarise(rows: LedgerRow[], today: Date, opts?: { side?: LedgerSide }): AgeingSummary` — unchanged default behaviour.
  - `effectiveDueDate(dueDate: string|null, vrDate: string|null): string|null`
  - `LedgerRow` = the subset `summarise` reads: `accCode, accName, dueDate, vrDate, unAllocDr, unAllocCr`.

- [ ] **Step 1: Write the failing tests**

```ts
test("creditor side flips the sign", () => {
  const r = { unAllocDr: 100, unAllocCr: 400 };
  assert.equal(outstanding(r), -300);
  assert.equal(outstanding(r, "creditor"), 300);
});

test("advances with no bills give a negative net, party still listed", () => {
  const rows = [{ accCode: "A1", accName: "Tangfa", dueDate: null, vrDate: "2026-01-01", unAllocDr: 500, unAllocCr: 0 }];
  const s = summarise(rows, new Date("2026-10-31"), { side: "creditor" });
  assert.equal(s.parties.length, 1);
  assert.equal(s.parties[0].net, -500);
});

test("effectiveDueDate falls back to vrDate", () => {
  assert.equal(effectiveDueDate(null, "2026-05-01"), "2026-05-01");
  assert.equal(effectiveDueDate("2026-06-01", "2026-05-01"), "2026-06-01");
  assert.equal(effectiveDueDate(null, null), null);
});

test("bucket totals equal the sum of party dues", () => { /* one party per bucket, assert Σbuckets === totalDues */ });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd apps/gmd-quotation-process && npx tsx --test tests/debtorsAgeing.test.ts`
Expected: FAIL — `outstanding` takes one argument, `effectiveDueDate` is not exported.

- [ ] **Step 3: Implement the three signatures above in `lib/debtorsAgeing.ts`**

`summarise` keeps its current body; only the balance call and the date it buckets on change. Use `effectiveDueDate` inside `summarise` so the VRDATE fallback applies to both sides (a debtor bill with no due date currently falls into "Not due" — the fallback is strictly better and the existing tests pin the rest).

- [ ] **Step 4: Run the whole suite**

Run: `cd apps/gmd-quotation-process && npm test`
Expected: PASS, including the pre-existing `debtors*.test.ts` files.

- [ ] **Step 5: Commit** — `refactor(debtors): share ageing maths with the creditors ledger`

---

### Task 2: Creditors sync (sheet → DB)

**Files:**
- Create: `apps/gmd-quotation-process/lib/creditorsSync.ts`
- Create: `apps/gmd-quotation-process/scripts/sync-creditors.ts`
- Create: `packages/db-quotation/prisma/migrations/20261031<HHMMSS>_add_creditors/migration.sql`
- Modify: `packages/db-quotation/prisma/schema.prisma`, `apps/gmd-quotation-process/package.json`
- Test: `apps/gmd-quotation-process/tests/creditorsSync.test.ts`

**Interfaces:**
- Consumes: `cell`, `requireColumns`, `readSheetTabByTitleIfPresent` from `lib/gmd_lib/bomMastErp`; `parseAmount`, `parseSheetDate` **re-exported from `lib/debtorsSync.ts`** (same DD-MM-YYYY sheet, do not re-implement).
- Produces:
  - `CREDITORS_TAB = "CREDITORS"`, `ADVANCES_TAB = "ADVANCE TO CREDITORS"`
  - `type CreditorRecord` — `accSch, accCode, accName, vrNo, vrDate, dueDate, unAllocCr, partyBillNo, partyBillDate`
  - `type CreditorAdvanceRecord` — `accSch, accCode, vrNo, vrDate, unAllocDr, partyBillNo, partyBillDate, particular, narration`
  - `mapCreditorRow(row, idx): { ok: true; record } | { ok: false; error }` and `mapAdvanceRow(...)` — same result shape as `mapDebtorRow`
  - `resolveCreditorColumns(headers, tabTitle)`, `resolveAdvanceColumns(headers, tabTitle)`

Models (schema + migration), mirroring `Debtor`: `Creditor` and `CreditorAdvance`, both with `syncedAt/createdAt/updatedAt` and `@@index([accCode])`; `Creditor` also `@@index([dueDate])`. No unique key — the sync is a snapshot replace, as Debtors is.

- [ ] **Step 1: Write the failing tests**

```ts
test("maps a creditor row", () => { /* assert every field, amounts as numbers, dates as UTC midnight */ });
test("blank ACC_CODE is skipped with a reason", () => {
  assert.deepEqual(mapCreditorRow(rowWithBlankCode, idx), { ok: false, error: "blank ACC_CODE" });
});
test("a renamed column fails loudly", () => {
  assert.throws(() => resolveCreditorColumns(["ACC_CODE", "AMOUNT"], "CREDITORS"), /UN_ALLOC_CR/);
});
test("text that is not a number is an error, not zero", () => {
  assert.equal(mapCreditorRow(rowWithJunkAmount, idx).ok, false);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd apps/gmd-quotation-process && npx tsx --test tests/creditorsSync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/creditorsSync.ts`**

Header maps, matched exactly after normalisation:
- CREDITORS: `ACC_SCH, ACC_CODE, ACC_NAME, VRNO, VRDATE, DUEDATE, UN_ALLOC_CR, PARTYBILLNO, PARTYBILLDATE`
- ADVANCE TO CREDITORS: `ACC_CODE, VRNO, VRDATE, UN_ALLOC_DR, PARTYBILLNO, ACC_SCH, PARTYBILLDATE, PARTICULAR, NARRATION`

Resolve both tabs **by title**, not gid — the gids are unknown and the titles are given in the spec. Throw a named error if a tab is absent.
`// shortcut: tabs resolved by title; switch to gid like DEBTORS_GID once the gids are known.`

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Add the schema models and hand-write the migration**

Add `Creditor` and `CreditorAdvance` to `schema.prisma`, then write the matching `CREATE TABLE`/`CREATE INDEX` statements by hand (copy the style of `20261031140000_add_debtor_joins/migration.sql`). Do not run `db push`. Run `npm run db:generate` from the repo root to regenerate the client.

- [ ] **Step 6: Write `scripts/sync-creditors.ts`**

Copy `scripts/sync-debtors.ts` structure exactly: dry-run by default, `--apply` replaces both tables inside one `prisma.$transaction`, `--dump-headers` prints real vs expected headers. Report mappable/skipped counts and the first 15 skip reasons. Add `creditors:sync` and `creditors:sync:apply` to `package.json`.

- [ ] **Step 7: Verify against the sheet**

Run: `cd apps/gmd-quotation-process && npm run creditors:sync`
Expected: a dry-run report of roughly **830 bills / ₹12.96 Cr** and **₹11.36 Cr advances** (the 31 Oct figures in the task). A material mismatch means a column or tab is wrong — stop and report it, do not apply.

- [ ] **Step 8: Commit** — `feat(creditors): sync CREDITORS and ADVANCE TO CREDITORS into the quotation DB`

---

### Task 3: Daily sync job for both ledgers

The stale "last synced 27 Oct" banner is caused by there being no scheduled job at all — `sync-debtors.ts` is a manual CLI. One Ofelia job covers both ledgers.

**Files:**
- Create: `apps/gmd-quotation-process/schedular_function/ledger-sync.ts`
- Create: `apps/gmd-quotation-process/app/api/scheduler/ledger/route.ts`
- Create: `apps/gmd-quotation-process/schedular_function/infra/ledger-sync.sh`, `.../infra/ledger.conf`
- Modify: `apps/gmd-quotation-process/schedular_function/index.ts`, `.../README.md`
- Modify: `apps/gmd-quotation-process/scripts/sync-debtors.ts`, `.../scripts/sync-creditors.ts` (call the shared runner instead of holding the logic)

**Interfaces:**
- Consumes: `resolveDebtorColumns`/`mapDebtorRow` (Task 2's creditor equivalents), `readSheetTabByGid`, `readSheetTabByTitleIfPresent`.
- Produces: `runLedgerSync(opts?: { dryRun?: boolean }): Promise<LedgerSyncReport>` where `LedgerSyncReport = { debtors: {read,mapped,skipped,written}, creditors: {...}, advances: {...} }`. Exported from `schedular_function/index.ts` as `runScheduledLedgerSync`.

- [ ] **Step 1: Write the failing test**

```ts
test("dry run writes nothing and still reports counts", async () => {
  const report = await runLedgerSync({ dryRun: true });   // sheet reader stubbed
  assert.equal(report.debtors.written, 0);
  assert.ok(report.debtors.mapped > 0);
});
test("a failed creditors tab does not abandon a good debtors sync", async () => { /* assert debtors.written > 0 and creditors carries an error */ });
```

- [ ] **Step 2: Run it and confirm it fails** — Run: `npx tsx --test tests/ledgerSync.test.ts`

- [ ] **Step 3: Implement `runLedgerSync`**

Each ledger is replaced in its own transaction, so one bad tab cannot leave the others empty. No `@/app/actions` import.

- [ ] **Step 4: Add the route, copying `app/api/scheduler/acc-master/route.ts` verbatim in shape**

`runtime = "nodejs"`, `maxDuration = 1800`, `requireSyncApiKey` on both POST and GET, GET is a credential probe that does not run the job, 409 on `JobAlreadyRunningError`.

- [ ] **Step 5: Add the Ofelia job**

`ledger.conf`: `schedule = 0 55 1 * * *` (01:55 IST-container daily — after the hourly block, before the working day). `no-overlap = true`. `ledger-sync.sh` copies `acc-master-sync.sh` including the credential probe and the `failedWrites` check.

- [ ] **Step 6: Verify**

Run: `cd apps/gmd-quotation-process && npm run build && npm run typecheck`
Then, with the app running: `curl -H "x-api-key: $GMD_SYNC_API_KEY" localhost:4570/api/scheduler/ledger` → `{"auth":"ok"}`.
Expected: build and typecheck clean, probe returns ok.

- [ ] **Step 7: Commit** — `feat(scheduler): daily debtors and creditors ledger sync`

---

### Task 4: Follow-up stored in the DB, editable on the page

Today's follow-up columns are read from optional Google Sheet tabs through a 5-minute cache and cannot be written. This replaces that with one table serving both ledgers.

**Files:**
- Create: `packages/db-quotation/prisma/migrations/20261031<HHMMSS>_add_ledger_follow_up/migration.sql`
- Create: `apps/gmd-quotation-process/app/actions/ledgerFollowUp.ts`
- Modify: `packages/db-quotation/prisma/schema.prisma`, `apps/gmd-quotation-process/lib/debtorJoins.ts`, `.../lib/debtors-server.ts`, `.../components/debtors/DebtorsTable.tsx`
- Test: `apps/gmd-quotation-process/tests/ledgerFollowUp.test.ts`

**Interfaces:**
- Produces:
  - Model `LedgerFollowUp`: `id, ledger ("debtor"|"creditor"), accCode, vrNo String?, owner, contactName, contactPhone, contactEmail, lastFollowUp DateTime?, promisedDate DateTime?, promisedAmount Decimal?, status, remarks, updatedById, createdAt, updatedAt`, `@@unique([ledger, accCode, vrNo])`, `@@index([ledger, accCode])`.
    A party-level row has `vrNo = ""` (not null — Postgres unique indexes do not collapse nulls, so an empty string is what keeps one row per party).
  - `saveLedgerFollowUpAction(input: LedgerFollowUpInput): Promise<{success: boolean; error?: string}>` in `app/actions/ledgerFollowUp.ts` — `requireAccess()` first, upsert on the unique triple, returns instead of throws.
  - `getFollowUps(ledger: LedgerSide): Promise<Record<string, FollowUp>>` in `lib/debtors-server.ts`, keyed `accCode` or `accCode|vrNo`.
  - `FollowUp` in `lib/debtorJoins.ts` gains `contactName, contactPhone, contactEmail, remarks`.

- [ ] **Step 1: Write the failing test**

```ts
test("party-level and bill-level rows coexist for one party", () => { /* key("A1","") !== key("A1","V9") */ });
test("a blank promised amount clears the stored value rather than writing 0", () => { /* assert null, not 0 */ });
test("later edit wins", () => { /* upsert twice, assert the second owner */ });
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Add the model and hand-write the migration.** Run `npm run db:generate`.

- [ ] **Step 4: Implement the server action and the read side.**

**Delete `followCache` and the `OS_STAFF_ALLOC` / `OS_FOLLOWUP_LOG` sheet reads from `lib/debtors-server.ts`** — the DB is now authoritative and the cache would resurrect stale edits (Review Focus #3). Leave `buildFollowUps` in `lib/debtorJoins.ts` only if a test still covers it; otherwise delete it and its test.

- [ ] **Step 5: Make the columns editable in `DebtorsTable.tsx`**

Owner, contact name/phone/email, last follow-up, promised date, promised amount, status (`to pay | on hold | disputed | adjust advance` for creditors; keep the debtors list as it is) and remarks. Inline edit on blur, optimistic update, `toast.error` from sonner on failure and revert. Follow the surrounding `TD`/`TH` class conventions.

- [ ] **Step 6: Verify** — `npm test && npm run typecheck && npm run lint`. Expected: all clean.

- [ ] **Step 7: Commit** — `feat(ledger): editable follow-up columns backed by the database`

---

### Task 5: Creditors page

**Files:**
- Create: `apps/gmd-quotation-process/app/creditors/page.tsx`
- Create: `apps/gmd-quotation-process/app/api/creditors/route.ts`
- Create: `apps/gmd-quotation-process/lib/creditors-server.ts`
- Create: `apps/gmd-quotation-process/components/creditors/CreditorsTable.tsx`
- Modify: `apps/gmd-quotation-process/components/layout/nav-items.ts`
- Test: `apps/gmd-quotation-process/tests/creditors.test.ts`

**Interfaces:**
- Consumes: `summarise(rows, today, { side: "creditor" })` (Task 1), `getFollowUps("creditor")` (Task 4), `toCsv`/`downloadCsv` (`lib/debtorJoins.ts`).
- Produces: `getCreditors(): Promise<CreditorsResult>` where `CreditorsResult = { rows: CreditorRow[]; advances: AdvanceRow[]; summary: AgeingSummary; syncedAt: string|null; followUps: Record<string, FollowUp> }`.

Page mirrors `/debtors`: `GMDUpdateHeader` with the synced-at banner, `GMDUpdateSkeleton` while loading, client fetch of `/api/creditors`. Route copies `app/api/debtors/route.ts` exactly (`denyIfNoAccess` first). Nav: add `{ label: "Creditors", href: "/creditors" }` next to Debtors in `nav-items.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
test("net payable = bills − advances per party", () => { /* 1000 bills, 400 advances → net 600 */ });
test("a party with both bills and advances is flagged advanceNotAdjusted", () => {});
test("import and customs schedules are reported separately from local vendors", () => {
  // Commissioner of Customs and Tianjin Tangfa must not land in the local-vendor group
});
test("ageing buckets sum to total bills", () => {});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement `lib/creditors-server.ts` and the route.**

- [ ] **Step 4: Implement `CreditorsTable.tsx`**

Top cards: Total bills, Advances, **Net payable**, Overdue, 180+ days, No. of parties — same `Tile` style as Debtors. Party table: party, schedule (ACC_SCH mapped via `AccMaster`), bills, advances, net, the six ageing buckets, oldest bill, follow-up columns. Click a party to expand a bill-wise drill-down (VRNO, party bill no/date, due date, amount, days) — reuse the `Fragment`-based expand already in `DebtorsTable`. Filters: overdue only, schedule group, party search (`DebouncedSearchInput`). Download CSV via `toCsv`/`downloadCsv`.

- [ ] **Step 5: Verify in the running app**

Run: `npm run dev`, open `http://localhost:4569/creditors`.
Expected: totals match the dry-run report from Task 2 step 7; buckets sum to total bills; a party with advances only shows a negative net.

- [ ] **Step 6: Commit** — `feat(creditors): payables dashboard with ageing, advances and follow-up`

---

### Task 6: MSME layer on Debtors

**Files:**
- Create: `apps/gmd-quotation-process/lib/msme.ts`
- Modify: `apps/gmd-quotation-process/lib/debtors-server.ts`, `.../components/debtors/DebtorsTable.tsx`
- Modify: `packages/db-quotation/prisma/schema.prisma` + migration (adds `creditDays`, `clientType`, `udyamOnInvoice`, `stage`, `nextActionDate`, `samadhaanNo`, `samadhaanStatus` to `LedgerFollowUp`)
- Test: `apps/gmd-quotation-process/tests/msme.test.ts`

**Interfaces:**
- Settings are `LookupOption` rows, so `/admin/lookup-options` is the settings screen: `type = "msme.bankRatePct"` (value `"5.75"`), `type = "msme.defaultCreditDays"` (value `"45"`), `type = "msme.creditDaysNoAgreement"` (value `"15"`).
- Produces:
  - `msmeDueDate(billDate: Date, creditDays: number | null): Date` — `creditDays` null ⇒ use the no-agreement setting (15), **not** 45 (Review Focus #4). Any value above 45 is capped at 45.
  - `msmeInterest(principal: number, from: Date, to: Date, bankRatePct: number): number` — rate = 3 × bankRate, compounded monthly: `principal * ((1 + r/12) ** months - 1)` where `months` is whole months elapsed.
  - `followUpStage(daysPastMsmeDue: number, promiseMissed: boolean, underLitigation?: boolean): 0|1|2|3|4|5|6|null` — thresholds −7/0/+7/+15/+30/+45/+60; `promiseMissed` forces 3; `underLitigation` returns `null`, which is what keeps a party in court out of the ladder and out of every reminder (Task 9).
  - `type MsmeSettings = { bankRatePct: number; defaultCreditDays: number; creditDaysNoAgreement: number }`, with `loadMsmeSettings()` in `lib/debtors-server.ts` falling back to the documented defaults when a row is absent.

- [ ] **Step 1: Write the failing tests**

```ts
test("17.25% p.a. on ₹1,00,000 for 12 months, compounded monthly", () => {
  assert.equal(Math.round(msmeInterest(100000, new Date("2025-10-31"), new Date("2026-10-31"), 5.75)), 18687);
});
test("no agreed credit days falls back to 15, not 45", () => {
  assert.deepEqual(msmeDueDate(new Date("2026-10-01"), null), new Date("2026-10-16"));
});
test("agreed credit days above 45 are capped at 45", () => {
  assert.deepEqual(msmeDueDate(new Date("2026-10-01"), 90), new Date("2026-11-15"));
});
test("a missed promise drops the party back to stage 3", () => {
  assert.equal(followUpStage(2, true), 3);
});
test("stage thresholds", () => { /* -8→0, -7→0, 0→1, 7→2, 15→3, 30→4, 45→5, 60→6 */ });
```

Compute the first expected value from the formula before writing it down; if it disagrees with 18687, trust the formula and fix the test.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement `lib/msme.ts` — pure, no Prisma import.**

- [ ] **Step 4: Add the `LedgerFollowUp` columns and hand-write the migration.** `npm run db:generate`.

- [ ] **Step 5: Surface it on the Debtors page**

Per bill: MSME due date, days past it, interest accrued, total claimable (principal + interest), stage. Three views as tabs or filter chips on the existing table — **Due today** (next action date ≤ today, or promised date passed), **MSME breach list** (past 45 days, sorted by amount), **Ageing by stage** (count and value per stage). "Promise vs paid" and "Samadhaan cases" are columns on the existing table, not new views.

- [ ] **Step 6: Verify** — `npm test && npm run typecheck && npm run lint`, then check `/debtors` in `npm run dev`: stage, due date and interest populate, and the rate changes when the `msme.bankRatePct` lookup row is edited.

- [ ] **Step 7: Commit** — `feat(debtors): MSME due dates, interest and follow-up stage ladder`

---

### Task 7: MSME paperwork (needs user input before starting)

Blocked until Koushal confirms the **Udyam category** (Samadhaan and 43B(h) do not apply to a medium unit) and the Udyam number, and until the invoice/quotation footer wording is agreed.

Scope when unblocked: interest-statement / notice PDF per client (Puppeteer + a new Handlebars template beside `lib/offer_letter.hbs`); Samadhaan application no./status already added as columns in Task 6; MSME clause + Udyam no. in the offer-letter footer. n8n message templates for stages 0–1 are an n8n change, outside this repo — they belong to the existing n8n Notion task.

---

### Task 8: Sorting, filters and readability on the Debtors table

Added by Puja on 31 Oct. `components/debtors/DebtorsTable.tsx` is a hand-rolled `<table>` with no sorting. `@tanstack/react-table` is **already a dependency and used nowhere in this repo** — adopting it here gives click-sort, shift-click multi-sort and typed comparators without hand-writing them.

**Files:**
- Modify: `apps/gmd-quotation-process/components/debtors/DebtorsTable.tsx`
- Create: `apps/gmd-quotation-process/lib/tablePrefs.ts`
- Modify: `apps/gmd-quotation-process/app/layout.tsx`, `apps/gmd-quotation-process/app/globals.css` (font only — see step 1)
- Test: `apps/gmd-quotation-process/tests/tablePrefs.test.ts`

**Interfaces:**
- Consumes: `formatIndianNumber` (`lib/formatCurrency.ts`), `formatLakh` (`lib/debtorsAgeing.ts`) — the ₹/L toggle picks between these two, do not write a third formatter.
- Produces in `lib/tablePrefs.ts` (pure, no React):
  - `type TablePrefs = { sorting: { id: string; desc: boolean }[]; filters: Record<string, string>; amountFormat: "full" | "lakh" }`
  - `DEFAULT_DEBTOR_PREFS: TablePrefs` — sorting `[{ id: "overdue", desc: true }]`
  - `loadPrefs(key: string): TablePrefs` / `savePrefs(key: string, p: TablePrefs): void` — localStorage, **every read and write wrapped in try/catch**, falling back to the default so a blocked or corrupt store never blanks the table.

- [ ] **Step 1: Switch the app font from Poppins to Inter — decided by the user on 31 Oct, do not re-ask**

`app/layout.tsx` loads `Poppins` from `next/font/google` into `--font-poppins`. Replace it with `Inter`, same weights (`400,500,600,700`), `display: "swap"`. **Rename the CSS variable to `--font-inter` and update every reference** — grep `font-poppins` across `app/`, `components/` and `packages/` first; a stale variable name silently falls back to the browser default. This changes the look of every screen in the app, which the user accepted to keep one font throughout.

- [ ] **Step 2: Write the failing tests**

```ts
test("default sort is overdue, highest first", () => {
  assert.deepEqual(DEFAULT_DEBTOR_PREFS.sorting, [{ id: "overdue", desc: true }]);
});
test("a blocked localStorage returns the defaults instead of throwing", () => {
  // stub a getItem that throws; assert loadPrefs returns DEFAULT_DEBTOR_PREFS
});
test("corrupt stored JSON falls back to the defaults", () => {
  assert.deepEqual(loadPrefs("x"), DEFAULT_DEBTOR_PREFS); // stored value is "{not json"
});
test("amounts sort as numbers, not text", () => {
  // 9 must come before 10 descending; this is the spec's own example
});
test("blank dates sort last in both directions", () => {});
```

- [ ] **Step 3: Run and confirm failure.**

- [ ] **Step 4: Implement `lib/tablePrefs.ts`, then move the table onto `@tanstack/react-table`**

`getSortedRowModel`, `enableMultiSort` (shift+click), sorting state lifted so it can be persisted. Sortable columns: party, total due, overdue, each ageing bucket, oldest bill date, days past MSME due date, MSME interest, stage, owner, last follow-up, next action date, promised date/amount. Numeric and date columns get explicit comparators — the default is string comparison and would reproduce the "9 after 10" bug the spec names. ▲/▼ on the sorted column.

- [ ] **Step 5: Quick filters above the table** — stage, owner, client type, past-45-days-only, promise-broken, party search (reuse `DebouncedSearchInput`). Filter state persists with the sort.

- [ ] **Step 6: Readability pass**

Body 14px, headers 13px semibold, cards 24–28px bold, nothing under 12px. Amounts right-aligned with `tabular-nums` (already the convention in the `TD` class). Indian format with a ₹ / ₹ L toggle. Sticky header row **and** sticky party column. Zebra rows. Amber 31–45 days, red past 45. Bold totals row at the bottom. Must hold up at phone width.

- [ ] **Step 7: The CSV export honours the active sort and filters** — `toCsv` receives the sorted, filtered rows, not the raw array.

- [ ] **Step 8: Verify** — `npm test && npm run typecheck && npm run lint`, then in `npm run dev` check `/debtors`: click-sort each column type, shift-click a second column, reload and confirm the sort survived, and confirm a private window (no localStorage) still renders.

- [ ] **Step 9: Commit** — `feat(debtors): sortable columns, saved filters and a readability pass`

---

### Task 9: Legal status and provision for debtors under litigation

Six parties are in MSEFC/court proceedings and must leave the collection flow entirely: no reminders, no stage ladder, and their money reported separately from collectable dues.

**Files:**
- Create: `packages/db-quotation/prisma/migrations/<timestamp>_add_party_legal_case/migration.sql`
- Create: `apps/gmd-quotation-process/lib/legalStatus.ts`
- Create: `apps/gmd-quotation-process/app/actions/partyLegalCase.ts`
- Create: `apps/gmd-quotation-process/scripts/seed-legal-cases.ts`
- Modify: `packages/db-quotation/prisma/schema.prisma`, `.../lib/debtors-server.ts`, `.../components/debtors/DebtorsTable.tsx`, `.../lib/msme.ts`
- Test: `apps/gmd-quotation-process/tests/legalStatus.test.ts`

**Interfaces:**
- Produces:
  - Model `PartyLegalCase`: `id, ledger, accCode, status, forum, caseNo, filingDate, nextHearingDate, advocate, claimAmount Decimal?, interestClaimed Decimal?, provisionPct Float?, provisionAmount Decimal?, documentLink, lastUpdate, updatedById, createdAt, updatedAt`, `@@unique([ledger, accCode])`.
  - Model `PartyLegalCaseLog` — one row per change (`caseId, field, oldValue, newValue, changedById, changedAt`). The spec requires every change logged with date and user; follow the `ItemChangeLog` precedent, which deliberately has no FK so it outlives the record.
  - `LEGAL_STATUSES` — the exact nine values from the spec: `None`, `Legal notice sent`, `MSEFC conciliation`, `MSEFC arbitration`, `Award passed`, `Court case – civil`, `Court case – criminal (NI Act / BNS)`, `NCLT-IBC claim`, `Settled`, `Closed`.
  - `isUnderLitigation(status: string | null): boolean` — true for every status except `None`, `Closed` and null. This single predicate is what Task 6's `followUpStage` and the reminder jobs consult.
  - `splitDues(parties: PartyAgeing[], cases: Map<string, PartyLegalCase>): { gross: number; underLitigation: number; provision: number; netCollectable: number }`
  - `saveLegalCaseAction(...)` in `app/actions/partyLegalCase.ts` — `requireAccess()` first, writes the log rows in the same transaction, returns `{success, error}`.

- [ ] **Step 1: Write the failing tests**

```ts
test("every status except None, Closed and null counts as under litigation", () => {
  for (const s of LEGAL_STATUSES) assert.equal(isUnderLitigation(s), s !== "None" && s !== "Closed");
  assert.equal(isUnderLitigation(null), false);
});
test("gross = under litigation + net collectable + provision", () => { /* the four cards must reconcile */ });
test("a litigating party gets no follow-up stage", () => {
  assert.equal(followUpStage(90, false, true), null);
});
test("provision given as a percentage resolves to an amount", () => {});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement `lib/legalStatus.ts` (pure, no Prisma import).**

- [ ] **Step 4: Add both models, hand-write the migration, `npm run db:generate`.**

- [ ] **Step 5: Wire the exclusion** — `lib/msme.ts` `followUpStage` takes `underLitigation`; `lib/debtors-server.ts` loads cases alongside follow-ups; the "Due today" and reminder lists filter them out.

- [ ] **Step 6: UI** — legal columns on the party row, a separate **"Under litigation"** section, and four top cards: Gross dues, Under litigation, Provision, Net collectable.

- [ ] **Step 7: Seed the six known cases**

`scripts/seed-legal-cases.ts`, dry-run by default with `--apply`, carrying the table from the Notion task verbatim: Achme Water Solutions, Gharpure Engineering, Vigneshwara Constructions, VPRP, Veehi Engg, Gujarat Water Supply & Sewerage Board. The task marks two details **"likely"** (Achme's WBMSEFC case 212/2024) and one **"confirm closed"** (GWSSB) — seed those with the status set but the case number left blank rather than seeded as fact, and `lastUpdate` noting it awaits Legal's confirmation. Match parties by `accCode` resolved from `accName`; report any of the six that does not match a debtor row instead of inventing one.

- [ ] **Step 8: Verify** — `npm test && npm run typecheck`, then `npm run dev` and check the four cards reconcile against the page's own total.

- [ ] **Step 9: Commit** — `feat(debtors): legal status, litigation split and doubtful-debt provision`

**Open question for the user, does not block steps 1–8:** the spec says legal fields are "editable only by Legal/Accounts", but this app's roles are only `user`, `admin` and `developer` (NextAuth, see the KB). Until a role exists, step 6 gates editing on `admin`. Adding a `legal` role is a separate change.

---

### Task 10: Zuberi ₹12 L — mostly not a code change

The Notion section is an **instruction to Accounts**, not to this app. Steps 1–4 and 6 (pull the invoices, book the credit note under Sec 34 CGST only where the supply was really returned or cancelled, respect the **30 Nov 2026** declaration deadline for an FY 2025-26 supply, get the client's ITC reversal, confirm with the CA) are Koushal's and the CA's work. Puja has confirmed the order was cancelled, so a credit note is in order.

Only the spec's step 5 touches this repo, and most of it is automatic: once the credit note is booked in the ERP, the daily sync (Task 3) drops the ₹12 L on its next run, because the Debtors table is a snapshot of the sheet.

**The one real code change:** surface the credit note against the party, so the drop is explainable rather than money quietly vanishing from the dashboard.

- [ ] **Step 1:** Confirm which DEBTORS column carries a credit-note reference — likely `PARTICULAR` or `TCODE`. Run `npm run debtors:sync -- --dump-headers` and inspect, rather than guessing.
- [ ] **Step 2:** Show that reference in the party drill-down and include it in the CSV. One column, no new table.
- [ ] **Step 3:** Commit — `feat(debtors): show credit-note reference against adjusted bills`

Do not attempt to post, book or adjust anything in the ERP or GST return from this app.

---

## Status reporting

Per the project KB rule, each Notion task moves **In progress → In Testing → Done** as the work happens, and anything that proves infeasible is set to **Deleted** with a `Not Feasible Reason`.

- Creditors task: Tasks 1, 2, 3, 4, 5.
- Debtors task: Tasks 1, 3, 4, 6, 7, 8, 9, 10.

## Waiting on people (does not block the tasks above)

| Needed | From | Blocks |
|---|---|---|
| Udyam category (micro/small/medium) and Udyam number | Koushal, Accounts | Task 7 entirely; Samadhaan and 43B(h) do not apply to a medium unit |
| Case numbers marked "likely", claim amounts, and whether GWSSB TS-226/2025 is closed | Anindita Brahma / Joydeep Banerjee, Legal | Task 9 step 7 seeds these as provisional until confirmed |
| Default follow-up owner per party (Koushal for all GMD accounts?) | Puja | Task 4 pre-fill; without it, 70 parties start blank |
| Font decision: switch the app from Poppins to Inter, or leave it | Puja / user | Task 8 step 1 |
| Zuberi invoices, delivery status, invoice FY | Koushal, Accounts | Task 10, and the 30 Nov 2026 credit-note deadline |
