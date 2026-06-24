-- CreateTable
CREATE TABLE "BackendService" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROVISIONING',
    "railwayProjectId" TEXT,
    "railwayEnvironmentId" TEXT,
    "railwayBackendServiceId" TEXT,
    "railwayDbServiceId" TEXT,
    "publicUrl" TEXT,
    "region" TEXT,
    "sleepEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackendService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackendService_projectId_key" ON "BackendService"("projectId");

-- CreateIndex
CREATE INDEX "BackendService_status_idx" ON "BackendService"("status");

-- AddForeignKey
ALTER TABLE "BackendService" ADD CONSTRAINT "BackendService_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
