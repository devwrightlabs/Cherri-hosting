-- Pi Network compliance: apps must use Pi Authentication only and must not
-- collect data beyond what is functionally necessary (no email addresses).
-- Drops the now-unused User.email column.
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
