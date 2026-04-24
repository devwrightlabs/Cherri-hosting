# Cherri Hosting 🍒

A decentralized web hosting SaaS platform powered by IPFS and Pi Network payments.

## Overview

Cherri Hosting enables developers to deploy static websites and web apps to IPFS with a single command. Payments are handled via the Pi Network, making it accessible to the Pi ecosystem.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Storage | IPFS via Pinata pinning service |
| Auth / Payments | Pi Network SDK |

## Features

- 🚀 **1-click deployments** — drag-and-drop files or paste a GitHub URL
- 🌐 **IPFS-native** — every deployment gets a permanent content-addressed CID
- 🍒 **Pi payments** — subscribe with Pi cryptocurrency
- 📊 **Dashboard** — real-time deployment status, storage usage, project management
- 🔒 **Pi Auth** — sign in with your Pi Network identity

## Tiers

| Tier | Storage | Price |
|------|---------|-------|
| Free | 500 MB | Free |
| Premium | 10 GB | 10 Pi / month |

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- A Pinata API key (https://pinata.cloud)
- Pi Network developer account (https://developers.minepi.com)

### Local Development

```bash
# 1. Copy environment files and fill in your API keys
cp server/.env.example server/.env
cp client/.env.example client/.env

# 2. Start PostgreSQL
docker-compose up postgres -d

# 3. Install deps, run migrations, and start the API server
cd server && npm install && npx prisma migrate dev && npm run dev

# 4. In a second terminal, start the React dev server
cd client && npm install && npm run dev
```

The frontend will be available at http://localhost:5173 and the API at http://localhost:4000.

### Docker (Production)

```bash
# 1. Copy and configure the server environment
cp server/.env.example server/.env
# Edit server/.env — fill in PI_API_KEY, PINATA_JWT, etc.

# 2. Build and start all services
docker-compose up --build -d

# 3. Run database migrations from the server workspace
cd server && npm install && npx prisma migrate deploy
```

The frontend is served by nginx on **http://localhost:8080** and the API on **http://localhost:4000**.

> **Note:** The client Docker image bakes `VITE_API_URL` into the build.  
> Override it at build time with `docker-compose build --build-arg VITE_API_URL=https://api.example.com client`
> or update the `args` section in `docker-compose.yml` before building.

## License

MIT
