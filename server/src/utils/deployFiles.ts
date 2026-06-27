/**
 * Deploy file utilities
 *
 * Shared, pure helpers for turning an upload (ZIP / folder / multi-file) into a
 * pinnable file list, plus the logic that decides whether an upload is actually
 * deployable as a static site and where its root lives.
 *
 * IMPORTANT (honesty boundary): we never run an uploaded project's build script
 * server-side (that would be remote code execution). If a project has not been
 * built, `resolveDeployable` halts with guidance instead of faking a build.
 */

import AdmZip from 'adm-zip';
import nodePath from 'path';

export interface DeployFile {
  buffer: Buffer;
  /** Relative path with forward slashes, no leading slash. */
  path: string;
  mimeType: string;
}

/** Thrown when an upload (e.g. a zip bomb) exceeds the uncompressed limits. */
export class UploadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadTooLargeError';
  }
}

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  '.npmrc',
  '.netrc',
  '.aws',
  '.ssh',
]);

// Secret/credential filenames — never stage or serve these. Everything in a
// stage is reachable through the public (unguessable) preview URL, so secrets
// accidentally included in an upload must be dropped before they get there.
const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production, ...
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|keystore|p12|pfx|ppk)$/i,
  /^\.htpasswd$/i,
];

export function shouldIgnoreFile(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/');
  if (parts.some((p) => IGNORED_SEGMENTS.has(p))) return true;
  const base = parts[parts.length - 1] ?? '';
  return SECRET_FILE_PATTERNS.some((re) => re.test(base));
}

export function getMimeType(filePath: string): string {
  const ext = nodePath.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.cjs': 'application/javascript',
    '.ts': 'application/typescript',
    '.jsx': 'application/javascript',
    '.tsx': 'application/typescript',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.xml': 'application/xml',
    '.map': 'application/json',
    '.pdf': 'application/pdf',
  };
  return types[ext] ?? 'application/octet-stream';
}

/**
 * Extract a ZIP buffer into a flat file list with cleaned relative paths.
 * Strips a common root folder if all entries share one (typical of zipped
 * project directories exported from Replit, GitHub, etc.).
 */
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024; // 1 GB uncompressed ceiling
const MAX_EXTRACTED_FILES = 5000;

export function extractZipToFiles(buffer: Buffer): DeployFile[] {
  const zip = new AdmZip(buffer);
  const raw: DeployFile[] = [];
  let totalBytes = 0;
  let fileCount = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const entryPath = entry.entryName.replace(/\\/g, '/');
    if (shouldIgnoreFile(entryPath)) continue;

    // Zip-bomb guard: check the declared uncompressed size and file count
    // BEFORE materialising each entry into memory with getData().
    fileCount += 1;
    if (fileCount > MAX_EXTRACTED_FILES) {
      throw new UploadTooLargeError(`This ZIP contains more than ${MAX_EXTRACTED_FILES} files.`);
    }
    totalBytes += entry.header.size;
    if (totalBytes > MAX_EXTRACTED_BYTES) {
      throw new UploadTooLargeError('This ZIP expands to more than the 1 GB uncompressed limit.');
    }

    raw.push({
      buffer: entry.getData(),
      path: entryPath,
      mimeType: getMimeType(entryPath),
    });
  }

  if (raw.length === 0) return raw;

  // Strip shared root folder (e.g. "myproject/" prefix common in GitHub ZIPs).
  const roots = new Set(raw.map((f) => f.path.split('/')[0]));
  if (roots.size === 1) {
    const prefix = Array.from(roots)[0] + '/';
    const stripped = raw
      .map((f) => ({
        ...f,
        path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
      }))
      .filter((f) => f.path.length > 0);
    if (stripped.length > 0) return stripped;
  }

  return raw;
}

/**
 * Detect the project framework type from the list of file paths.
 * Used for logging and entry-point hints.
 */
export function detectProjectType(
  filePaths: string[],
): { type: string; entryPoint: string | null } {
  const has = (name: string) =>
    filePaths.some((p) => p === name || p.endsWith('/' + name));

  let type = 'static';
  if (has('package.json')) {
    if (has('vite.config.ts') || has('vite.config.js')) type = 'vite';
    else if (has('next.config.js') || has('next.config.ts')) type = 'nextjs';
    else if (has('angular.json')) type = 'angular';
    else type = 'node';
  } else if (has('requirements.txt') || has('pyproject.toml')) {
    type = 'python-static';
  }

  const entryPriority = [
    'index.html',
    'dist/index.html',
    'build/index.html',
    'public/index.html',
    'out/index.html',
    '_site/index.html',
  ];
  const entryPoint = entryPriority.find((p) => filePaths.includes(p)) ?? null;

  return { type, entryPoint };
}

/**
 * Server frameworks whose presence in package.json means the project runs a
 * long-lived server process (not just static files), so it needs a backend.
 */
const SERVER_FRAMEWORK_DEPS = [
  'express',
  'fastify',
  'koa',
  '@hapi/hapi',
  'hapi',
  'hono',
  'restify',
  'polka',
  'micro',
  'connect',
  '@nestjs/core',
  'sails',
  '@adonisjs/core',
  '@feathersjs/feathers',
  'apollo-server',
  '@apollo/server',
  'socket.io',
];

export interface BackendNeed {
  /** True when the project needs a running server, not just static hosting. */
  needsBackend: boolean;
  /** Human-readable signals behind the decision (for logging + honest UI hints). */
  reasons: string[];
}

/**
 * Read the shallowest package.json in the upload (the project root one) and
 * parse it. Returns null if there's no package.json or it isn't valid JSON.
 */
function readRootPackageJson(files: DeployFile[]): Record<string, unknown> | null {
  const candidates = files
    .filter((f) => f.path === 'package.json' || f.path.endsWith('/package.json'))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const pkgFile = candidates[0];
  if (!pkgFile) return null;
  try {
    const parsed = JSON.parse(pkgFile.buffer.subarray(0, 1024 * 1024).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether an uploaded/imported project needs a server-side backend
 * (Next.js SSR/API routes, Express/Fastify/Nest/etc., a server entry file).
 *
 * Pure + read-only: we never run the project. Signals are conservative — a
 * plain static site (Vite/CRA/Angular build output, lone HTML) returns
 * `needsBackend:false`. The deploy step uses this to offer "Deploy with
 * backend" (paid tiers only); the front-end always still pins to IPFS.
 */
export function detectBackendNeed(files: DeployFile[]): BackendNeed {
  const reasons: string[] = [];
  const paths = files.map((f) => f.path);
  const hasPath = (re: RegExp) => paths.some((p) => re.test(p));

  // 1) Server framework dependency or a start script that launches a server.
  const pkg = readRootPackageJson(files);
  if (pkg) {
    const deps: Record<string, string> = {
      ...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
      ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
    };
    for (const dep of SERVER_FRAMEWORK_DEPS) {
      if (deps[dep]) reasons.push(`depends on "${dep}"`);
    }
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
    const start = (scripts.start ?? '').trim();
    if (/\b(node|nest start|next start|fastify start|tsx|ts-node)\b/.test(start)) {
      reasons.push(`start script runs a server (${start.slice(0, 60)})`);
    }
  }

  // 2) Next.js that is NOT configured as a static export → needs a Node server.
  const nextConfig = files.find((f) => /(^|\/)next\.config\.(js|ts|mjs|cjs)$/.test(f.path));
  if (nextConfig) {
    const cfg = nextConfig.buffer.subarray(0, 256 * 1024).toString('utf8');
    if (!/output\s*:\s*['"]export['"]/.test(cfg)) {
      reasons.push('Next.js without static export (output:"export")');
    }
  }

  // 3) API route directories (Next pages/app router) → server endpoints.
  if (hasPath(/(^|\/)(pages|app)\/api\//)) {
    reasons.push('has API routes (pages/api or app/api)');
  }

  // 4) A dedicated server entry file.
  if (hasPath(/(^|\/)(src\/)?server\.(js|ts|mjs|cjs)$/)) {
    reasons.push('has a server entry file (server.*)');
  }

  return { needsBackend: reasons.length > 0, reasons };
}

export interface MonorepoSignal {
  /** True when the upload looks like a multi-package monorepo / workspace. */
  isMonorepo: boolean;
  /** Human-readable signals behind the decision (for logging + honest UI). */
  reasons: string[];
}

/**
 * Heuristic: does this upload look like a monorepo / workspace rather than a
 * single deployable app? Any one signal is enough:
 *   - a pnpm-workspace.yaml at/near the root,
 *   - a root package.json with a non-empty "workspaces" field (npm/yarn/bun),
 *   - two or more package.json files (a root plus nested packages).
 *
 * Pure + read-only. Used to WARN before a long build — Cherri publishes a single
 * static site, so a monorepo usually needs to be pointed at one app folder. This
 * never blocks on its own: when there's a build script the user can proceed
 * anyway (their root build may produce a static site).
 */
export function detectMonorepo(files: DeployFile[]): MonorepoSignal {
  const reasons: string[] = [];
  const paths = files.map((f) => f.path);

  if (paths.some((p) => p === 'pnpm-workspace.yaml' || p.endsWith('/pnpm-workspace.yaml'))) {
    reasons.push('pnpm-workspace.yaml present');
  }

  const pkg = readRootPackageJson(files);
  const ws = pkg?.workspaces;
  const hasWorkspaces = Array.isArray(ws) ? ws.length > 0 : !!ws && typeof ws === 'object';
  if (hasWorkspaces) reasons.push('root package.json declares "workspaces"');

  const pkgCount = paths.filter(
    (p) => p === 'package.json' || p.endsWith('/package.json'),
  ).length;
  if (pkgCount >= 2) reasons.push(`${pkgCount} package.json files (nested packages)`);

  return { isMonorepo: reasons.length > 0, reasons };
}

// Ordered preference for the deployable entry point. Root first, then the
// common build-output folders. Whichever matches becomes the site root.
const ENTRY_PRIORITY = [
  'index.html',
  'dist/index.html',
  'build/index.html',
  'out/index.html',
  'public/index.html',
  '_site/index.html',
];

// Folders that hold already-built output. An entry from one of these is trusted
// as built; an entry from anywhere else is content-scanned for unbuilt markers.
const BUILD_OUTPUT_DIRS = ['dist/', 'build/', 'out/', '_site/'];

/**
 * Heuristic: does this entry HTML load source modules a browser can't run?
 * Catches Vite/Parcel templates (`<script src="/src/main.tsx">`), CRA's
 * `public/index.html` (`%PUBLIC_URL%`), and Vite env placeholders. Used to halt
 * honestly instead of pinning a site we already know is broken.
 */
function entryLooksUnbuilt(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 256 * 1024).toString('utf8');
  return (
    /<script[^>]+src=["'][^"']*\/src\//i.test(head) ||
    /<script[^>]+src=["'][^"']*\.(tsx|ts|jsx)["']/i.test(head) ||
    /%PUBLIC_URL%/.test(head) ||
    /%VITE_[A-Z0-9_]+%/.test(head)
  );
}

export interface DeployableResolution {
  deployable: boolean;
  /** Set only when `deployable` is false — user-facing guidance. */
  haltReason?: string;
  /**
   * Set only when `deployable` is false — a stable discriminator for the halt so
   * callers can refine the message (e.g. keep the "unbuilt app" guidance instead
   * of a generic "no build script" one). Advisory; never changes the decision.
   */
  haltKind?: 'no-entry' | 'unbuilt-entry';
  projectType: string;
  /** Folder prefix that becomes the site root, with trailing slash ('' = upload root). */
  rootPrefix: string;
  /** Entry HTML file, relative to `rootPrefix` (e.g. 'index.html'). */
  entryPoint: string | null;
  /** Deployable subset, with `rootPrefix` stripped so the site serves at '/'. */
  files: DeployFile[];
}

/**
 * Decide whether an upload can be served as a static site, and from where.
 *
 * Resolution order:
 *   1. index.html at root or a known build-output folder (dist/build/out/...).
 *   2. The shallowest index.html anywhere in the tree.
 *   3. A single lone *.html file (single-page upload with any name).
 * If none of those exist we HALT with guidance rather than pin junk — and if a
 * package.json is present we explain the project needs to be built first.
 */
export function resolveDeployable(files: DeployFile[]): DeployableResolution {
  const clean = files.filter((f) => f.path && !shouldIgnoreFile(f.path));
  const paths = clean.map((f) => f.path);
  const { type } = detectProjectType(paths);

  let entryFull: string | null =
    ENTRY_PRIORITY.find((p) => paths.includes(p)) ?? null;

  if (!entryFull) {
    const indexes = paths
      .filter((p) => p === 'index.html' || p.endsWith('/index.html'))
      .sort(
        (a, b) =>
          a.split('/').length - b.split('/').length || a.length - b.length,
      );
    entryFull = indexes[0] ?? null;
  }

  if (!entryFull) {
    const htmls = paths.filter((p) => /\.html?$/i.test(p));
    if (htmls.length === 1) entryFull = htmls[0];
  }

  if (!entryFull) {
    const hasPackageJson = paths.some(
      (p) => p === 'package.json' || p.endsWith('/package.json'),
    );
    const haltReason = hasPackageJson
      ? "This project hasn't been built yet. Run your build locally (e.g. npm run build) and upload the output folder — usually dist, build, or out."
      : 'No index.html found. Upload a folder or ZIP with an index.html at its root.';
    return {
      deployable: false,
      haltReason,
      haltKind: 'no-entry',
      projectType: type,
      rootPrefix: '',
      entryPoint: null,
      files: [],
    };
  }

  // Honesty gate: if the chosen entry isn't from a build-output folder and its
  // HTML loads source modules a browser can't run (Vite/CRA/Parcel templates),
  // refuse to pin a site we already know is broken — we never fake a build.
  const fromBuildDir = BUILD_OUTPUT_DIRS.some((d) => entryFull.startsWith(d));
  if (!fromBuildDir) {
    const entryFile = clean.find((f) => f.path === entryFull);
    if (entryFile && entryLooksUnbuilt(entryFile.buffer)) {
      return {
        deployable: false,
        haltReason:
          "This looks like an unbuilt app — its entry page loads source files (e.g. /src/...) that browsers can't run directly. Build it locally and upload the output folder, usually dist, build, or out.",
        haltKind: 'unbuilt-entry',
        projectType: type,
        rootPrefix: '',
        entryPoint: null,
        files: [],
      };
    }
  }

  const slash = entryFull.lastIndexOf('/');
  const rootPrefix = slash === -1 ? '' : entryFull.slice(0, slash + 1);
  const entryPoint = slash === -1 ? entryFull : entryFull.slice(slash + 1);

  const deployable = clean
    .filter((f) => (rootPrefix === '' ? true : f.path.startsWith(rootPrefix)))
    .map((f) => ({
      ...f,
      path: rootPrefix === '' ? f.path : f.path.slice(rootPrefix.length),
    }))
    .filter((f) => f.path.length > 0);

  return {
    deployable: true,
    projectType: type,
    rootPrefix,
    entryPoint,
    files: deployable,
  };
}

const SCAN_EXTS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.jsx']);
const MAX_SCAN_BYTES = 2 * 1024 * 1024; // scan only the first 2 MB of each text file

export interface PiSdkScan {
  /** The Pi SDK <script src="…sdk.minepi.com/pi-sdk.js"> is present. */
  scriptDetected: boolean;
  /** A Pi.init( … ) call is present. */
  initDetected: boolean;
  /** Both the script and an init call were found. */
  ready: boolean;
}

/**
 * Advisory scan for the Pi SDK in the deployable files. Never blocks a deploy —
 * a site may legitimately not use Pi features. Used to show a green "Pi-ready"
 * badge or an amber "add the SDK" hint before pinning.
 */
export function scanPiSdk(files: DeployFile[]): PiSdkScan {
  let scriptDetected = false;
  let initDetected = false;

  for (const f of files) {
    const ext = nodePath.extname(f.path).toLowerCase();
    if (!SCAN_EXTS.has(ext)) continue;
    const text = f.buffer.subarray(0, MAX_SCAN_BYTES).toString('utf8');
    if (!scriptDetected && /sdk\.minepi\.com\/pi-sdk\.js/i.test(text)) {
      scriptDetected = true;
    }
    if (!initDetected && /Pi\s*\.\s*init\s*\(/.test(text)) {
      initDetected = true;
    }
    if (scriptDetected && initDetected) break;
  }

  return { scriptDetected, initDetected, ready: scriptDetected && initDetected };
}

/**
 * Pi Network verifies `.pi` domain ownership by fetching a `validation-key.txt`
 * file from the site root. This check is advisory only — it never blocks a
 * preview or a deploy — but the UI surfaces a warning when the file is missing
 * so the user knows their `.pi` domain won't verify until they add it.
 *
 * `files` here are the deployable files with their root prefix already stripped,
 * so "served root" means a path with no slash: exactly `validation-key.txt`.
 */
export function hasValidationKey(files: DeployFile[]): boolean {
  return files.some((f) => f.path === 'validation-key.txt');
}
