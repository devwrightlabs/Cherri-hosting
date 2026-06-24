-- AlterTable
ALTER TABLE "BackendService" ADD COLUMN     "activitySource" TEXT,
ADD COLUMN     "dbActivityCheckedAt" TIMESTAMP(3),
ADD COLUMN     "dbDeleteFailureReason" TEXT,
ADD COLUMN     "dbLifecycleStatus" TEXT NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "dbRestoreFailureReason" TEXT,
ADD COLUMN     "dormancyReason" TEXT,
ADD COLUMN     "dormantAt" TIMESTAMP(3),
ADD COLUMN     "lastNetworkUsageGb" DOUBLE PRECISION,
ADD COLUMN     "lastProviderActivityAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DbSnapshot" (
    "id" TEXT NOT NULL,
    "backendServiceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "storageProvider" TEXT,
    "locationRef" TEXT,
    "checksum" TEXT,
    "sizeBytes" BIGINT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DbSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorCostControlConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "maxLiveDbs" INTEGER NOT NULL DEFAULT 10,
    "warnAtPercent" INTEGER NOT NULL DEFAULT 80,
    "inactivityDays" INTEGER NOT NULL DEFAULT 7,
    "snapshotDeleteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorCostControlConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DbSnapshot_backendServiceId_createdAt_idx" ON "DbSnapshot"("backendServiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorAlert_dedupeKey_key" ON "OperatorAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "OperatorAlert_readAt_createdAt_idx" ON "OperatorAlert"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "BackendService_dbLifecycleStatus_idx" ON "BackendService"("dbLifecycleStatus");

-- AddForeignKey
ALTER TABLE "DbSnapshot" ADD CONSTRAINT "DbSnapshot_backendServiceId_fkey" FOREIGN KEY ("backendServiceId") REFERENCES "BackendService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

