/**
 * T4.1 — AI concierge: build-failure triage
 *
 * Maps common build failure patterns (from real build logs) to:
 *   - A plain-language explanation the user can actually understand
 *   - A structured one-tap fix action the client can apply automatically
 *
 * This is the first half of the concierge's "operates WITH you" promise.
 * It does NOT call an external LLM; it's a pure pattern-matching triage engine.
 * Real AI explanation can be layered on top — this module is the structural
 * skeleton that the AI would populate.
 *
 * Design:
 *   - Pure function, no DB, no network.
 *   - Deterministic: same log → same triage (no randomness, no "maybe").
 *   - Ordered: first match wins. More specific patterns come before general ones.
 *   - Honest: if nothing matches, says so clearly instead of guessing.
 */

// ─── Fix action types ─────────────────────────────────────────────────────────

/**
 * A structured one-tap fix action the client can execute automatically.
 * Keep the action enum small and stable — clients implement one switch per action.
 */
export type FixAction =
  | { action: 'setOutputDir'; value: string }
  | { action: 'setBuildScript'; value: string }
  | { action: 'setNodeVersion'; value: string }
  | { action: 'removeLockfile'; filename: string }
  | { action: 'addDependency'; name: string; dev: boolean }
  | { action: 'increaseMemory' }
  | { action: 'contactSupport' }
  | { action: 'retry' };

// ─── Triage result ────────────────────────────────────────────────────────────

export interface TriageResult {
  /** True when a known pattern was matched */
  matched: boolean;
  /** Short category tag for analytics / routing */
  category: string;
  /** Plain-language title (short — used in the concierge toast) */
  title: string;
  /** Full plain-language explanation for the expanded concierge panel */
  explanation: string;
  /** The one-tap fix the client should offer, or null if none */
  suggestedFix: FixAction | null;
  /** Confidence: 'high' = very specific match; 'medium' = partial match */
  confidence: 'high' | 'medium';
}

// ─── Build context ────────────────────────────────────────────────────────────

export interface BuildContext {
  /** Framework detected (vite, react, next, astro, etc.) or undefined */
  framework?: string;
  /** Node version in use at build time */
  nodeVersion?: string;
  /** Package manager (npm, pnpm, yarn, bun) */
  packageManager?: string;
}

// ─── Pattern registry ─────────────────────────────────────────────────────────

interface TriageRule {
  /** Category tag */
  category: string;
  /** Patterns that must ALL match (AND logic) — at least one required */
  patterns: RegExp[];
  /** Patterns that, if present, indicate this rule does NOT apply */
  antiPatterns?: RegExp[];
  triage(logs: string, context: BuildContext): TriageResult;
}

const RULES: TriageRule[] = [

  // ── Output directory not found ──────────────────────────────────────────────
  {
    category: 'wrong-output-dir',
    patterns: [
      /(?:could not find|no such file|error:?\s+(?:ENOENT|ENODIR)).*(?:dist|build|out|\.next|public)\b/i,
    ],
    triage(logs): TriageResult {
      // Try to extract the expected output dir from the log
      const match = logs.match(/no such file[^:]*:\s*['"]?([^\s'"]+(?:dist|build|out|\.next|public)[^\s'"]*?)['"]?/i)
        || logs.match(/(?:cannot find|missing|not found)[^:]*:\s*['"]?([^\s'"]*(?:dist|build|out|\.next|public)[^\s'"]*)['"]?/i);
      const suggestedDir = match?.[1]?.replace(/^.*\/([^/]+)$/, '$1') ?? 'dist';
      return {
        matched: true,
        category: 'wrong-output-dir',
        title: 'Build output folder not found',
        explanation:
          `The build finished, but Cherri couldn't find the output folder. ` +
          `Your framework probably puts its output in "${suggestedDir}", ` +
          `but a different folder name is configured. ` +
          `Setting the output directory to "${suggestedDir}" should fix this.`,
        suggestedFix: { action: 'setOutputDir', value: suggestedDir },
        confidence: 'high',
      };
    },
  },

  // ── Vite/React/Next specific output dir ────────────────────────────────────
  {
    category: 'wrong-output-dir-framework',
    patterns: [
      /vite.*build.*completed|vite.*built/i,
      /could not find.*dist|dist.*not found|no such file.*dist/i,
    ],
    triage(): TriageResult {
      return {
        matched: true,
        category: 'wrong-output-dir-framework',
        title: 'Vite build output missing',
        explanation:
          'Vite builds your site into the "dist" folder by default. ' +
          'The build ran successfully but the "dist" folder isn\'t where Cherri expected. ' +
          'Setting the output directory to "dist" should fix this immediately.',
        suggestedFix: { action: 'setOutputDir', value: 'dist' },
        confidence: 'high',
      };
    },
  },

  // ── Missing build script ───────────────────────────────────────────────────
  {
    category: 'missing-build-script',
    patterns: [
      /missing script:?\s*['"]?build['"]?|no script named build|npm ERR! Missing script: build/i,
    ],
    triage(logs, context): TriageResult {
      const pm = context.packageManager ?? 'npm';
      return {
        matched: true,
        category: 'missing-build-script',
        title: 'No "build" script in package.json',
        explanation:
          `Your package.json doesn't have a "build" script, so ${pm} doesn't know how to build your site. ` +
          'If you\'re using Vite, add: "build": "vite build". ' +
          'If you\'re using Create React App, add: "build": "react-scripts build". ' +
          'For Next.js, add: "build": "next build".',
        suggestedFix: { action: 'setBuildScript', value: 'vite build' },
        confidence: 'high',
      };
    },
  },

  // ── Node version mismatch ─────────────────────────────────────────────────
  {
    category: 'node-version-mismatch',
    patterns: [
      /engines.*node.*required|node.*>=.*required|node.*version.*not supported/i,
    ],
    triage(logs): TriageResult {
      // Try to extract the required version
      const match = logs.match(/node.*?>=?\s*([0-9]+(?:\.[0-9]+)?)/i)
        || logs.match(/required.*node.*?([0-9]+(?:\.[0-9]+)?)/i);
      const requiredVersion = match?.[1] ? `${match[1]}` : '20';
      return {
        matched: true,
        category: 'node-version-mismatch',
        title: 'Node.js version is too old for this project',
        explanation:
          `This project requires Node.js ${requiredVersion} or newer, but an older version is being used. ` +
          `Switching to Node ${requiredVersion} should fix the build.`,
        suggestedFix: { action: 'setNodeVersion', value: requiredVersion },
        confidence: 'high',
      };
    },
  },

  // ── Lockfile mismatch ─────────────────────────────────────────────────────
  {
    category: 'lockfile-mismatch',
    patterns: [
      /lockfile.*out of date|package-lock.*out of (?:sync|date)|yarn\.lock.*out of date|pnpm-lock.*out of date|OUTDATED_LOCKFILE|frozen.lockfile|Your lockfile needs to be updated/i,
    ],
    triage(logs): TriageResult {
      const isYarn = /yarn\.lock|Your lockfile needs to be updated/i.test(logs);
      const isPnpm = /pnpm-lock|OUTDATED_LOCKFILE|pnpm/i.test(logs) && !isYarn;
      const filename = isYarn ? 'yarn.lock' : isPnpm ? 'pnpm-lock.yaml' : 'package-lock.json';
      return {
        matched: true,
        category: 'lockfile-mismatch',
        title: 'Lockfile is out of date',
        explanation:
          `Your ${filename} doesn't match your package.json. ` +
          `This usually happens when you add a package but forget to update the lockfile. ` +
          `Deleting the lockfile and letting the build regenerate it will fix this.`,
        suggestedFix: { action: 'removeLockfile', filename },
        confidence: 'high',
      };
    },
  },

  // ── Missing dependency ────────────────────────────────────────────────────
  {
    category: 'missing-dependency',
    patterns: [
      /Cannot find module ['"]([^'"]+)['"]|Module not found: Error: Can't resolve ['"]([^'"]+)['"]/i,
    ],
    triage(logs): TriageResult {
      const match = logs.match(/Cannot find module ['"]([^'"]+)['"]/i)
        || logs.match(/Can't resolve ['"]([^'"]+)['"]/i);
      const missingPkg = match?.[1]?.split('/')[0] ?? 'the missing package';
      const isDevOnly = /postcss|tailwind|babel|webpack|vite/i.test(missingPkg);
      return {
        matched: true,
        category: 'missing-dependency',
        title: `Missing package: ${missingPkg}`,
        explanation:
          `The build failed because "${missingPkg}" is not installed. ` +
          `This package needs to be added to your ${isDevOnly ? 'dev ' : ''}dependencies. ` +
          (isDevOnly ? 'It\'s a build tool, so it should go in devDependencies.' : ''),
        suggestedFix: { action: 'addDependency', name: missingPkg, dev: isDevOnly },
        confidence: 'high',
      };
    },
  },

  // ── OOM / SIGKILL ──────────────────────────────────────────────────────────
  {
    category: 'out-of-memory',
    patterns: [
      /SIGKILL|out of memory|Killed\s*$|JavaScript heap out of memory|ENOMEM/im,
    ],
    triage(): TriageResult {
      return {
        matched: true,
        category: 'out-of-memory',
        title: 'Build ran out of memory',
        explanation:
          'The build process used more memory than was available and was forcefully stopped. ' +
          'This usually happens with large projects or when bundling many dependencies at once. ' +
          'Increasing the memory limit or optimising your build config should help.',
        suggestedFix: { action: 'increaseMemory' },
        confidence: 'medium',
      };
    },
  },

  // ── TypeScript compilation error ───────────────────────────────────────────
  {
    category: 'typescript-error',
    patterns: [
      /error TS[0-9]+:/i,
    ],
    triage(logs): TriageResult {
      const match = logs.match(/error (TS[0-9]+):[^\n]*/i);
      const tsError = match?.[0]?.slice(0, 120) ?? 'TypeScript compilation error';
      return {
        matched: true,
        category: 'typescript-error',
        title: 'TypeScript compilation failed',
        explanation:
          `Your code has a TypeScript type problem that stopped the build. ` +
          `The first issue found: ${tsError}. ` +
          `Fix the type problem in your code and rebuild. ` +
          `If you\'re in a hurry, you can temporarily set "strict: false" in tsconfig.json, ` +
          `but fixing it properly is the right long-term approach.`,
        suggestedFix: null,
        confidence: 'high',
      };
    },
  },

  // ── Peer dependency conflict ───────────────────────────────────────────────
  {
    category: 'peer-dependency-conflict',
    patterns: [
      /ERESOLVE|peer dep.*conflict|unable to resolve dependency tree|npm ERR! Conflicting peer dependency/i,
    ],
    triage(): TriageResult {
      return {
        matched: true,
        category: 'peer-dependency-conflict',
        title: 'Package version conflict',
        explanation:
          'Two of your packages need conflicting versions of a shared dependency. ' +
          'This is a common issue when mixing packages that haven\'t been updated to work with newer versions of each other. ' +
          'Check your package versions and try aligning them, or contact support for help.',
        suggestedFix: { action: 'contactSupport' },
        confidence: 'medium',
      };
    },
  },

  // ── Timeout ───────────────────────────────────────────────────────────────
  {
    category: 'build-timeout',
    patterns: [
      /build.*timed? out|exceeded.*time limit|wall[- ]clock.*limit|timeout.*exceeded/i,
    ],
    triage(): TriageResult {
      return {
        matched: true,
        category: 'build-timeout',
        title: 'Build took too long',
        explanation:
          'The build exceeded the maximum allowed time. ' +
          'This can happen with very large projects or if the build has an infinite loop. ' +
          'Try simplifying the build, or split the project into smaller parts.',
        suggestedFix: { action: 'retry' },
        confidence: 'medium',
      };
    },
  },

  // ── Generic npm/yarn install failure ───────────────────────────────────────
  {
    category: 'install-failure',
    patterns: [
      /npm ERR! code [A-Z]+|ERR_PNPM_[A-Z_]+|error Command failed with exit code/i,
    ],
    antiPatterns: [
      /Missing script: build/i, // already handled above
    ],
    triage(logs): TriageResult {
      const match = logs.match(/npm ERR! code ([A-Z]+)/i) || logs.match(/ERR_PNPM_([A-Z_]+)/i);
      const code = match?.[1] ?? 'install error';
      return {
        matched: true,
        category: 'install-failure',
        title: 'Package installation failed',
        explanation:
          `The package install step failed (${code}). ` +
          `This is usually a network issue, a registry problem, or a package that requires native compilation. ` +
          `Try redeploying — transient issues usually resolve on a retry.`,
        suggestedFix: { action: 'retry' },
        confidence: 'medium',
      };
    },
  },
];

// ─── Triage engine ────────────────────────────────────────────────────────────

const UNKNOWN_TRIAGE: TriageResult = {
  matched: false,
  category: 'unknown',
  title: 'Build failed',
  explanation:
    "The build failed, but we couldn't identify the specific cause from the logs. " +
    'Check the full build logs above for error messages — they usually point to the problem. ' +
    'If you\'re stuck, reach out via the support channel and share the logs.',
  suggestedFix: { action: 'contactSupport' },
  confidence: 'medium',
};

/**
 * Triage a set of build logs and return a plain-language explanation + fix action.
 *
 * @param logs    The raw build log string (stdout + stderr concatenated).
 * @param context Optional build context (framework, node version, package manager).
 * @returns       TriageResult — always non-null. `matched: false` when unknown.
 */
export function buildFailureTriage(logs: string, context: BuildContext = {}): TriageResult {
  if (!logs || logs.trim().length === 0) {
    return {
      matched: false,
      category: 'no-logs',
      title: 'No build output',
      explanation:
        "The build produced no output. This can happen if the build command exited immediately. " +
        "Check that your build script is correctly specified.",
      suggestedFix: null,
      confidence: 'medium',
    };
  }

  for (const rule of RULES) {
    // All patterns must match
    const allMatch = rule.patterns.every((p) => p.test(logs));
    if (!allMatch) continue;

    // No anti-patterns must match
    const antiMatch = rule.antiPatterns?.some((p) => p.test(logs)) ?? false;
    if (antiMatch) continue;

    return rule.triage(logs, context);
  }

  return UNKNOWN_TRIAGE;
}
