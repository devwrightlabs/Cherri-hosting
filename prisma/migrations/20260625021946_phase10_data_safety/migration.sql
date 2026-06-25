-- AlterTable
ALTER TABLE "BackendService" ADD COLUMN     "lastBackupAt" TIMESTAMP(3),
ADD COLUMN     "lastBackupFailureReason" TEXT,
ADD COLUMN     "lastBackupStatus" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletionFailureReason" TEXT,
ADD COLUMN     "lifecycleStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "DbBackup" (
    "id" TEXT NOT NULL,
    "backendServiceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "kind" TEXT NOT NULL DEFAULT 'AUTO',
    "storageProvider" TEXT,
    "locationRef" TEXT,
    "checksum" TEXT,
    "sizeBytes" BIGINT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DbBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DbBackup_backendServiceId_createdAt_idx" ON "DbBackup"("backendServiceId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_lifecycleStatus_idx" ON "Project"("lifecycleStatus");

-- AddForeignKey
ALTER TABLE "DbBackup" ADD CONSTRAINT "DbBackup_backendServiceId_fkey" FOREIGN KEY ("backendServiceId") REFERENCES "BackendService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

