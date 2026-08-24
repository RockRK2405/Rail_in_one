-- Add a cryptographically-random access token to waitlist offers, used as the
-- opaque identifier in the emailed offer link. Table is empty at this point, so
-- a NOT NULL + UNIQUE column is safe to add directly.
ALTER TABLE "waitlist_offers" ADD COLUMN "access_token" TEXT NOT NULL DEFAULT '';
ALTER TABLE "waitlist_offers" ALTER COLUMN "access_token" DROP DEFAULT;
CREATE UNIQUE INDEX "waitlist_offers_access_token_key" ON "waitlist_offers" ("access_token");
