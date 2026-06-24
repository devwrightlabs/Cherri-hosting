-- AlterTable
ALTER TABLE "BackendService" ADD COLUMN     "railwayDeploymentId" TEXT;

-- CreateTable
CREATE TABLE "UsageSample" (
    "id" TEXT NOT NULL,
    "backendServiceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "networkGb" DOUBLE PRECISION NOT NULL,
    "providerPeriodStart" TIMESTAMP(3),
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageSample_backendServiceId_sampledAt_idx" ON "UsageSample"("backendServiceId", "sampledAt");

-- AddForeignKey
ALTER TABLE "UsageSample" ADD CONSTRAINT "UsageSample_backendServiceId_fkey" FOREIGN KEY ("backendServiceId") REFERENCES "BackendService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

