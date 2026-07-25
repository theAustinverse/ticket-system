-- CreateIndex
CREATE INDEX "Session_eventId_idx" ON "Session"("eventId");

-- CreateIndex
CREATE INDEX "SaleBatch_sessionId_idx" ON "SaleBatch"("sessionId");

-- CreateIndex
CREATE INDEX "SaleBatch_stockSweepDone_saleEndAt_idx" ON "SaleBatch"("stockSweepDone", "saleEndAt");

-- CreateIndex
CREATE INDEX "TicketType_sessionId_idx" ON "TicketType"("sessionId");

-- CreateIndex
CREATE INDEX "TicketType_batchId_idx" ON "TicketType"("batchId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_ticketTypeId_idx" ON "Order"("ticketTypeId");

-- CreateIndex
CREATE INDEX "TicketTransfer_orderId_idx" ON "TicketTransfer"("orderId");

-- CreateIndex
CREATE INDEX "TicketTransfer_fromUserId_idx" ON "TicketTransfer"("fromUserId");

-- CreateIndex
CREATE INDEX "TicketTransfer_toUserId_idx" ON "TicketTransfer"("toUserId");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_idx" ON "ChatMessage"("userId");
