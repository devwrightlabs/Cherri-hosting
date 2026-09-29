import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { requestIdMiddleware } from './middleware/requestId';
import { centralErrorHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth';
import { projectsRouter } from './routes/projects';
import { deploymentsRouter } from './routes/deployments';
import { previewRouter } from './routes/preview';
// deployRouter removed — legacy POST /api/deploy superseded by staged pipeline
import { subscriptionsRouter } from './routes/subscriptions';
import { pirc2Router } from './routes/pirc2';
import { paymentsRouter } from './routes/payments';
import { billingRouter } from './routes/billing';
import { invoicesRouter } from './routes/invoices';
import { notificationsRouter } from './routes/notifications';
import { supportRouter } from './routes/support';
import { operatorCostControlRouter } from './routes/operatorCostControl';
import { operatorGoLiveRouter } from './routes/operatorGoLive';
import domainsRouter from './routes/domains';
import { logger } from './utils/logger';
import { integrationStatus, isRailwayConfigured } from './utils/integrations';
import { startBillingScheduler } from './services/billingScheduler';
import { startBillingLifecycleReconciler } from './services/billingLifecycleReconciler';
import { startDormancyReconciler } from './services/dormancyReconciler';
import { startMeteringSampler } from './services/meteringSampler';
import { startBackupReconciler } from './services/backupReconciler';
import {
  startRailwayProbe,
  getRailwayHealth,
} from './services/railwayStatusMonitor';
import { startRailwayActionReconciler } from './services/railwayActionReconciler';
import { watchdogRouter } from './routes/watchdog';
import { startWatchdog } from './services/watchdogService';
import { prisma } from './utils/prismaClient';

// ---------------------------------------------------------------------------
// Startup environment check (non-fatal by design)
//
// The app is built to stay online even when optional external integrations
// are not configured. Instead of crashing on missing secrets, we log a clear
// warning and let the affected feature return a structured 503 at call time.
// Only DATABASE_URL is treated as strictly required, since nearly every route
// depends on it — but we still warn rather than hard-exit so the static UI and
// the /api/status endpoint remain reachable for diagnostics.
// ---------------------------------------------------------------------------
const status = integrationStatus();
if (!status.database) {
  console.warn(
    '[startup] DATABASE_URL is not set. Database-backed routes will be unavailable. ' +
      'Provision a database and set DATABASE_URL to enable them.',
  );
}
if (!status.pi) {
  console.warn(
    '[startup] PI_API_KEY is not set. Pi Network payment features are disabled ' +
      'until it is configured (the app will continue running).',
  );
}
if (!status.pinata) {
  console.warn(
    '[startup] Pinata credentials are not set (PINATA_JWT or PINATA_API_KEY + ' +
      'PINATA_API_SECRET). IPFS deployments are disabled until configured ' +
      '(the app will continue running).',
  );
}
if (!status.pirc2) {
  console.warn(
    '[startup] PiRC2 is not configured (PIRC2_CONTRACT_ID, SOROBAN_RPC_URL, ' +
      'PIRC2_NETWORK_PASSPHRASE). Recurring subscriptions are disabled until ' +
      'configured (the app will continue running).',
  );
}
if (!isRailwayConfigured()) {
  console.warn(
    '[startup] RAILWAY_API_TOKEN is not set. Backend/database provisioning ' +
      '(the Railway landlord) is disabled until configured (the app will ' +
      'continue running).',
  );
}

// ---------------------------------------------------------------------------
// Process-level safety nets — prevent the server from crashing silently.
// These are last-resort guards; individual routes still handle their own errors.
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  // After an uncaught exception the process is in an undefined state. In
  // production we fail fast so the deployment supervisor restarts a clean
  // instance. In development there is no supervisor, so we log and stay alive
  // to keep the app reachable while iterating (external-service errors are
  // already handled in their own routes/services and won't reach here).
  logger.error('Uncaught exception', {
    message: err.message,
    stack: err.stack,
  });
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// Replit (and most PaaS) sit behind a reverse proxy that sets X-Forwarded-For.
// Without trust proxy, express-rate-limit throws a ValidationError on every
// request and the whole auth flow fails with 500.
app.set('trust proxy', 1);

// BigInt fields (storageUsed, storageLimit) cannot be JSON-serialised by default.
// A global replacer converts them to strings so res.json() never throws.
app.set('json replacer', (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value,
);

// ---------------------------------------------------------------------------
// Security headers — Pi Network app requirements
//
// Pi Browser embeds apps via native WKWebView and communicates with the SDK
// via cross-origin postMessage to app-cdn.minepi.com. Several of Helmet's
// defaults break this integration:
//
//   • contentSecurityPolicy  — disabled entirely. CSP on module scripts in
//     mobile WebKit (WKWebView) blocks execution even for same-origin bundles
//     when the crossorigin attribute is present (Vite's default). Pi Browser
//     enforces its own sandboxing, so we don't need server-level CSP.
//   • crossOriginEmbedderPolicy — disabled. The Pi SDK loads resources from
//     sdk.minepi.com which don't carry CORP headers; COEP would block them.
//   • crossOriginOpenerPolicy  — relaxed to allow-popups. Pi payment flows
//     open popup windows; same-origin strict mode closes them immediately.
//   • frameguard (X-Frame-Options) — disabled. Pi App Studio embeds the app
//     in a WebView; X-Frame-Options: SAMEORIGIN would block that embedding.
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy:     false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy:   { policy: 'same-origin-allow-popups' },
    frameguard:                false,
  }),
);

// CORS — allow the deployed origin and localhost for development.
// In production the client is served by this same Express process (same-origin),
// so the browser never sends a CORS preflight for /api calls; this mainly helps
// during local development where client (5000) and server (4000) differ.
const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (!allowedOrigins.includes('http://localhost:5000')) {
  allowedOrigins.push('http://localhost:5000');
}
if (!allowedOrigins.includes('http://localhost:5173')) {
  allowedOrigins.push('http://localhost:5173');
}

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin requests (origin undefined) and listed origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      // Also allow any *.replit.app, *.minepi.com, or *.up.railway.app
      // production domain. Without the Railway pattern, Vite's default
      // `crossorigin` attribute on the built module script/style tags put
      // same-origin asset requests into CORS mode; this handler then threw
      // for the app's own Railway domain, which Express turned into a 500 —
      // blocking the JS/CSS bundle and leaving the page blank. Confirmed
      // 2026-09-29 via real-browser network/console logs against
      // cherri-hosting-production.up.railway.app.
      if (
        /\.replit\.app$/.test(origin) ||
        /\.minepi\.com$/.test(origin) ||
        /\.up\.railway\.app$/.test(origin)
      ) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

// Per-request correlation ID — attach before any route so requestId is available everywhere
app.use(requestIdMiddleware);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------------------------------------------------------------------------
// Health probes
// /health  — legacy (kept for backward compat)
// /healthz — liveness: 200 if the process is up, nothing more
// /readyz  — readiness: 200 when DB is reachable + reports integration status;
//            503 when the DB is not reachable (or not configured)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/readyz', async (_req, res) => {
  const integrations = integrationStatus();
  let dbReachable = false;
  if (integrations.database) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  }

  const ready = dbReachable;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    db: dbReachable,
    integrations,
    timestamp: new Date().toISOString(),
  });
});

// Integration status — lets the frontend show a clear "degraded mode" banner
// when an optional external service (Pi Network, Pinata/IPFS) is not configured.
// `backendProvider` (Phase 11) is the SANITIZED health of the landlord that runs
// per-app backends: it carries a generic operational/outage state + message and
// NEVER reveals the provider name, hostnames, or ids.
app.get('/api/status', (_req, res) => {
  res.json({
    integrations: integrationStatus(),
    backendProvider: getRailwayHealth(),
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/deployments', deploymentsRouter);
// Legacy POST /api/deploy route removed — superseded by the staged
// upload→pin pipeline at POST /api/projects/:id/stage and POST /api/projects/:id/pin.
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/subscriptions/pirc2', pirc2Router);
app.use('/api/payments', paymentsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/support', supportRouter);
app.use('/api/operator/cost-control', operatorCostControlRouter);
app.use('/api/operator/go-live', operatorGoLiveRouter);
app.use('/api/watchdog', watchdogRouter);
app.use('/api/domains', domainsRouter);

// Sandboxed staging previews (public, guarded by an unguessable stageId).
// Mounted outside `/api` so it bypasses the rate limiter — a single preview
// pulls many asset requests — and registered before the SPA catch-all below.
app.use('/preview', previewRouter);

// Domain verification file endpoint
app.get('/.well-known/verification.txt', (_req, res) => {
  res.status(404).json({ error: 'Verification file not found at this path' });
});

// Serve built React client (production only — only when client/dist exists)
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback — non-API routes serve index.html so React Router works
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  // 404 handler (dev only — Vite handles client requests separately)
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });
}

// Handle /.well-known/* requests (verification files from deployments)
app.use('/.well-known', (req, res) => {
  res.status(404).json({ 
    error: `Verification file not found: ${req.path}`,
    hint: 'Add verification.txt to your project root and redeploy'
  });
});

// Central error handler (must be last middleware — four-argument signature)
app.use(centralErrorHandler);

const server = app.listen(PORT, () => {
  logger.info(`Cherri Hosting API running on port ${PORT}`);
  // Start the PiRC2 recurring-billing loop. It self-skips when PiRC2 is not
  // configured, so it is always safe to start.
  startBillingScheduler();
  // Start the billing lifecycle reconciler (invoice due -> grace -> pause). It
  // runs independently of PiRC2 and only processes existing invoices, so it is
  // always safe to start.
  startBillingLifecycleReconciler();
  // Start the Phase 7 idle-DB dormancy reconciler. It self-skips when there are
  // no provisioned DBs / Railway is unreachable, and never marks dormancy off
  // missing data, so it is always safe to start.
  startDormancyReconciler();
  // Start the Phase 4 metering sampler. sampleAllUsage self-skips when the
  // metering capability is off or Railway is unconfigured, so it is always safe
  // to start and writes no samples until GO-LIVE + metering keys are present.
  startMeteringSampler();
  // Start the Phase 10 non-destructive backup reconciler. It self-skips until the
  // backend lane is live + databaseBackups is enabled, and createBackup blocks
  // honestly with no live DB, so it is always safe to start and stays inert today.
  startBackupReconciler();
  // Start the Phase 11 backend-provider (Railway) health monitor. It only wires
  // the call observer + a read-only probe that self-skips unless the backend lane
  // is live, so it makes no external calls and reports `unknown` today.
  startRailwayProbe();
  // Start the Phase 11 outage retry reconciler. It re-drives provisioning + pause/
  // resume actions that were deferred by a provider outage. Gated on the backend
  // lane being live, the provisioning capability, and the provider being reachable,
  // so it is always safe to start and stays inert today.
  startRailwayActionReconciler();
  // Start the Cherri Watchdog uptime monitor. Self-skips when DB is absent.
  const watchdogHandle = startWatchdog();
});

// ---------------------------------------------------------------------------
// Graceful shutdown — SIGTERM / SIGINT
//
// Stop accepting new connections, drain in-flight requests, close the DB pool,
// and clear all scheduler intervals so the process exits cleanly under a
// deployment supervisor (Railway, Fly, systemd, etc.).
// ---------------------------------------------------------------------------
const schedulerHandles: Array<NodeJS.Timeout | ReturnType<typeof setInterval> | null> = [];

// Expose a seam so the watchdog handle can be registered after it is created.
// (startRailwayActionReconciler etc. manage their own intervals internally.)
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT',  () => gracefulShutdown('SIGINT'));

function gracefulShutdown(signal: string): void {
  logger.info(`Received ${signal}. Initiating graceful shutdown…`);

  // Stop accepting new connections.
  server.close(async () => {
    logger.info('HTTP server closed. Draining DB connections…');
    // Clear any watchdog interval (registered lazily after listen).
    schedulerHandles.forEach((h) => { if (h) clearInterval(h); });
    // Close the Prisma connection pool.
    await prisma.$disconnect().catch((err: unknown) => {
      logger.error('Error disconnecting from database on shutdown', { error: err });
    });
    logger.info('Graceful shutdown complete.');
    process.exit(0);
  });

  // Force-exit after 30 s if drain takes too long.
  setTimeout(() => {
    logger.warn('Graceful shutdown timed out. Force-exiting.');
    process.exit(1);
  }, 30_000).unref();
}

export default server;
