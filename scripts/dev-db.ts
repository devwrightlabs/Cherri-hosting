/**
 * scripts/dev-db.ts
 *
 * Start a REAL local Postgres via embedded-postgres on a temp datadir,
 * set DATABASE_URL, and run prisma migrate deploy to apply the full schema.
 *
 * Usage (run from repo root):
 *   npx tsx scripts/dev-db.ts
 *
 * It prints:
 *   DATABASE_URL=postgres://... (the connection string to use)
 *   TABLES: user project deployment ...  (confirms schema is applied)
 *
 * The process stays alive after printing — kill it to stop postgres.
 * Alternatively, import startDevDb() from another script.
 */

import EmbeddedPostgres from 'embedded-postgres';
import { execSync, spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_PORT = parseInt(process.env.DEV_DB_PORT ?? '54320', 10);
const DB_USER = 'cherri_dev';
const DB_PASS = 'cherri_dev_pass';
const DB_NAME = 'cherri_dev';

export async function startDevDb(): Promise<{ url: string; stop: () => Promise<void> }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherri-pg-'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    persistent: false, // clean up on stop
    onLog: (msg) => { if (process.env.PG_VERBOSE) console.log('[pg]', msg); },
    onError: (msg) => console.error('[pg:err]', msg),
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  const url = `postgres://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}`;

  // Run prisma migrate deploy (with fallback to db push)
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const env = { ...process.env, DATABASE_URL: url };

  try {
    execSync(
      `npx prisma migrate deploy --schema="${schemaPath}"`,
      { env, stdio: 'pipe', cwd: path.join(__dirname, '..') }
    );
    console.log('[dev-db] prisma migrate deploy: OK');
  } catch (migrateErr) {
    console.warn('[dev-db] migrate deploy failed, trying db push...', (migrateErr as Error).message?.slice(0, 200));
    try {
      execSync(
        `npx prisma db push --schema="${schemaPath}" --force-reset`,
        { env, stdio: 'pipe', cwd: path.join(__dirname, '..') }
      );
      console.log('[dev-db] prisma db push: OK');
    } catch (pushErr) {
      throw new Error(`Schema apply failed: ${(pushErr as Error).message}`);
    }
  }

  // Verify tables exist
  const client = pg.getPgClient(DB_NAME);
  await client.connect();
  const result = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
  );
  await client.end();
  const tables = result.rows.map(r => r.tablename);
  console.log('[dev-db] TABLES:', tables.join(', '));

  process.env.DATABASE_URL = url;
  console.log(`[dev-db] DATABASE_URL=${url}`);

  const stop = async () => {
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { url, stop };
}

// Run standalone
if (require.main === module) {
  (async () => {
    const { url, stop } = await startDevDb();
    console.log('\n=== Embedded Postgres is running ===');
    console.log(`DATABASE_URL=${url}`);
    console.log('Press Ctrl+C to stop.\n');

    process.on('SIGINT', async () => {
      console.log('\n[dev-db] Stopping...');
      await stop();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await stop();
      process.exit(0);
    });
  })().catch(err => {
    console.error('[dev-db] Fatal:', err);
    process.exit(1);
  });
}
