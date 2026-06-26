import Button from '../ui/Button';
import type { StageResult } from '../../api/deployApi';

interface StagePanelProps {
  result: StageResult;
  /** Absolute URL of the sandboxed preview, or null when unavailable. */
  previewSrc: string | null;
  /** Discard this stage and return to the drop zone. */
  onCancel: () => void;
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

export default function StagePanel({ result, previewSrc, onCancel }: StagePanelProps) {
  // ── Halt: not a deployable static site (e.g. needs a local build first) ──────
  if (!result.deployable) {
    return (
      <div className="rounded-xl bg-surface-800 border border-amber-500/30 p-4">
        <div className="flex items-start gap-3">
          <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-500/15 text-amber-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink font-display">Not ready to deploy</h3>
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

        <Button variant="secondary" className="w-full justify-center mt-4" onClick={onCancel}>
          Upload different files
        </Button>
      </div>
    );
  }

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
        <CheckRow
          ok={!!result.hasValidationKey}
          okText="Pi validation key found (validation-key.txt)"
          warnText="No validation-key.txt at your site root"
          detail={
            result.hasValidationKey
              ? undefined
              : 'Pi Network needs this file to verify .pi domain ownership. You can still deploy now and add it later — your .pi domain just won’t verify until it’s present.'
          }
        />
        <PiSdkRow sdk={result.sdk} />
      </div>

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
