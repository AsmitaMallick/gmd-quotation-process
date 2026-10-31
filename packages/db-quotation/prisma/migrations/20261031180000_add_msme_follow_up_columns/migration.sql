-- AlterTable
ALTER TABLE "LedgerFollowUp" ADD COLUMN     "creditDays" INTEGER,
ADD COLUMN     "clientType" TEXT,
ADD COLUMN     "udyamOnInvoice" TEXT,
ADD COLUMN     "nextActionDate" TIMESTAMP(3),
ADD COLUMN     "samadhaanNo" TEXT,
ADD COLUMN     "samadhaanStatus" TEXT;
