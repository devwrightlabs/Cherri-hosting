FROM node:20-alpine AS base
WORKDIR /app

# Install all dependencies (including devDeps for build & prisma generate)
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production dependencies only
FROM base AS prod-deps
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
# Copy generated Prisma client from builder (avoids needing prisma CLI in prod)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Production runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY package.json ./

EXPOSE 4000

CMD ["node", "dist/index.js"]
