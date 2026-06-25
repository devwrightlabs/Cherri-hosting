-- AlterTable
ALTER TABLE "BackendService" ADD COLUMN     "provisioningAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "provisioningNextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "BackendService_status_provisioningNextRetryAt_idx" ON "BackendService"("status", "provisioningNextRetryAt");
