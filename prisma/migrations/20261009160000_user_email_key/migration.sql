-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailKey" TEXT;

-- Backfill: the mailbox an address really delivers to. Gmail ignores dots and
-- "+tag" in the local part and treats googlemail.com as gmail.com; every other
-- domain is only lowercased. (Mirrors canonicalEmail() in src/common.)
UPDATE "User" u
SET "emailKey" = s."key"
FROM (
  SELECT
    "id",
    CASE
      WHEN lower(split_part("email", '@', 2)) IN ('gmail.com', 'googlemail.com')
        THEN COALESCE(
               NULLIF(replace(split_part(split_part(lower("email"), '@', 1), '+', 1), '.', ''), ''),
               split_part(lower("email"), '@', 1)
             ) || '@gmail.com'
      ELSE lower("email")
    END AS "key"
  FROM "User"
) s
WHERE u."id" = s."id";

-- Accounts that already share a mailbox with an OLDER account (made before
-- this check existed) keep working but get no key: otherwise the unique index
-- below could not be created and the deploy would fail. They are the ones with
-- "emailKey" IS NULL; list them with
--   SELECT * FROM "User" WHERE "emailKey" IS NULL;
UPDATE "User" u
SET "emailKey" = NULL
FROM (
  SELECT "id",
         row_number() OVER (PARTITION BY "emailKey" ORDER BY "createdAt" ASC, "id" ASC) AS rn
  FROM "User"
  WHERE "emailKey" IS NOT NULL
) d
WHERE u."id" = d."id" AND d.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "User_emailKey_key" ON "User"("emailKey");
