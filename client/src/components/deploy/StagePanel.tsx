import Button from '../ui/Button';
import type { StageResult } from '../../api/deployApi';

interface StagePanelProps {
  result: StageResult;
  /** Absolute URL of the sandboxed preview, or null when unavailable. */
  previewSrc: string | null;
  isPinning: boolean;
  onPin: () => void;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function PiSdkBadge({ sdk }: { sdk: StageResult['sdk'] }) {
  if (!sdk) return null;

  if (sdk.ready) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-live/15 border border-live/30 px-2.5 py-1 text-[11px] font-medium text-live">
        <span className="w-1.5 h-1.5 rounded-full bg-live" />
        Pi SDK ready
      </span>
    );
  }

  const hint = sdk.scriptDetected
    ? 'Pi SDK loaded · no Pi.init() call found'
    : 'No Pi SDK detected';

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-[11px] font-medium text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      {hint}
    </span>
  );
}

export default function StagePanel({
  result,
  previewSrc,
  isPinning,
  onPin,
  onCancel,
}: StagePanelProps) {
  // ── Halt: not a deployable static site (e.g. needs a local build first) ──────
  if (!result.deployable) {
    return (
      <div className="rounded-2xl bg-surface-900 border border-amber-500/30 p-5">
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
          <div className="mt-4 rounded-lg bg-surface-800 border border-hairline p-3">
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
                <li className="text-[11px] text-ink-mut">
                  + {result.fileCount - 12} more
                </li>
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

  // ── Deployable: sandboxed preview + confirm ──────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-surface-900 border border-hairline overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hairline">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-ink">Preview</span>
            <span className="font-mono text-[11px] text-ink-mut truncate">
              {result.entryPoint}
            </span>
          </div>
          <PiSdkBadge sdk={result.sdk} />
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
              style={{ height: 420, border: 0 }}
            />
          ) : (
            <div className="h-[420px] flex items-center justify-center text-ink-mut text-sm">
              Preview unavailable
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-surface-900 border border-hairline p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-mut">Entry</span>
          <span className="font-mono text-xs text-ink truncate">{result.entryPoint}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm mt-2">
          <span className="text-ink-mut">Files</span>
          <span className="text-ink">
            {result.fileCount}{' '}
            <span className="text-ink-mut">· {formatBytes(result.totalBytes)}</span>
          </span>
        </div>
        <p className="text-ink-mut text-xs mt-3">
          Looks right? Pinning publishes it to IPFS permanently — it can't be taken down.
        </p>
      </div>

      <div className="space-y-2">
        <Button
          size="lg"
          className="w-full justify-center"
          isLoading={isPinning}
          onClick={onPin}
        >
          Deploy to IPFS
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-center"
          disabled={isPinning}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
