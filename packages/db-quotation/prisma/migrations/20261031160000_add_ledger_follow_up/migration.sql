-- CreateTable
CREATE TABLE "LedgerFollowUp" (
    "id" TEXT NOT NULL,
    "ledger" TEXT NOT NULL,
    "accCode" TEXT NOT NULL,
    "vrNo" TEXT NOT NULL DEFAULT '',
    "owner" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "lastFollowUp" TIMESTAMP(3),
    "promisedDate" TIMESTAMP(3),
    "promisedAmount" DECIMAL(18,2),
    "status" TEXT,
    "remarks" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerFollowUp_ledger_accCode_vrNo_key" ON "LedgerFollowUp"("ledger", "accCode", "vrNo");

-- CreateIndex
CREATE INDEX "LedgerFollowUp_ledger_accCode_idx" ON "LedgerFollowUp"("ledger", "accCode");
