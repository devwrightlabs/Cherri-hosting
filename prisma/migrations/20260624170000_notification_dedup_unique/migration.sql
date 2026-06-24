-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_type_invoiceId_key" ON "Notification"("userId", "type", "invoiceId");
