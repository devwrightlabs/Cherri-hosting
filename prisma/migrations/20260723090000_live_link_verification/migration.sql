-- Live-link fix: point live URLs at the site's entry file and record an honest
-- post-pin verification result (UNCHECKED | VERIFIED | INDETERMINATE | FAILED).
ALTER TABLE "Deployment" ADD COLUMN "entryPath" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "liveCheckStatus" TEXT NOT NULL DEFAULT 'UNCHECKED';
ALTER TABLE "Deployment" ADD COLUMN "liveCheckDetail" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "liveCheckAt" TIMESTAMP(3);
