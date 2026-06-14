#!/bin/bash
set -e

echo "==> Installing client dependencies..."
cd client && npm install
cd ..

echo "==> Building React client..."
cd client && npm run build
cd ..

echo "==> Installing server dependencies..."
cd server && npm install
cd ..

echo "==> Generating Prisma client..."
cd server && npx prisma generate --schema=../prisma/schema.prisma
cd ..

echo "==> Building Node server..."
cd server && npm run build
cd ..

echo "==> Build complete!"
