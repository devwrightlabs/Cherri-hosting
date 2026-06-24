-- AlterTable
ALTER TABLE "PiSubscription" ADD COLUMN     "onChainServiceId" TEXT,
ADD COLUMN     "onChainSubId" TEXT;

-- CreateIndex
CREATE INDEX "PiSubscription_contractId_onChainServiceId_idx" ON "PiSubscription"("contractId", "onChainServiceId");
