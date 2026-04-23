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

### Quick Start

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
docker-compose up postgres -d
cd server && npm install && npx prisma migrate dev && npm run dev
# second terminal:
cd client && npm install && npm run dev
```

## License

MIT
