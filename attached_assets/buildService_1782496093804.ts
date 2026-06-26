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
import {
  augmentInstallArgs,
  BUILD_SCRIPT_ALLOWLIST,
  findShadowedAllowlisted,
  getBuildIsolation,
  getBuildSecurityDisclosure,
  getBuildSecurityPolicy,
  proveRegistryFromNpmLock,
  rebuildArgs,
  resourceWrapper,
  scanPackageScripts,
  type BuildResourceLimits,
  type BuildSecurityDisclosure,
  type BuildSecurityPolicy,
} from './buildSecurity';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

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
  /** Phase 9 — the build-security posture actually applied to this build. */
  security?: BuildSecurityDisclosure;
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
    security: j.security,
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
  // Bun's binary lockfile is bun.lockb; newer Bun also emits a text bun.lock.
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
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

/**
 * Sanitized environment for a build step — our secrets are never included.
 * Phase 9 also SCRUBS user/global npm + git config so an uploaded `.npmrc` /
 * `.netrc` (or one in a real HOME) cannot redirect the registry, inject auth, or
 * re-enable scripts: user/global config are pointed at empty paths in the
 * throwaway HOME, and git is stopped from prompting for credentials.
 */
export function buildEnv(homeDir: string, production: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: homeDir,
    CI: 'true',
    npm_config_cache: path.join(homeDir, '.npm-cache'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    // Scrub user/global npm config — only the project's own .npmrc + our CLI
    // flags apply (and CLI flags win, so --ignore-scripts cannot be overridden).
    npm_config_userconfig: path.join(homeDir, '.npmrc'),
    npm_config_globalconfig: path.join(homeDir, '.npmrc-global'),
    PNPM_HOME: path.join(homeDir, '.pnpm'),
    // Never let a build hang on an interactive git/credential prompt.
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/true',
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
  limits: BuildResourceLimits,
): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    appendLog(job, `$ ${cmd} ${args.join(' ')}`);
    // Apply best-effort OS resource caps via a shell wrapper that exec's the real
    // command in place, so the detached process-group SIGKILL below still works.
    const wrapped = resourceWrapper(cmd, args, limits);
    const child = spawn(wrapped.cmd, wrapped.args, {
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
    case 'bun':
      // Bun installs devDependencies by default; no extra flag needed.
      return ['install'];
    default:
      // npm: include dev deps explicitly; `ci` needs a clean lockfile so prefer
      // the more forgiving `install` to avoid brittle failures.
      return hasLockfile
        ? ['install', '--include=dev', '--no-audit', '--no-fund']
        : ['install', '--include=dev', '--no-audit', '--no-fund'];
  }
}

function buildArgs(pm: PackageManager): string[] {
  // npm / pnpm / yarn / bun all accept `run build`.
  return ['run', 'build'];
}

/** Write the upload's files into the temp source dir, guarding traversal. */
async function writeSource(dir: string, files: DeployFile[]): Promise<void> {
  const rootResolved = path.resolve(dir);
  for (const f of files) {
    const rel = f.path.replace(/\\/g, '/');
    if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '')) continue;
    // Defense in depth: never stage node_modules, VCS dirs, or secret files even
    // if an upstream caller forgot to filter — a planted node_modules/<pkg> with
    // a malicious script must never reach the builder.
    if (shouldIgnoreFile(rel)) continue;
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

/** Allowlisted packages actually present in node_modules (top of the tree). */
async function detectPresentAllowlisted(srcDir: string): Promise<string[]> {
  const present: string[] = [];
  for (const name of BUILD_SCRIPT_ALLOWLIST) {
    const pkgJson = path.join(srcDir, 'node_modules', ...name.split('/'), 'package.json');
    if (await exists(pkgJson)) present.push(name);
  }
  return present;
}

/**
 * The package installed at node_modules/<name> must actually CALL itself <name>.
 * Defeats an `npm:` alias (folder `esbuild` holding a package whose real name is
 * `evil`) from getting `evil`'s lifecycle scripts run during an allowlisted rebuild.
 */
async function installedNameMatches(srcDir: string, name: string): Promise<boolean> {
  try {
    const raw = await fsp.readFile(
      path.join(srcDir, 'node_modules', ...name.split('/'), 'package.json'),
      'utf8',
    );
    return (JSON.parse(raw) as { name?: unknown }).name === name;
  } catch {
    return false;
  }
}

/**
 * Log the build-security posture and scan the project's OWN package.json for
 * install lifecycle scripts + suspicious tokens. We always TELL the user what
 * the policy will do with their scripts — never silently block or run them.
 */
async function announceSecurityPolicy(
  job: InternalJob,
  policy: BuildSecurityPolicy,
  srcDir: string,
): Promise<void> {
  const iso = getBuildIsolation();
  appendLog(job, `\n=== Build security ===`);
  appendLog(job, `Dependency policy: ${policy.mode}.`);
  if (policy.blockInstallScripts) {
    appendLog(
      job,
      policy.rebuildAllowlisted
        ? 'Dependency install scripts are BLOCKED; afterwards, only registry-sourced packages from a vetted native-tools allowlist are rebuilt (anything redirected to a non-registry source stays blocked).'
        : 'Dependency install scripts are BLOCKED (strict mode).',
    );
  } else {
    appendLog(
      job,
      'Dependency install scripts WILL RUN (permissive mode); suspicious ones are flagged below.',
    );
  }
  appendLog(
    job,
    `Isolation: ${iso.runner} (containerized: ${iso.containerized}) — ${iso.limitations[0]}.`,
  );

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await fsp.readFile(path.join(srcDir, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  const scan = scanPackageScripts(parsed);
  if (scan.hooks.length > 0) {
    const verb = policy.blockInstallScripts ? 'are BLOCKED' : 'will run';
    appendLog(
      job,
      `⚠ This project declares install lifecycle scripts (${scan.hooks.join(', ')}) — they ${verb} under the current policy.`,
    );
  }
  for (const s of scan.suspicious) {
    appendLog(job, `⚠ Flagged in "${s.hook}": ${s.label}.`);
  }
}

/**
 * BALANCED mode only: after a scripts-blocked install, rebuild the allowlisted
 * native packages so real apps still work. Best-effort — a rebuild failure is
 * logged honestly but does not fail the build (the build step surfaces any real
 * consequence of a missing native binary).
 */
async function maybeRebuildAllowlisted(
  job: InternalJob,
  srcDir: string,
  homeDir: string,
  policy: BuildSecurityPolicy,
): Promise<void> {
  if (!policy.rebuildAllowlisted) return;
  const detected = await detectPresentAllowlisted(srcDir);
  if (detected.length === 0) return;

  // Provenance is proven from the LOCKFILE (what the package manager actually
  // installs from), not from root package.json. We only verify npm's lockfile
  // today; for pnpm/yarn we cannot prove public-registry provenance here, so we
  // refuse to run their scripts and say so honestly rather than guess.
  if (job.packageManager !== 'npm') {
    appendLog(
      job,
      `\nℹ ${detected.length} allowlisted native package(s) detected, but public-registry provenance can't be verified for ${job.packageManager} lockfiles yet — their install scripts stay BLOCKED (not rebuilt). Set BUILD_DEPENDENCY_POLICY=permissive if your app needs them.`,
    );
    return;
  }

  let lock: unknown = null;
  try {
    lock = JSON.parse(await fsp.readFile(path.join(srcDir, 'package-lock.json'), 'utf8'));
  } catch {
    appendLog(
      job,
      `\nℹ No readable package-lock.json after install — registry provenance can't be proven, so allowlisted native packages were NOT rebuilt. Set BUILD_DEPENDENCY_POLICY=permissive if your app needs them.`,
    );
    return;
  }
  const proven = proveRegistryFromNpmLock(lock, detected);

  // Defense in depth: also drop anything the root declares as a redirect, and
  // require the installed package to actually call itself that name.
  let userPkg: unknown = null;
  try {
    userPkg = JSON.parse(await fsp.readFile(path.join(srcDir, 'package.json'), 'utf8'));
  } catch {
    /* no/invalid package.json — rely on lockfile provenance + name check */
  }
  const shadowed = new Set(findShadowedAllowlisted(userPkg));

  const present: string[] = [];
  const refused: string[] = [];
  for (const name of detected) {
    if (proven.has(name) && !shadowed.has(name) && (await installedNameMatches(srcDir, name))) {
      present.push(name);
    } else {
      refused.push(name);
    }
  }
  if (refused.length > 0) {
    appendLog(
      job,
      `\n⚠ Not rebuilt — public-registry provenance unproven, or the name is redirected/mismatched on disk (install scripts stay BLOCKED): ${refused.join(', ')}.`,
    );
  }
  if (present.length === 0) return;

  const args = rebuildArgs(job.packageManager, present);
  if (!args) {
    appendLog(
      job,
      `\nℹ ${present.length} allowlisted native package(s) detected, but ${job.packageManager} has no targeted rebuild — they were not rebuilt. Set BUILD_DEPENDENCY_POLICY=permissive if your app needs them.`,
    );
    return;
  }
  appendLog(job, `\n=== Rebuilding allowlisted native packages (${present.join(', ')}) ===`);
  let step: StepResult;
  try {
    step = await runStep(
      job,
      job.packageManager,
      args,
      srcDir,
      buildEnv(homeDir, false),
      INSTALL_TIMEOUT_MS,
      policy.resources,
    );
  } catch (err) {
    appendLog(job, `ℹ Allowlisted rebuild could not start: ${(err as Error).message}`);
    return;
  }
  if (step.timedOut || step.code !== 0) {
    appendLog(job, 'ℹ Allowlisted rebuild did not complete cleanly (continuing).');
  }
}

async function runJob(job: InternalJob): Promise<void> {
  const work = path.join(os.tmpdir(), `cherri-build-${job.id}`);
  const src = path.join(work, 'src');
  const home = path.join(work, 'home');

  try {
    // 0700 throwaway dirs so another tenant's build can't read this one's source
    // or HOME (chmod after mkdir to defeat a permissive umask).
    await fsp.mkdir(work, { recursive: true });
    await fsp.chmod(work, 0o700).catch(() => {});
    await fsp.mkdir(src, { recursive: true });
    await fsp.chmod(src, 0o700).catch(() => {});
    await fsp.mkdir(home, { recursive: true });
    await fsp.chmod(home, 0o700).catch(() => {});
    await writeSource(src, job.files);
    // Free the in-memory source buffers now that they're on disk.
    job.files = [];

    const hasLockfile =
      job.packageManager === 'npm'
        ? await exists(path.join(src, 'package-lock.json'))
        : true;

    // ── Build-security policy (Phase 9) ──
    const policy = getBuildSecurityPolicy();
    job.security = getBuildSecurityDisclosure(policy);
    await announceSecurityPolicy(job, policy, src);

    // ── Install ──
    setStatus(job, 'INSTALLING');
    appendLog(job, `\n=== Installing dependencies (${job.packageManager}) ===`);
    let step: StepResult;
    try {
      step = await runStep(
        job,
        job.packageManager,
        augmentInstallArgs(installArgs(job.packageManager, hasLockfile), policy),
        src,
        buildEnv(home, false),
        INSTALL_TIMEOUT_MS,
        policy.resources,
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

    // Re-enable only the vetted allowlist's native build scripts (balanced mode).
    await maybeRebuildAllowlisted(job, src, home, policy);

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
        policy.resources,
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
