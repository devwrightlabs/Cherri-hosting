-- CreateTable
CREATE TABLE "PiSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'PREMIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "subscriberAddress" TEXT,
    "contractId" TEXT,
    "approvalTxId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'PI',
    "amountPerCycle" DECIMAL(18,8) NOT NULL,
    "allowanceTotal" DECIMAL(18,8) NOT NULL,
    "allowanceRemaining" DECIMAL(18,8) NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 30,
    "cyclesAuthorized" INTEGER NOT NULL,
    "cyclesBilled" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "nextBillingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PiSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(18,8),
    "txId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PiSubscription_approvalTxId_key" ON "PiSubscription"("approvalTxId");

-- CreateIndex
CREATE INDEX "PiSubscription_userId_idx" ON "PiSubscription"("userId");

-- CreateIndex
CREATE INDEX "PiSubscription_status_nextBillingAt_idx" ON "PiSubscription"("status", "nextBillingAt");

-- CreateIndex
CREATE INDEX "BillingEvent_subscriptionId_idx" ON "BillingEvent"("subscriptionId");

-- AddForeignKey
ALTER TABLE "PiSubscription" ADD CONSTRAINT "PiSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PiSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
