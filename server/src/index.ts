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

// ---------------------------------------------------------------------------
// Startup environment validation
// Fail fast with a clear message if required secrets are missing.
// ---------------------------------------------------------------------------
const REQUIRED_ENV_VARS = ['DATABASE_URL', 'PI_API_KEY'] as const;
const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  // Use console.error here in case the logger is not yet initialised
  console.error(
    `[startup] Missing required environment variables: ${missingVars.join(', ')}. ` +
      'For local server runs, copy server/.env.example to server/.env and fill in the values. ' +
      'For Docker Compose runs, copy .env.example to .env at the repository root and fill in the values.',
  );
  process.exit(1);
}

const hasPinata =
  process.env.PINATA_JWT ||
  (process.env.PINATA_API_KEY && process.env.PINATA_API_SECRET);
if (!hasPinata) {
  console.error(
    '[startup] Missing Pinata credentials. ' +
      'Set PINATA_JWT or both PINATA_API_KEY and PINATA_API_SECRET.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Process-level safety nets — prevent the server from crashing silently.
// These are last-resort guards; individual routes still handle their own errors.
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', {
    message: err.message,
    stack: err.stack,
  });
  // The process is in an undefined state after an uncaught exception;
  // exit so a process manager (Docker restart policy, PM2, etc.) can restart it.
  process.exit(1);
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
  logger.info(`Cherri Hosting API running on port ${PORT}`);
});

export default app;
