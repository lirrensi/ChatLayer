-- AlterTable
ALTER TABLE "Message" ADD COLUMN "tags" JSONB;

-- CreateIndex
CREATE INDEX "Message_botId_userId_idx" ON "Message"("botId", "userId");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");
