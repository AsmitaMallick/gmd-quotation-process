-- CreateTable
CREATE TABLE "Creditor" (
    "id" TEXT NOT NULL,
    "accSch" TEXT,
    "accCode" TEXT NOT NULL,
    "accName" TEXT,
    "vrNo" TEXT,
    "vrDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "unAllocCr" DECIMAL(18,2),
    "partyBillNo" TEXT,
    "partyBillDate" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creditor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditorAdvance" (
    "id" TEXT NOT NULL,
    "accSch" TEXT,
    "accCode" TEXT NOT NULL,
    "vrNo" TEXT,
    "vrDate" TIMESTAMP(3),
    "unAllocDr" DECIMAL(18,2),
    "partyBillNo" TEXT,
    "partyBillDate" TIMESTAMP(3),
    "particular" TEXT,
    "narration" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditorAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Creditor_dueDate_idx" ON "Creditor"("dueDate");

-- CreateIndex
CREATE INDEX "Creditor_accCode_idx" ON "Creditor"("accCode");

-- CreateIndex
CREATE INDEX "CreditorAdvance_accCode_idx" ON "CreditorAdvance"("accCode");
