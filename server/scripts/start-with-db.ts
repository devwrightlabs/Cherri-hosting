/**
 * server/scripts/start-with-db.ts
 *
 * Boots embedded-postgres, applies schema, then starts the compiled server.
 * This is the "all-in-one" dev launcher for testing the real loop.
 *
 * Usage:
 *   cd server && npx tsx scripts/start-with-db.ts
 */

import { startDevDb } from './dev-db';
import { spawn } from 'child_process';
import path from 'path';

(async () => {
  console.log('[start-with-db] Starting embedded Postgres...');
  const { url, stop } = await startDevDb();

  console.log('[start-with-db] Starting server...');

  const serverIndex = path.join(__dirname, '..', 'dist', 'index.js');
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    DATABASE_URL: url,
    NODE_ENV: 'development',
    CHERRI_DEV_AUTH: '1',
    PORT: process.env.PORT ?? '4000',
    // Pinata + Pi keys come from environment (already set)
  };

  const server = spawn('node', [serverIndex], {
    env,
    stdio: 'inherit',
  });

  server.on('exit', async (code) => {
    console.log(`[start-with-db] Server exited (code ${code}). Stopping DB...`);
    await stop();
    process.exit(code ?? 0);
  });

  const shutdown = async () => {
    console.log('\n[start-with-db] Shutting down...');
    server.kill('SIGTERM');
    await stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch(err => {
  console.error('[start-with-db] Fatal:', err);
  process.exit(1);
});
