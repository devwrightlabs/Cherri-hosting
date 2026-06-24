---
name: Prisma client generation
description: Why `prisma generate` lands in the wrong node_modules and how to make the server pick up new models.
---

The Prisma schema lives at `prisma/schema.prisma` (repo root). Both the root
and `server/` have `@prisma/client` + `prisma` installed.

**Problem:** `prisma generate` (and `prisma migrate dev`) resolve the output
location from the `@prisma/client` package *nearest the schema* — that is the
ROOT `node_modules/.prisma/client`. But the server runs via `tsx` and imports
its own `server/node_modules/@prisma/client`, which re-exports from
`server/node_modules/.prisma/client`. So after a migration the server keeps
seeing the OLD generated types/runtime and TS errors like
`Property 'piSubscription' does not exist on PrismaClient`.

**Fix after any schema change:**
1. Apply the migration (see "non-interactive migrations" below).
2. `npx prisma generate --schema=prisma/schema.prisma` (from root).
3. Sync the freshly generated client into the server:
   `rm -rf server/node_modules/.prisma && cp -r node_modules/.prisma server/node_modules/.prisma`
4. Re-run `cd server && npx tsc --noEmit` to confirm new models resolve.

**Why:** `start.sh` does NOT run migrations or generate, and the server's
duplicate `.prisma/client` is what it actually loads at runtime.

**Non-interactive migrations (this env):** `prisma migrate dev` is an
interactive command and ABORTS here with "environment is non-interactive" —
it neither writes the migration nor applies it. Do NOT keep retrying it.
Instead, generate the SQL and deploy it yourself:
1. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` — diffs the LIVE DB against the edited schema and prints the exact forward SQL.
2. Create `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` with that SQL (match the existing timestamp-underscore naming convention).
3. `npx prisma migrate deploy --schema=prisma/schema.prisma` (non-interactive, applies pending migrations and records them).
Then run generate + the server `.prisma` sync above.
