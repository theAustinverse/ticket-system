-- CreateEnum
CREATE TYPE "HelpQuestionStatus" AS ENUM ('BOT_ANSWERED', 'ESCALATED', 'ADMIN_ANSWERED');

-- CreateTable
CREATE TABLE "HelpQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "askerName" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "botAnswer" TEXT,
    "status" "HelpQuestionStatus" NOT NULL,
    "adminReply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpQuestion_userId_createdAt_idx" ON "HelpQuestion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HelpQuestion_status_createdAt_idx" ON "HelpQuestion"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "HelpQuestion" ADD CONSTRAINT "HelpQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
