/**
 * Phase 9 — SECURITY: running strangers' code.
 *
 * Cherri installs + builds OTHER PEOPLE'S code. This module centralizes the
 * build-security POLICY so the pipeline (buildService.ts) and the operator
 * status surface agree on exactly what protection is in force — and so we are
 * HONEST about what we cannot enforce.
 *
 * HARD TRUTH (no faking): this server runs on a host without Docker / cgroups /
 * root, so we CANNOT give a build a real container, a private kernel namespace,
 * or a hard RSS/CPU cgroup. We therefore HARDEN the in-process builder as far as
 * the OS allows and expose an honest descriptor (`getBuildIsolation`) that says
 * `containerized: false`. A future ephemeral remote build container is a gated
 * seam (`describeRemoteBuilder`) that stays BLOCKED until paid provisioning +
 * a build-container template exist — it never silently "becomes" a sandbox.
 *
 * Dependency-safety aggressiveness is a single config knob
 * (BUILD_DEPENDENCY_POLICY) so switching strict<->balanced<->permissive is one
 * change, not a rewrite. Default is BALANCED: install lifecycle scripts are
 * blocked, a vetted allowlist of packages that legitimately need them is
 * rebuilt, and everything else is surfaced to the user — never run silently.
 */

export type DependencyPolicyMode = 'strict' | 'balanced' | 'permissive';

/** OS-level (ulimit) caps applied per build step, best-effort. */
export interface BuildResourceLimits {
  /** ulimit -t — CPU seconds per process. Generous; wall-clock is primary. */
  cpuSeconds: number;
  /** ulimit -f — max bytes a single created file may reach (SIGXFSZ over it). */
  maxFileBytes: number;
  /**
   * ulimit -u — max processes for the build. DISABLED by default (0): on this
   * shared-UID host RLIMIT_NPROC counts the whole user's processes, so a low cap
   * could starve the main server or false-kill the build. Opt-in only.
   */
  maxProcesses: number;
  /**
   * ulimit -v — address-space cap in bytes. DISABLED by default (0): Node/V8 and
   * esbuild reserve huge virtual address space, so a low -v reliably breaks
   * legitimate builds. We do NOT pretend this is RSS enforcement. Opt-in only.
   */
  addressSpaceBytes: number;
}

export interface BuildSecurityPolicy {
  mode: DependencyPolicyMode;
  /** True when install lifecycle scripts must be blocked (strict + balanced). */
  blockInstallScripts: boolean;
  /** True when allowlisted packages may be rebuilt after a blocked install. */
  rebuildAllowlisted: boolean;
  resources: BuildResourceLimits;
}

/**
 * Packages that legitimately run lifecycle scripts to fetch/compile a native or
 * platform binary. In BALANCED mode these are rebuilt after a scripts-blocked
 * install so real apps still work; everything else stays blocked. This is NOT a
 * trust list for arbitrary code — it is a small, reviewed set of well-known
 * build tools. Matching is by exact package name (any position in the tree).
 */
export const BUILD_SCRIPT_ALLOWLIST: readonly string[] = [
  'esbuild',
  '@swc/core',
  '@swc/cli',
  'lightningcss',
  '@tailwindcss/oxide',
  '@parcel/watcher',
  'fsevents',
  'sharp',
  'bcrypt',
  '@node-rs/bcrypt',
  'argon2',
  'node-sass',
  'sass',
  'sass-embedded',
  'sqlite3',
  'better-sqlite3',
  'canvas',
  'prisma',
  '@prisma/client',
  '@prisma/engines',
  'cpu-features',
  'ssh2',
  'protobufjs',
  'core-js',
  'core-js-pure',
  'es5-ext',
  'nx',
  'unrs-resolver',
  'msw',
];

const ALLOWLIST_SET = new Set(BUILD_SCRIPT_ALLOWLIST);

/** Lifecycle hooks npm/pnpm/yarn run automatically during install. */
export const INSTALL_LIFECYCLE_HOOKS: readonly string[] = [
  'preinstall',
  'install',
  'postinstall',
  'preuninstall',
  'postuninstall',
  'prepare',
  'prepublish',
];

/**
 * Heuristics that, inside an INSTALL lifecycle script, strongly suggest
 * exfiltration / mining / remote code execution. Used only to FLAG (warn) — the
 * real protection is that install scripts are blocked entirely in strict/balanced
 * mode. We never auto-decide guilt from these; we surface them to the user.
 */
export const SUSPICIOUS_SCRIPT_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'remote download (curl/wget)', re: /\b(curl|wget)\b/i },
  { label: 'raw network shell (nc/netcat)', re: /\b(nc|netcat|ncat)\b/i },
  { label: 'reverse shell (/dev/tcp)', re: /\/dev\/(tcp|udp)\//i },
  { label: 'inline code eval (node -e / eval)', re: /\bnode\s+-e\b|\beval\s*\(/i },
  { label: 'base64-decoded payload', re: /base64\s+(-d|--decode|-D)\b/i },
  { label: 'piped shell from network', re: /\|\s*(sh|bash|zsh)\b/i },
  { label: 'crypto miner', re: /\b(xmrig|minerd|stratum\+tcp|cryptonight|ethminer)\b/i },
  { label: 'spawns a child process', re: /child_process|spawn\s*\(|execSync\s*\(/i },
  { label: 'hardcoded IP address', re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { label: 'tor hidden service', re: /\.onion\b/i },
];

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** Parse the dependency-policy mode from a raw value; default BALANCED. */
export function parseDependencyPolicyMode(raw?: string | null): DependencyPolicyMode {
  switch (raw?.trim().toLowerCase()) {
    case 'strict':
      return 'strict';
    case 'permissive':
      return 'permissive';
    case 'balanced':
      return 'balanced';
    default:
      return 'balanced';
  }
}

/** The active build-security policy, derived from env (safe defaults). */
export function getBuildSecurityPolicy(): BuildSecurityPolicy {
  const mode = parseDependencyPolicyMode(process.env.BUILD_DEPENDENCY_POLICY);
  return {
    mode,
    blockInstallScripts: mode === 'strict' || mode === 'balanced',
    rebuildAllowlisted: mode === 'balanced',
    resources: {
      cpuSeconds: envInt('BUILD_CPU_SECONDS', 1800),
      maxFileBytes: envInt('BUILD_MAX_FILE_BYTES', 1024 * 1024 * 1024),
      maxProcesses: envInt('BUILD_MAX_PROCESSES', 0),
      addressSpaceBytes: envInt('BUILD_ADDRESS_SPACE_BYTES', 0),
    },
  };
}

/** True when a package name is on the reviewed lifecycle-script allowlist. */
export function isAllowlisted(name: string): boolean {
  return ALLOWLIST_SET.has(name);
}

/**
 * Augment a package manager's install args with the policy's script handling.
 * The CLI flag takes precedence over any project-level `.npmrc`, so a malicious
 * upload cannot re-enable scripts via config. permissive mode is unchanged.
 */
export function augmentInstallArgs(
  args: string[],
  policy: BuildSecurityPolicy,
): string[] {
  if (policy.blockInstallScripts && !args.includes('--ignore-scripts')) {
    return [...args, '--ignore-scripts'];
  }
  return args;
}

/**
 * Args to rebuild the allowlisted packages after a scripts-blocked install, or
 * null when the package manager has no safe per-package rebuild (yarn classic).
 * Rebuild runs WITHOUT --ignore-scripts so only the allowlisted packages' own
 * lifecycle scripts run; absent packages are silently skipped by the manager.
 */
export function rebuildArgs(
  pm: 'npm' | 'pnpm' | 'yarn',
  packages: readonly string[],
): string[] | null {
  if (packages.length === 0) return null;
  switch (pm) {
    case 'npm':
      return ['rebuild', ...packages];
    case 'pnpm':
      return ['rebuild', ...packages];
    case 'yarn':
      // yarn classic has no targeted rebuild; skip rather than rerun everything.
      return null;
    default:
      return null;
  }
}

/**
 * A dependency spec is "registry-sourced" when it's an ordinary semver range,
 * exact version, or dist-tag resolved from the public npm registry. Anything
 * that REDIRECTS the name elsewhere — a local path, link, git/url tarball, or an
 * `npm:` alias — is NOT registry-sourced. This matters because on the public
 * registry a package NAME is globally unique and uniquely identifies the vetted
 * package; the only way to smuggle attacker code under an allowlisted name is to
 * redirect that name to a non-registry source.
 */
const NON_REGISTRY_SPEC =
  /^(file:|link:|portal:|workspace:|git\+|git:|ssh:\/\/|https?:\/\/|github:|gitlab:|bitbucket:|\.\.?\/|~\/|\/)/i;

export function isRegistrySpec(spec: string): boolean {
  const s = spec.trim();
  if (s.length === 0) return false;
  if (NON_REGISTRY_SPEC.test(s)) return false;
  // Any `npm:` alias redirects the name to another package — treat as non-registry.
  if (/^npm:/i.test(s)) return false;
  return true;
}

/** Strip a trailing `@version` from a (possibly scoped) package name. */
function stripVersionSuffix(name: string): string {
  if (name.startsWith('@')) {
    const at = name.indexOf('@', 1);
    return at >= 0 ? name.slice(0, at) : name; // @scope/name@ver -> @scope/name
  }
  const at = name.indexOf('@');
  return at >= 0 ? name.slice(0, at) : name; // name@ver -> name
}

/**
 * Normalize an override/resolution key (a yarn glob/nested path, or `name@ver`)
 * to a bare package name, preserving a leading `@scope/` for scoped packages.
 */
function overrideBaseName(key: string): string {
  const segs = key.trim().split('/').filter(Boolean);
  if (segs.length === 0) return key.trim();
  const last = segs[segs.length - 1];
  const prev = segs.length >= 2 ? segs[segs.length - 2] : '';
  // A scoped descendant is the trailing `@scope/name` pair.
  const name = prev.startsWith('@') ? `${prev}/${last}` : last;
  return stripVersionSuffix(name);
}

/** Recursively collect (name -> spec) string pairs from an overrides/resolutions tree. */
function collectOverrideSpecs(node: unknown, out: Map<string, string>): void {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === 'string') {
      if (k !== '.') out.set(overrideBaseName(k), v);
    } else if (v && typeof v === 'object') {
      // npm nested form: { foo: { ".": "spec", bar: "spec" } }
      const nested = v as Record<string, unknown>;
      if (typeof nested['.'] === 'string') out.set(overrideBaseName(k), nested['.'] as string);
      collectOverrideSpecs(v, out);
    }
  }
}

/**
 * Allowlisted package NAMES that the project has redirected to a non-registry
 * source via a direct dependency spec OR an overrides/resolutions entry. These
 * must NEVER be rebuilt (rebuild runs their lifecycle scripts), because the
 * redirect could point an allowlisted name at attacker-controlled code.
 */
export function findShadowedAllowlisted(pkg: unknown): string[] {
  if (!pkg || typeof pkg !== 'object') return [];
  const p = pkg as Record<string, unknown>;
  const shadowed = new Set<string>();

  const depMaps = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ];
  for (const m of depMaps) {
    const deps = p[m];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (isAllowlisted(name) && typeof spec === 'string' && !isRegistrySpec(spec)) {
        shadowed.add(name);
      }
    }
  }

  const overrideTrees: unknown[] = [
    p.overrides,
    p.resolutions,
    p.pnpm && typeof p.pnpm === 'object'
      ? (p.pnpm as Record<string, unknown>).overrides
      : undefined,
  ];
  for (const tree of overrideTrees) {
    const specs = new Map<string, string>();
    collectOverrideSpecs(tree, specs);
    for (const [name, spec] of specs) {
      if (isAllowlisted(name) && !isRegistrySpec(spec)) shadowed.add(name);
    }
  }

  return [...shadowed];
}

/**
 * The ONLY registry we trust to prove a package's identity. A registry name is
 * globally unique here, so a tarball served from this host genuinely IS the
 * vetted package. Anything resolved elsewhere (private registry, raw tarball,
 * git, file/link) is unproven and must not have its lifecycle scripts run.
 */
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';

/** A package-lock entry is registry-proven only with a public-registry tarball + integrity, and not a link. */
function isRegistryLockEntry(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  const e = val as Record<string, unknown>;
  if (e.link === true) return false;
  const resolved = typeof e.resolved === 'string' ? e.resolved : '';
  const integrity = typeof e.integrity === 'string' ? e.integrity : '';
  return resolved.startsWith(PUBLIC_NPM_REGISTRY) && integrity.length > 0;
}

/** Walk a lockfileVersion-1 `.dependencies` tree, checking every copy of `name`. */
function checkV1Tree(
  deps: Record<string, unknown>,
  name: string,
  acc: { saw: boolean; allRegistry: boolean },
): void {
  for (const [k, v] of Object.entries(deps)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    if (k === name) {
      acc.saw = true;
      if (!isRegistryLockEntry(e)) acc.allRegistry = false;
    }
    const nested = e.dependencies;
    if (nested && typeof nested === 'object') {
      checkV1Tree(nested as Record<string, unknown>, name, acc);
    }
  }
}

/**
 * Given a parsed `package-lock.json` and candidate package names, return the set
 * PROVEN to resolve ONLY from the public npm registry (every copy in the tree).
 * This is the real provenance check: lockfile `resolved`/`integrity` is what npm
 * actually installs from, so it catches lockfile-pinned malicious tarballs and
 * transitive file:/link: shadows that a root-package.json scan cannot see.
 */
export function proveRegistryFromNpmLock(
  lock: unknown,
  candidates: readonly string[],
): Set<string> {
  const proven = new Set<string>();
  if (!lock || typeof lock !== 'object') return proven;
  const l = lock as Record<string, unknown>;
  const packages =
    l.packages && typeof l.packages === 'object'
      ? (l.packages as Record<string, unknown>)
      : null;
  const v1deps =
    l.dependencies && typeof l.dependencies === 'object'
      ? (l.dependencies as Record<string, unknown>)
      : null;

  for (const name of candidates) {
    const suffix = `node_modules/${name}`;
    let saw = false;
    let allRegistry = true;

    if (packages) {
      for (const [key, val] of Object.entries(packages)) {
        if (key !== suffix && !key.endsWith(`/${suffix}`)) continue;
        saw = true;
        if (!isRegistryLockEntry(val)) {
          allRegistry = false;
          break;
        }
      }
    }
    if (!saw && v1deps) {
      const acc = { saw: false, allRegistry: true };
      checkV1Tree(v1deps, name, acc);
      saw = acc.saw;
      allRegistry = acc.allRegistry;
    }

    if (saw && allRegistry) proven.add(name);
  }
  return proven;
}

/** Result of scanning one package.json's lifecycle scripts. */
export interface ScriptScanResult {
  /** Install lifecycle hooks that are present (would run on a normal install). */
  hooks: string[];
  /** Suspicious heuristics matched inside those hooks (flagged, not blocked). */
  suspicious: { hook: string; label: string }[];
}

/** Scan a parsed package.json for install lifecycle hooks + suspicious tokens. */
export function scanPackageScripts(pkg: unknown): ScriptScanResult {
  const hooks: string[] = [];
  const suspicious: { hook: string; label: string }[] = [];
  const scripts =
    pkg && typeof pkg === 'object'
      ? ((pkg as { scripts?: Record<string, unknown> }).scripts ?? null)
      : null;
  if (!scripts || typeof scripts !== 'object') return { hooks, suspicious };
  for (const hook of INSTALL_LIFECYCLE_HOOKS) {
    const body = (scripts as Record<string, unknown>)[hook];
    if (typeof body !== 'string' || body.length === 0) continue;
    hooks.push(hook);
    for (const { label, re } of SUSPICIOUS_SCRIPT_PATTERNS) {
      if (re.test(body)) suspicious.push({ hook, label });
    }
  }
  return { hooks, suspicious };
}

/**
 * Wrap a command so the spawned shell applies best-effort `ulimit` caps before
 * exec'ing the real command. `exec "$@"` replaces the shell in-place so the
 * existing detached-process-group SIGKILL still reaches the whole tree. Each
 * ulimit is `|| true` so an unsupported limit degrades (no protection) instead
 * of aborting the build — honesty over a fake guarantee.
 */
export function resourceWrapper(
  cmd: string,
  args: string[],
  limits: BuildResourceLimits,
): { cmd: string; args: string[] } {
  const parts: string[] = [];
  if (limits.cpuSeconds > 0) parts.push(`ulimit -t ${limits.cpuSeconds} 2>/dev/null || true`);
  if (limits.maxFileBytes > 0) {
    // ulimit -f unit is 1024-byte blocks on bash/dash.
    const blocks = Math.max(1, Math.ceil(limits.maxFileBytes / 1024));
    parts.push(`ulimit -f ${blocks} 2>/dev/null || true`);
  }
  if (limits.maxProcesses > 0) parts.push(`ulimit -u ${limits.maxProcesses} 2>/dev/null || true`);
  if (limits.addressSpaceBytes > 0) {
    const kb = Math.max(1, Math.ceil(limits.addressSpaceBytes / 1024));
    parts.push(`ulimit -v ${kb} 2>/dev/null || true`);
  }
  const script = `${parts.join('; ')}${parts.length ? '; ' : ''}exec "$@"`;
  return { cmd: '/bin/sh', args: ['-c', script, 'sh', cmd, ...args] };
}

export interface BuildIsolationStatus {
  runner: 'local-hardened';
  /** HONEST: we cannot containerize on this host. Never reported true here. */
  containerized: boolean;
  protections: string[];
  /** What we cannot enforce on this host (disclosed, never faked away). */
  limitations: string[];
}

/** Honest description of how/where untrusted builds actually run today. */
export function getBuildIsolation(): BuildIsolationStatus {
  return {
    runner: 'local-hardened',
    containerized: false,
    protections: [
      'sanitized environment — no Cherri secrets reach the build',
      'throwaway HOME + scrubbed npm/git user config',
      'isolated temp working dir, removed after every build',
      'install lifecycle scripts blocked per dependency-safety policy',
      'wall-clock timeouts with whole-process-group SIGKILL',
      'best-effort ulimit (CPU seconds, single-file size) where supported',
      'output file-count + total-byte caps',
      'one build at a time (global queue)',
    ],
    limitations: [
      'no container/namespace isolation on this host (no Docker/cgroups/root)',
      'per-build RSS memory and CPU are not hard-capped (no cgroups) — bounded by wall-clock + queue',
    ],
  };
}

/**
 * Gated seam for a future EPHEMERAL remote build container (true isolation).
 * Stays BLOCKED until paid provisioning AND a build-container template exist; it
 * never silently becomes available, and nothing here makes a remote call.
 */
export function describeRemoteBuilder(): { available: false; reason: string } {
  return {
    available: false,
    reason:
      'True container-isolated builds require an ephemeral remote build runner, which is gated behind paid provisioning and a build-container template. Until then, builds use the hardened local runner.',
  };
}

/** Compact, user-/operator-safe summary of the active build security posture. */
export interface BuildSecurityDisclosure {
  dependencyPolicy: DependencyPolicyMode;
  installScriptsBlocked: boolean;
  containerized: boolean;
  runner: 'local-hardened';
  resourceLimits: BuildResourceLimits;
}

export function getBuildSecurityDisclosure(
  policy: BuildSecurityPolicy = getBuildSecurityPolicy(),
): BuildSecurityDisclosure {
  return {
    dependencyPolicy: policy.mode,
    installScriptsBlocked: policy.blockInstallScripts,
    containerized: false,
    runner: 'local-hardened',
    resourceLimits: policy.resources,
  };
}
