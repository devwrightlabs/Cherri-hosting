import { useState } from 'react';
import Button from '../ui/Button';
import {
  addStagePiSdk,
  extractDeployError,
  type StageHelperResult,
  type StageResult,
} from '../../api/deployApi';
import { usePiEnv, type PiEnv } from '../../lib/piEnv';
import { PI_DEVELOPER_PORTAL_URL } from '../../lib/constants';
import { openExternal } from '../../lib/openExternal';

interface StagePanelProps {
  result: StageResult;
  /** Absolute URL of the sandboxed preview, or null when unavailable. */
  previewSrc: string | null;
  /** Discard this stage and return to the drop zone. */
  onCancel: () => void;
  /**
   * Proceed past an OVERRIDABLE shape warning (e.g. monorepo) — re-submits with
   * acknowledgeWarnings. Only offered when `result.overridable` is true.
   */
  onProceed?: () => void;
  /** Merge refreshed verification facts after a "Configure for Pi" helper runs. */
  onHelperUpdate?: (patch: Partial<StageResult>) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function CheckRow({
  ok,
  okText,
  warnText,
  detail,
}: {
  ok: boolean;
  okText: string;
  warnText: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full ${
          ok ? 'bg-live/15 text-live' : 'bg-amber-500/15 text-amber-400'
        }`}
      >
        {ok ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        )}
      </span>
      <div className="min-w-0">
        <p className={`text-sm ${ok ? 'text-ink' : 'text-amber-400'}`}>
          {ok ? okText : warnText}
        </p>
        {detail && <p className="text-ink-mut text-xs mt-0.5 leading-relaxed">{detail}</p>}
      </div>
    </div>
  );
}

function PiSdkRow({ sdk }: { sdk: StageResult['sdk'] }) {
  if (!sdk) {
    return (
      <CheckRow
        ok={false}
        okText=""
        warnText="No Pi SDK detected"
        detail="If this is a Pi app, load the Pi SDK and call Pi.init() so it works inside Pi Browser."
      />
    );
  }
  if (sdk.ready) {
    return <CheckRow ok okText="Pi SDK ready" warnText="" />;
  }
  return (
    <CheckRow
      ok={false}
      okText=""
      warnText={sdk.scriptDetected ? 'Pi SDK loaded · no Pi.init() call found' : 'No Pi SDK detected'}
      detail={
        sdk.scriptDetected
          ? 'The SDK script is present but Pi.init() was not detected — Pi features may not initialise.'
          : 'If this is a Pi app, load the Pi SDK and call Pi.init() so it works inside Pi Browser.'
      }
    />
  );
}

// ─── "Configure for Pi" helpers ───────────────────────────────────────────────

/**
 * One-tap Pi SDK helper. Detect-before-inject is enforced server-side: if the
 * site already loads the SDK or calls Pi.init anywhere, nothing is touched.
 * The sandbox flag is an explicit choice about the USER'S app (which network
 * THEIR app talks to), defaulting to the current TEST/LIVE setting.
 */
function PiSdkHelper({
  stageId,
  sdk,
  onDone,
}: {
  stageId: string;
  sdk: StageResult['sdk'];
  onDone: (facts: StageHelperResult) => void;
}) {
  const currentEnv = usePiEnv();
  const [env, setEnv] = useState<PiEnv>(currentEnv);
  const [error, setError] = useState('');
  const [isInjecting, setIsInjecting] = useState(false);
  const [alreadyPresent, setAlreadyPresent] = useState(false);

  const detected = !!sdk && (sdk.scriptDetected || sdk.initDetected);

  // Site already has the SDK (fully or partially) — never double-inject.
  if (detected && !sdk?.ready) {
    return (
      <p className="ml-7 mt-1 text-ink-mut text-[11px] leading-relaxed">
        Your site already references the Pi SDK, so Cherri won&rsquo;t add it again (injecting
        twice could break Pi features). Adjust it in your source code if needed.
      </p>
    );
  }
  if (detected) return null;

  const inject = async () => {
    setIsInjecting(true);
    setError('');
    try {
      const res = await addStagePiSdk(stageId, env);
      if (res.alreadyPresent) setAlreadyPresent(true);
      onDone(res);
    } catch (err: unknown) {
      setError(extractDeployError(err).message);
    } finally {
      setIsInjecting(false);
    }
  };

  if (alreadyPresent) {
    return (
      <p className="ml-7 mt-1 text-ink-mut text-[11px] leading-relaxed">
        ✓ Pi SDK already present — nothing was added.
      </p>
    );
  }

  return (
    <div className="ml-7 mt-2 rounded-lg bg-surface-900 border border-hairline p-3">
      <p className="text-xs font-medium text-ink">Add the Pi SDK for me</p>
      <p className="text-ink-mut text-[11px] mt-1 leading-relaxed">
        Cherri adds the official SDK script and a{' '}
        <span className="font-mono">Pi.init()</span> call to your site&rsquo;s{' '}
        <span className="font-mono">&lt;head&gt;</span>. Pick which Pi network{' '}
        <em>your app</em> should talk to:
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pi network for your app">
        {(
          [
            { value: 'testnet' as PiEnv, label: 'Testnet', hint: 'sandbox · Test-Pi' },
            { value: 'mainnet' as PiEnv, label: 'Mainnet', hint: 'real Pi' },
          ]
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={env === opt.value}
            onClick={() => setEnv(opt.value)}
            className={`min-h-[48px] rounded-lg border px-3 py-2 text-left transition-colors ${
              env === opt.value
                ? 'border-cherry-500/50 bg-cherry-500/10 text-ink'
                : 'border-surface-600 bg-surface-950 text-ink-mut'
            }`}
          >
            <span className="block text-xs font-medium">{opt.label}</span>
            <span className="block text-[10px] text-ink-mut mt-0.5">{opt.hint}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-red-400 text-xs mt-2 leading-relaxed">{error}</p>}
      <Button
        size="md"
        className="w-full justify-center mt-2"
        isLoading={isInjecting}
        onClick={() => void inject()}
      >
        Add Pi SDK to my site
      </Button>
      <p className="text-ink-mut text-[10px] mt-2 leading-relaxed">
        Only added if your site doesn&rsquo;t load it already — Cherri checks first and never
        injects twice.
      </p>
    </div>
  );
}

/** Plain-language "get your app Pi-ready" walkthrough. Informational only. */
function PiSetupChecklist() {
  const steps = [
    <>
      Using Pi login or payments? Make sure the <span className="text-ink">Pi SDK</span> is in
      your app — add it below with one tap if it isn&rsquo;t.
    </>,
    <>
      Deploy in step 2 to publish your site to IPFS. You&rsquo;ll get a working{' '}
      <span className="text-ink">.pie gateway link</span>.
    </>,
    <>
      Take that link to{' '}
      <button
        type="button"
        onClick={() => openExternal(PI_DEVELOPER_PORTAL_URL)}
        className="text-cherry-300 underline underline-offset-2"
      >
        Pi&rsquo;s developer portal
      </button>{' '}
      and finish your app verification there — that last step happens on Pi&rsquo;s side.
    </>,
  ];
  return (
    <div className="rounded-xl bg-surface-800 border border-hairline p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-mut">Getting Pi-ready</p>
      <p className="text-ink-mut text-xs mt-1.5 leading-relaxed">
        None of this blocks your deploy — it&rsquo;s the path to a verified Pi app.
      </p>
      <ol className="mt-3 space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-900 border border-hairline text-[10px] font-semibold text-ink-mut">
              {i + 1}
            </span>
            <p className="text-ink-mut text-xs leading-relaxed min-w-0">{step}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function StagePanel({
  result,
  previewSrc,
  onCancel,
  onProceed,
  onHelperUpdate,
}: StagePanelProps) {
  // Bumped after a helper mutates the stage so the sandboxed preview iframe
  // reloads and shows the change (the preview is served with no-store).
  const [previewNonce, setPreviewNonce] = useState(0);

  // ── Halt: not a deployable static site (e.g. needs a local build first) ──────
  if (!result.deployable) {
    // Overridable = a WARNING the user may build past (e.g. monorepo). A plain
    // halt (backend, nothing to build) cannot be overridden.
    const overridable = !!result.overridable && !!onProceed;
    const accent = overridable ? 'amber' : 'red';
    return (
      <div
        className={`rounded-xl bg-surface-800 border p-4 ${
          overridable ? 'border-amber-500/30' : 'border-red-500/30'
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full ${
              accent === 'amber' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink font-display">
              {overridable ? 'Heads up before we build' : 'Not ready to deploy'}
            </h3>
            <p className="text-ink-mut text-sm mt-1 break-words">{result.haltReason}</p>
          </div>
        </div>

        {result.fileTree.length > 0 && (
          <div className="mt-4 rounded-lg bg-surface-900 border border-hairline p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-mut mb-2">
              We received {result.fileCount} file{result.fileCount === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {result.fileTree.slice(0, 12).map((f) => (
                <li key={f.path} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-ink truncate">{f.path}</span>
                  <span className="font-mono text-[11px] text-ink-mut shrink-0">
                    {formatBytes(f.size)}
                  </span>
                </li>
              ))}
              {result.fileTree.length > 12 && (
                <li className="text-[11px] text-ink-mut">+ {result.fileCount - 12} more</li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {overridable && (
            <Button className="w-full justify-center" onClick={onProceed}>
              Build anyway
            </Button>
          )}
          <Button variant="secondary" className="w-full justify-center" onClick={onCancel}>
            Upload different files
          </Button>
        </div>
      </div>
    );
  }

  const applyFacts = (facts: StageHelperResult) => {
    onHelperUpdate?.({
      sdk: facts.sdk,
      fileCount: facts.fileCount,
      totalBytes: facts.totalBytes,
    });
    setPreviewNonce((n) => n + 1);
  };

  // ── Deployable: verification checklist + sandboxed preview ────────────────────
  return (
    <div className="space-y-4">
      {/* What we checked */}
      <div className="rounded-xl bg-surface-800 border border-hairline p-4 space-y-3">
        <p className="text-[11px] uppercase tracking-wide text-ink-mut">Verification</p>
        <CheckRow
          ok
          okText="Build succeeded — your site is a deployable static bundle"
          warnText=""
        />
        <div>
          <PiSdkRow sdk={result.sdk} />
          {result.stageId && (
            <PiSdkHelper stageId={result.stageId} sdk={result.sdk} onDone={applyFacts} />
          )}
        </div>
      </div>

      {/* Plain-language Pi setup walkthrough — never blocks anything */}
      <PiSetupChecklist />

      {/* Live sandboxed preview */}
      <div className="rounded-xl bg-surface-800 border border-hairline overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-ink">Preview</span>
            <span className="font-mono text-[11px] text-ink-mut truncate">{result.entryPoint}</span>
          </div>
        </div>

        <div className="bg-surface-950">
          {previewSrc ? (
            <iframe
              key={`${previewSrc}#${previewNonce}`}
              title="Site preview"
              src={previewSrc}
              // Opaque-origin sandbox: scripts + forms run, but the frame gets
              // NO same-origin access — it cannot read tokens or call our API.
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              className="w-full block bg-white"
              style={{ height: 380, border: 0 }}
            />
          ) : (
            <div className="h-[380px] flex items-center justify-center text-ink-mut text-sm">
              Preview unavailable
            </div>
          )}
        </div>
      </div>

      {previewSrc && (
        <Button
          variant="secondary"
          className="w-full justify-center"
          onClick={() => window.open(previewSrc, '_blank', 'noopener,noreferrer')}
        >
          Open full preview ↗
        </Button>
      )}

      {/* Stage facts */}
      <div className="rounded-xl bg-surface-800 border border-hairline p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-mut">Entry</span>
          <span className="font-mono text-xs text-ink truncate">{result.entryPoint}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm mt-2">
          <span className="text-ink-mut">Files</span>
          <span className="text-ink">
            {result.fileCount} <span className="text-ink-mut">· {formatBytes(result.totalBytes)}</span>
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-900 border border-hairline px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <p className="text-ink-mut text-xs">
            Not live yet — this preview runs in a sandbox. Deploy it in step 2 to publish to IPFS.
          </p>
        </div>
      </div>

      <Button variant="ghost" className="w-full justify-center" onClick={onCancel}>
        Upload different files
      </Button>
    </div>
  );
}
