import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "us-west2" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 50000 });
  const CherriHosting = service("Cherri-hosting", {
    source: github("devwrightlabs/Cherri-hosting", { checkSuites: false }),
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "cherri-hosting" },
    env: {
      DATABASE_URL: preserve(), JWT_SECRET: preserve(), NODE_ENV: preserve(), PINATA_DEDICATED_GATEWAY: preserve(), PINATA_JWT: preserve(), PI_API_KEY: preserve(), PI_APP_ID: preserve(), SUPABASE_ANON_KEY: preserve(), SUPABASE_SERVICE_ROLE_KEY: preserve(), SUPABASE_URL: preserve(),
      // FIX (2026-09-30): every Pi payment/upgrade attempt was failing
      // ("Pi pricing is briefly unavailable") because billing's live Pi/USD
      // price source (server/src/services/piPriceService.ts) was never
      // configured — it deliberately refuses to invent a price (honest 503)
      // rather than fall back to a guess. Both listed providers are public,
      // no API key needed; failover order matters (first is primary).
      PI_PRICE_SOURCE: "coingecko,bitget",
    },
    // FIX (2026-09-29): Railpack builds from the repo root and the root
    // package.json has no scripts/main, so it can never detect a start
    // command — every deploy since 2026-08-27 failed at the prepare step
    // with "No start command detected" (confirmed via `railway logs -b`).
    // This repo is a monorepo (client/ + server/, no workspaces) and the
    // server serves the built client from a sibling `client/dist` at
    // runtime (server/src/index.ts: path.join(__dirname,'..','..','client','dist')),
    // so narrowing `rootDirectory` to `server` would build the API but
    // silently drop the frontend. Instead, reuse the exact build/start
    // commands already proven on Replit's [deployment] block (.replit):
    // build.sh builds client -> server, prisma generate targets
    // server/node_modules/.prisma/client per prisma/schema.prisma.
    build: { buildCommand: "bash build.sh" },
    // preDeployCommand runs after build, before start, inside Railway's own
    // network (where postgres.railway.internal resolves) — unlike `railway
    // run`/`railway ssh` invoked from outside, which can't reach it. Applies
    // pending migrations every deploy; a no-op when already up to date.
    // Confirmed 2026-09-29: prod DB was reachable (integrations.database:true)
    // but had zero tables (P2021 on Deployment/GoLiveConfig/OperatorCostControlConfig)
    // because migrations were never run against it.
    deploy: {
      startCommand: "node server/dist/index.js",
      preDeployCommand: ["cd server && npx prisma migrate deploy --schema=../prisma/schema.prisma"],
    },
  });

  return project("Cherri hosting", {
    resources: [CherriHosting, Postgres, postgresVolume],
  });
});
