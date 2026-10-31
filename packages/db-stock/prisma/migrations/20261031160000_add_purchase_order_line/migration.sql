-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "poLineNo" TEXT NOT NULL,
    "poDate" TEXT,
    "itemCode" TEXT,
    "itemName" TEXT,
    "supplierCode" TEXT,
    "supplierName" TEXT,
    "uom" TEXT,
    "altUom" TEXT,
    "netQtyOrder" TEXT,
    "qtyExecuted" TEXT,
    "balanceQty" TEXT,
    "rate" TEXT,
    "basicAmount" TEXT,
    "exchangeRate" TEXT,
    "deliverySched" TEXT,
    "grnDate" TEXT,
    "salesContract" TEXT,
    "partyRefNo" TEXT,
    "partyRefDate" TEXT,
    "inTransit" DOUBLE PRECISION,
    "lineValue" DOUBLE PRECISION,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_poNo_poLineNo_key" ON "PurchaseOrderLine"("poNo", "poLineNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_itemCode_idx" ON "PurchaseOrderLine"("itemCode");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_salesContract_idx" ON "PurchaseOrderLine"("salesContract");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_inTransit_idx" ON "PurchaseOrderLine"("inTransit");
