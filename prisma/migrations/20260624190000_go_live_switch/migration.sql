-- CreateTable
CREATE TABLE "GoLiveConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "goLiveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "railwayPaidAttestation" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoLiveConfig_pkey" PRIMARY KEY ("id")
);

