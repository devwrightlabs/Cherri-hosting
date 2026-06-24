import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { authRouter } from './routes/auth';
import { projectsRouter } from './routes/projects';
import { deploymentsRouter } from './routes/deployments';
import { previewRouter } from './routes/preview';
import { deployRouter } from './routes/deploy';
import { subscriptionsRouter } from './routes/subscriptions';
import { pirc2Router } from './routes/pirc2';
import { paymentsRouter } from './routes/payments';
import { billingRouter } from './routes/billing';
import { invoicesRouter } from './routes/invoices';
import { notificationsRouter } from './routes/notifications';
import { logger } from './utils/logger';
import { integrationStatus, isRailwayConfigured } from './utils/integrations';
import { startBillingScheduler } from './services/billingScheduler';
import { startBillingLifecycleReconciler } from './services/billingLifecycleReconciler';

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
  console.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  // After an uncaught exception the process is in an undefined state. In
  // production we fail fast so the deployment supervisor restarts a clean
  // instance. In development there is no supervisor, so we log and stay alive
  // to keep the app reachable while iterating (external-service errors are
  // already handled in their own routes/services and won't reach here).
  console.error('Uncaught exception', {
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
      // Also allow any *.replit.app or *.minepi.com production domain
      if (/\.replit\.app$/.test(origin) || /\.minepi\.com$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

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

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Integration status — lets the frontend show a clear "degraded mode" banner
// when an optional external service (Pi Network, Pinata/IPFS) is not configured.
app.get('/api/status', (_req, res) => {
  res.json({ integrations: integrationStatus(), timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/deployments', deploymentsRouter);
app.use('/api/deploy', deployRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/subscriptions/pirc2', pirc2Router);
app.use('/api/payments', paymentsRouter);
app.use('/api/billing', billingRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/notifications', notificationsRouter);

// Sandboxed staging previews (public, guarded by an unguessable stageId).
// Mounted outside `/api` so it bypasses the rate limiter — a single preview
// pulls many asset requests — and registered before the SPA catch-all below.
app.use('/preview', previewRouter);

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

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  },
);

app.listen(PORT, () => {
  logger.info(`Cherri Hosting API running on port ${PORT}`);
  // Start the PiRC2 recurring-billing loop. It self-skips when PiRC2 is not
  // configured, so it is always safe to start.
  startBillingScheduler();
  // Start the billing lifecycle reconciler (invoice due -> grace -> pause). It
  // runs independently of PiRC2 and only processes existing invoices, so it is
  // always safe to start.
  startBillingLifecycleReconciler();
});

export default app;
