/**
 * Build service (Feature A — server-side build pipeline)
 *
 * Runs an uploaded project's REAL install + build on the server, captures the
 * REAL logs, and hands the built output to a route-supplied finalizer that turns
 * it into a normal stage (so the existing preview + atomic pin path is reused
 * unchanged). We NEVER fake build success — a failed build surfaces the real
 * error and logs and produces no stage.
 *
 * SECURITY (critical): building runs the user's untrusted code on our server.
 * Mitigations here:
 *   - The child process gets a SANITIZED env (PATH, a throwaway HOME, an npm
 *     cache dir, CI=true) and NOTHING else. Our secrets (PINATA_JWT,
 *     PINATA_API_KEY/SECRET, PI_API_KEY, DATABASE_URL, ...) are never exposed.
 *   - Work happens in an isolated temp dir that is always removed afterwards.
 *   - Each step has a wall-clock timeout; on expiry the whole process group is
 *     killed (SIGKILL) so npm's children can't linger.
 *   - Output is capped (file count + bytes); concurrency is 1 (a global queue).
 * Residual risk is disclosed to the user: `npm install`/build need outbound
 * network and CPU, and true container isolation is not possible on this host.
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { DeployFile, getMimeType, shouldIgnoreFile } from '../utils/deployFiles';
import { logger } from '../utils/logger';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export type BuildStatus =
  | 'QUEUED'
  | 'INSTALLING'
  | 'BUILDING'
  | 'COLLECTING'
  | 'DONE'
  | 'FAILED';

/** What the builder hands back to the finalizer on a successful build. */
export interface BuildOutput {
  /** Built output files, paths relative to the detected output dir root. */
  files: DeployFile[];
  /** Which output dir matched (e.g. 'dist'). */
  outputDir: string;
  packageManager: PackageManager;
}

/** Finalizer result the route stores on the job for the client to poll. */
export interface BuildStageInfo {
  stageId: string;
  previewPath: string;
  entryPoint: string;
  projectType: string;
  fileCount: number;
  totalBytes: number;
  sdk: { scriptDetected: boolean; initDetected: boolean; ready: boolean };
}

/**
 * Route-supplied callback. Runs after a successful build to apply the storage
 * quota check and create the stage. Kept in the route layer so prisma + the
 * staging store stay there; the builder itself never touches the DB.
 */
export type BuildFinalizer = (
  output: BuildOutput,
) => Promise<
  { ok: true; stage: BuildStageInfo } | { ok: false; error: string }
>;

export interface BuildJob {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  packageManager: PackageManager;
  status: BuildStatus;
  error?: string;
  stage?: BuildStageInfo;
  createdAt: number;
  updatedAt: number;
}

interface InternalJob extends BuildJob {
  files: DeployFile[];
  finalize: BuildFinalizer;
  logLines: string[];
}

// ─── Tunables ────────────────────────────────────────────────────────────────
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min for dependency install
const BUILD_TIMEOUT_MS = 5 * 60 * 1000; // 5 min for the build itself
const MAX_LOG_LINES = 4000; // ring buffer — keep the most recent lines
const MAX_OUTPUT_FILES = 5000;
const MAX_OUTPUT_BYTES = 1024 * 1024 * 1024; // 1 GB built-output ceiling
const JOB_TTL_MS = 30 * 60 * 1000; // jobs are pollable for 30 min, then swept

// Build-output directories we trust, in preference order.
const OUTPUT_DIRS = ['dist', 'build', 'out', '_site', 'public'];

const jobs = new Map<string, InternalJob>();

/** Public view of a job (no buffers, no callback). */
function publicJob(j: InternalJob): BuildJob {
  return {
    id: j.id,
    userId: j.userId,
    projectId: j.projectId,
    projectName: j.projectName,
    packageManager: j.packageManager,
    status: j.status,
    error: j.error,
    stage: j.stage,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

export function getBuildJob(id: string, userId: string): BuildJob | null {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return null;
  return publicJob(j);
}

export function getBuildLogs(id: string, userId: string): string | null {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return null;
  return j.logLines.join('\n');
}

/** True if the user already has a build that is queued or running. */
export function hasActiveBuild(userId: string): boolean {
  for (const j of jobs.values()) {
    if (
      j.userId === userId &&
      (j.status === 'QUEUED' ||
        j.status === 'INSTALLING' ||
        j.status === 'BUILDING' ||
        j.status === 'COLLECTING')
    ) {
      return true;
    }
  }
  return false;
}

/** Detect the package manager from a lockfile in the upload (root-level). */
export function detectPackageManager(files: DeployFile[]): PackageManager {
  const has = (name: string) => files.some((f) => f.path === name);
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  return 'npm';
}

/**
 * Read the build script name from a root package.json in the upload. Returns
 * null when there is no package.json or no `scripts.build` — the caller halts
 * honestly rather than guessing a command.
 */
export function readBuildScript(files: DeployFile[]): string | null {
  const pkg = files.find((f) => f.path === 'package.json');
  if (!pkg) return null;
  try {
    const json = JSON.parse(pkg.buffer.toString('utf8')) as {
      scripts?: Record<string, string>;
    };
    return json.scripts?.build ? 'build' : null;
  } catch {
    return null;
  }
}

// ─── Queue (concurrency 1) ─────────────────────────────────────────────────────
const queue: string[] = [];
let running = false;

export function enqueueBuild(opts: {
  userId: string;
  projectId: string;
  projectName: string;
  files: DeployFile[];
  packageManager: PackageManager;
  finalize: BuildFinalizer;
}): BuildJob {
  const id = crypto.randomBytes(18).toString('hex');
  const now = Date.now();
  const job: InternalJob = {
    id,
    userId: opts.userId,
    projectId: opts.projectId,
    projectName: opts.projectName,
    packageManager: opts.packageManager,
    status: 'QUEUED',
    createdAt: now,
    updatedAt: now,
    files: opts.files,
    finalize: opts.finalize,
    logLines: [],
  };
  jobs.set(id, job);
  queue.push(id);
  void pump();
  return publicJob(job);
}

function appendLog(job: InternalJob, chunk: string): void {
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    job.logLines.push(line);
  }
  if (job.logLines.length > MAX_LOG_LINES) {
    job.logLines.splice(0, job.logLines.length - MAX_LOG_LINES);
  }
  job.updatedAt = Date.now();
}

function setStatus(job: InternalJob, status: BuildStatus): void {
  job.status = status;
  job.updatedAt = Date.now();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      if (!job) continue;
      await runJob(job);
    }
  } finally {
    running = false;
  }
}

// ─── Build execution ───────────────────────────────────────────────────────────

/** Sanitized environment for a build step — our secrets are never included. */
function buildEnv(homeDir: string, production: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: homeDir,
    CI: 'true',
    npm_config_cache: path.join(homeDir, '.npm-cache'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    PNPM_HOME: path.join(homeDir, '.pnpm'),
  };
  // Install must include devDependencies (build tools live there) → leave
  // NODE_ENV unset. The build step runs as production.
  if (production) env.NODE_ENV = 'production';
  return env;
}

interface StepResult {
  code: number | null;
  timedOut: boolean;
}

/**
 * Spawn a command with shell:false in its own process group so a timeout can
 * SIGKILL the whole tree (npm spawns children). Streams stdout+stderr to the
 * job log. Rejects only on spawn errors (e.g. ENOENT for a missing manager).
 */
function runStep(
  job: InternalJob,
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    appendLog(job, `$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      appendLog(job, `\n✖ Step exceeded ${Math.round(timeoutMs / 1000)}s — killed.`);
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => appendLog(job, d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => appendLog(job, d.toString('utf8')));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut });
    });
  });
}

function installArgs(pm: PackageManager, hasLockfile: boolean): string[] {
  switch (pm) {
    case 'pnpm':
      return ['install', '--prod=false'];
    case 'yarn':
      return ['install', '--production=false'];
    default:
      // npm: include dev deps explicitly; `ci` needs a clean lockfile so prefer
      // the more forgiving `install` to avoid brittle failures.
      return hasLockfile
        ? ['install', '--include=dev', '--no-audit', '--no-fund']
        : ['install', '--include=dev', '--no-audit', '--no-fund'];
  }
}

function buildArgs(pm: PackageManager): string[] {
  // npm/pnpm/yarn all accept `run build`.
  return ['run', 'build'];
}

/** Write the upload's files into the temp source dir, guarding traversal. */
async function writeSource(dir: string, files: DeployFile[]): Promise<void> {
  const rootResolved = path.resolve(dir);
  for (const f of files) {
    const rel = f.path.replace(/\\/g, '/');
    if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '')) continue;
    const dest = path.resolve(dir, rel);
    if (dest !== rootResolved && !dest.startsWith(rootResolved + path.sep)) continue;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, f.buffer);
  }
}

/** Pick the first output dir that exists and contains an index.html. */
async function findOutputDir(baseDir: string): Promise<string | null> {
  for (const name of OUTPUT_DIRS) {
    const candidate = path.join(baseDir, name);
    try {
      const stat = await fsp.stat(candidate);
      if (!stat.isDirectory()) continue;
      await fsp.access(path.join(candidate, 'index.html'));
      return name;
    } catch {
      // not present or no index.html — try the next
    }
  }
  return null;
}

/** Read a built output dir back into DeployFile[] with caps + ignore filter. */
async function collectOutput(baseDir: string, outDir: string): Promise<DeployFile[]> {
  const root = path.join(baseDir, outDir);
  const out: DeployFile[] = [];
  let totalBytes = 0;
  let count = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (shouldIgnoreFile(rel)) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        count += 1;
        if (count > MAX_OUTPUT_FILES) {
          throw new Error(`Build output has more than ${MAX_OUTPUT_FILES} files.`);
        }
        const buffer = await fsp.readFile(full);
        totalBytes += buffer.length;
        if (totalBytes > MAX_OUTPUT_BYTES) {
          throw new Error('Build output exceeds the 1 GB limit.');
        }
        out.push({ buffer, path: rel, mimeType: getMimeType(rel) });
      }
    }
  }

  await walk(root);
  return out;
}

async function runJob(job: InternalJob): Promise<void> {
  const work = path.join(os.tmpdir(), `cherri-build-${job.id}`);
  const src = path.join(work, 'src');
  const home = path.join(work, 'home');

  try {
    await fsp.mkdir(src, { recursive: true });
    await fsp.mkdir(home, { recursive: true });
    await writeSource(src, job.files);
    // Free the in-memory source buffers now that they're on disk.
    job.files = [];

    const hasLockfile =
      job.packageManager === 'npm'
        ? await exists(path.join(src, 'package-lock.json'))
        : true;

    // ── Install ──
    setStatus(job, 'INSTALLING');
    appendLog(job, `\n=== Installing dependencies (${job.packageManager}) ===`);
    let step: StepResult;
    try {
      step = await runStep(
        job,
        job.packageManager,
        installArgs(job.packageManager, hasLockfile),
        src,
        buildEnv(home, false),
        INSTALL_TIMEOUT_MS,
      );
    } catch (err) {
      return fail(
        job,
        `Could not start ${job.packageManager}: ${(err as Error).message}`,
      );
    }
    if (step.timedOut) return fail(job, 'Dependency install timed out.');
    if (step.code !== 0) {
      return fail(job, `Dependency install failed (exit ${step.code}).`);
    }

    // ── Build ──
    setStatus(job, 'BUILDING');
    appendLog(job, `\n=== Running build ===`);
    try {
      step = await runStep(
        job,
        job.packageManager,
        buildArgs(job.packageManager),
        src,
        buildEnv(home, true),
        BUILD_TIMEOUT_MS,
      );
    } catch (err) {
      return fail(job, `Could not start the build: ${(err as Error).message}`);
    }
    if (step.timedOut) return fail(job, 'Build timed out.');
    if (step.code !== 0) {
      return fail(job, `Build failed (exit ${step.code}). See the log above.`);
    }

    // ── Collect output ──
    setStatus(job, 'COLLECTING');
    const outDir = await findOutputDir(src);
    if (!outDir) {
      return fail(
        job,
        'Build finished but produced no recognisable output folder (looked for dist, build, out, _site). Check your build config.',
      );
    }
    appendLog(job, `\n=== Build succeeded — collecting ./${outDir} ===`);

    let outputFiles: DeployFile[];
    try {
      outputFiles = await collectOutput(src, outDir);
    } catch (err) {
      return fail(job, (err as Error).message);
    }
    if (outputFiles.length === 0) {
      return fail(job, `Build output folder ./${outDir} is empty.`);
    }

    // ── Finalize (storage quota + stage) in the route layer ──
    const result = await job.finalize({
      files: outputFiles,
      outputDir: outDir,
      packageManager: job.packageManager,
    });
    if (!result.ok) {
      return fail(job, result.error);
    }
    job.stage = result.stage;
    setStatus(job, 'DONE');
    appendLog(job, `\n✓ Ready to preview and deploy.`);
  } catch (err) {
    logger.error('Build job crashed', { jobId: job.id, error: err });
    fail(job, 'The build server hit an unexpected error.');
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function fail(job: InternalJob, message: string): void {
  job.error = message;
  setStatus(job, 'FAILED');
  appendLog(job, `\n✖ ${message}`);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// Periodic sweep so finished jobs don't accumulate forever.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) {
    const done = j.status === 'DONE' || j.status === 'FAILED';
    if (done && now - j.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000);
sweep.unref?.();
