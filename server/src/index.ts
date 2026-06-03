import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { authRouter } from './routes/auth';
import { projectsRouter } from './routes/projects';
import { deploymentsRouter } from './routes/deployments';
import { deployRouter } from './routes/deploy';
import { subscriptionsRouter } from './routes/subscriptions';
import { paymentsRouter } from './routes/payments';
import { logger } from './utils/logger';
import { integrationStatus } from './utils/integrations';

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

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
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
app.use('/api/payments', paymentsRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

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
  logger.info(`Sherry Hosting API running on port ${PORT}`);
});

export default app;
