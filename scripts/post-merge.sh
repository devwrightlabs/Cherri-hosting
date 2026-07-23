#!/bin/bash
# Post-merge setup for Cherri Hosting.
# Idempotent, non-interactive. Three package.json files (root/client/server),
# no workspaces — install each in its own directory.
set -e

echo "==> Installing root dependencies"
npm install --no-audit --no-fund

echo "==> Installing client dependencies"
(cd client && npm install --no-audit --no-fund)

echo "==> Installing server dependencies"
(cd server && npm install --no-audit --no-fund)

echo "==> Applying Prisma migrations (schema at root prisma/)"
npx prisma migrate deploy

echo "==> Regenerating Prisma client"
npx prisma generate

# The server imports its own Prisma client copy — must stay in sync with the
# root-generated one after any schema change.
echo "==> Syncing generated Prisma client into server/node_modules"
rm -rf server/node_modules/.prisma
cp -r node_modules/.prisma server/node_modules/.prisma

echo "==> Post-merge setup complete"
