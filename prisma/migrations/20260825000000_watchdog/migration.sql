-- Migration: 20260825000000_watchdog
-- Adds Cherri Watchdog tables: WatchdogCheck + WatchdogIncident

-- WatchdogCheck: one probe result per ACTIVE deployment
CREATE TABLE "WatchdogCheck" (
    "id"             TEXT NOT NULL,
    "deploymentId"   TEXT NOT NULL,
    "status"         TEXT NOT NULL,
    "httpCode"       INTEGER,
    "responseTimeMs" INTEGER NOT NULL,
    "checkedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchdogCheck_pkey" PRIMARY KEY ("id")
);

-- WatchdogIncident: open/closed availability incidents per deployment
CREATE TABLE "WatchdogIncident" (
    "id"           TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "url"          TEXT NOT NULL,
    "openedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"     TIMESTAMP(3),
    "reason"       TEXT NOT NULL,

    CONSTRAINT "WatchdogIncident_pkey" PRIMARY KEY ("id")
);

-- Foreign keys (cascade delete when the deployment is removed)
ALTER TABLE "WatchdogCheck" ADD CONSTRAINT "WatchdogCheck_deploymentId_fkey"
    FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchdogIncident" ADD CONSTRAINT "WatchdogIncident_deploymentId_fkey"
    FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for efficient time-series + incident queries
CREATE INDEX "WatchdogCheck_deploymentId_checkedAt_idx" ON "WatchdogCheck"("deploymentId", "checkedAt");
CREATE INDEX "WatchdogIncident_deploymentId_openedAt_idx" ON "WatchdogIncident"("deploymentId", "openedAt");
