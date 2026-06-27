/**
 * Plain-English build-failure diagnosis.
 *
 * Pure + deterministic: given a failed build's high-level error and its raw
 * streamed logs, return a short, human headline + advice to show ABOVE the real
 * log. This NEVER hides or rewrites the log — it's a friendlier summary layered
 * on top. When we can't recognise the failure we still return a generic
 * diagnosis (the log is always shown beneath it).
 *
 * Two rules keep us from mislabelling failures:
 *   1. The engine's high-level `error` names the PHASE ("Dependency install
 *      failed…" vs "Build failed…"). We trust it to tell install from build.
 *   2. We NEVER match the generic `npm error code` / `ELIFECYCLE` lifecycle
 *      footer — it prints on essentially every failed npm build and would mask
 *      the real, more specific cause (a TS error, a missing module, etc).
 */

export interface BuildFailureInfo {
  /** High-level failure message from the build engine (job.error). */
  error?: string | null;
  /** Raw streamed build logs (stdout + stderr). */
  logs?: string | null;
}

export interface BuildDiagnosis {
  /** Short, friendly heading — what went wrong, in one line. */
  headline: string;
  /** One or two sentences of actionable guidance. */
  advice: string;
}

/**
 * Diagnose a failed build. Returns `null` only when there's nothing to diagnose
 * (no error text and no logs) — otherwise always returns at least a generic
 * diagnosis so the failure UI has a headline to show above the log.
 */
export function diagnoseBuildFailure(info: BuildFailureInfo): BuildDiagnosis | null {
  const error = (info.error ?? '').trim();
  const logs = (info.logs ?? '').trim();
  if (!error && !logs) return null;

  // Search the high-level error and the raw log together. Order matters.
  const hay = `${error}\n${logs}`;
  const has = (re: RegExp): boolean => re.test(hay);

  // Phase marker from the engine's own error message — the reliable way to tell
  // an install-phase failure from a build-phase one.
  const installPhase = /dependency install/i.test(error);

  // 1. Out of memory — phase-independent; can masquerade as a generic failure.
  if (has(/out of memory|JavaScript heap|FATAL ERROR:.*heap|ENOMEM|\bKilled\b|SIGKILL/i)) {
    return {
      headline: 'The build ran out of memory',
      advice:
        'Your build needed more memory than Cherri allows. Try trimming large dependencies or assets, or build the site on your computer and upload the finished folder (usually dist, build, or out).',
    };
  }

  // 2. Timed out — install vs build phrasing from the phase marker.
  if (has(/timed out|ETIMEDOUT|timeout/i)) {
    const install = installPhase || /install timed out/i.test(hay);
    return {
      headline: install ? 'Installing dependencies took too long' : 'The build took too long',
      advice:
        'Cherri stops builds that run past its time limit. Reduce heavy dependencies or build steps, or build the site locally and upload the finished folder.',
    };
  }

  // 3. Dependency install failed — ONLY on the explicit install phase or on
  //    real resolver/registry errors. We deliberately do NOT match the generic
  //    `npm error code` footer, which also follows a failed BUILD.
  if (
    installPhase ||
    has(/ERESOLVE|could not resolve dependency|peer dep|EBADENGINE|ENOTFOUND|404 Not Found.*(npm|registry)|registry\.npmjs/i)
  ) {
    return {
      headline: 'Installing dependencies failed',
      advice:
        "Cherri couldn't install your project's packages. Check that package.json and your lockfile are valid and every dependency exists. The first error in the log below is usually the cause.",
    };
  }

  // 4. TypeScript type errors.
  if (has(/error TS\d+|Found \d+ error|Type error:/i)) {
    return {
      headline: 'TypeScript found type errors',
      advice:
        'Your build failed type-checking. Fix the TypeScript errors listed in the log below, or build the site locally (where they may be warnings) and upload the finished folder.',
    };
  }

  // 5. Missing module / unresolved import (build phase — bundlers, not npm).
  if (has(/Cannot find module|Could not resolve|Module not found|Failed to resolve import/i)) {
    return {
      headline: "A file or package couldn't be found",
      advice:
        "The build referenced something that isn't there — often a missing dependency or a wrong import path. Check the path shown in the log and make sure it's installed and included in your upload.",
    };
  }

  // 6. Built, but no recognisable output folder.
  if (has(/no recognisable output folder/i)) {
    return {
      headline: "The build didn't produce a website",
      advice:
        "Your build finished but Cherri couldn't find a static output folder (it looks for dist, build, out, or _site). Point your build at one of those, or upload a folder that already contains index.html.",
    };
  }

  // 7. Output folder empty.
  if (has(/output folder .* is empty/i)) {
    return {
      headline: 'The build produced an empty folder',
      advice:
        'Your build ran but its output folder had no files. Double-check the build command actually writes your site, then try again.',
    };
  }

  // 8. Output too large / too many files.
  if (has(/more than .* files|exceeds the 1 GB|output exceeds/i)) {
    return {
      headline: 'The build output is too large',
      advice:
        "Your built site is over Cherri's size limits. Remove large files from the output (or split the site up), then try again.",
    };
  }

  // 9. Generic fallback — we know it failed but not precisely why.
  return {
    headline: 'The build failed',
    advice:
      'Something went wrong during the build. The full log is below — the first line mentioning "error" is usually the cause.',
  };
}
