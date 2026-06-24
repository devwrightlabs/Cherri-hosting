-- CreateTable
CREATE TABLE "PaymentQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "dollarCents" INTEGER NOT NULL,
    "overageCents" INTEGER NOT NULL DEFAULT 0,
    "piUsdRate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "bufferBps" INTEGER NOT NULL DEFAULT 400,
    "quotedPiAmount" DECIMAL(18,8) NOT NULL,
    "env" TEXT NOT NULL DEFAULT 'testnet',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "txid" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentQuote_paymentId_key" ON "PaymentQuote"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentQuote_txid_key" ON "PaymentQuote"("txid");

-- CreateIndex
CREATE INDEX "PaymentQuote_userId_idx" ON "PaymentQuote"("userId");

-- CreateIndex
CREATE INDEX "PaymentQuote_status_expiresAt_idx" ON "PaymentQuote"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "PaymentQuote" ADD CONSTRAINT "PaymentQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
