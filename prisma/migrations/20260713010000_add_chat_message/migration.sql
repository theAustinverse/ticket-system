-- Adds the ChatMessage table backing the site-wide public chat / feedback
-- wall ("心情便利貼").
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");

-- CASCADE (not RESTRICT) so deleting a user (e.g. an admin removing a spam
-- account) doesn't fail on leftover chat messages.
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
