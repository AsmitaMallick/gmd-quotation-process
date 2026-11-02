-- CreateTable
CREATE TABLE "PartyLegalCase" (
    "id" TEXT NOT NULL,
    "ledger" TEXT NOT NULL,
    "accCode" TEXT NOT NULL,
    "status" TEXT,
    "forum" TEXT,
    "caseNo" TEXT,
    "filingDate" TIMESTAMP(3),
    "nextHearingDate" TIMESTAMP(3),
    "advocate" TEXT,
    "claimAmount" DECIMAL(18,2),
    "interestClaimed" DECIMAL(18,2),
    "provisionPct" DOUBLE PRECISION,
    "provisionAmount" DECIMAL(18,2),
    "documentLink" TEXT,
    "lastUpdate" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyLegalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyLegalCaseLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyLegalCaseLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartyLegalCase_ledger_accCode_key" ON "PartyLegalCase"("ledger", "accCode");

-- CreateIndex
CREATE INDEX "PartyLegalCase_nextHearingDate_idx" ON "PartyLegalCase"("nextHearingDate");

-- CreateIndex
CREATE INDEX "PartyLegalCaseLog_caseId_idx" ON "PartyLegalCaseLog"("caseId");
