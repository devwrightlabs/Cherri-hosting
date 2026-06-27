import { useEffect, useRef } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { BuildJobInfo, BuildStatus } from '../../api/deployApi';
import { diagnoseBuildFailure } from '../../lib/buildDiagnosis';

interface BuildLogPanelProps {
  info: BuildJobInfo;
  /** Re-run the same upload/import after a failure. */
  onRetry?: () => void;
  /** Start over — discard this build and return to the drop zone. */
  onReset: () => void;
}

const STATUS_LABEL: Record<BuildStatus, string> = {
  QUEUED: 'Queued…',
  INSTALLING: 'Installing dependencies…',
  BUILDING: 'Building…',
  COLLECTING: 'Collecting output…',
  DONE: 'Build complete',
  FAILED: 'Build failed',
};

export default function BuildLogPanel({ info, onRetry, onReset }: BuildLogPanelProps) {
  const logRef = useRef<HTMLPreElement | null>(null);
  const failed = info.status === 'FAILED';
  const running =
    info.status === 'QUEUED' ||
    info.status === 'INSTALLING' ||
    info.status === 'BUILDING' ||
    info.status === 'COLLECTING';

  // Keep the log scrolled to the newest line as it streams in (running only —
  // on failure the log lives in a collapsible block below the diagnosis).
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [info.logs]);

  const diagnosis = failed ? diagnoseBuildFailure(info) : null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {running && (
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse flex-shrink-0" />
          )}
          {failed && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
          {info.status === 'DONE' && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
          )}
          <h2 className="text-sm font-semibold text-ink truncate">
            {STATUS_LABEL[info.status]}
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-ink-mut font-mono flex-shrink-0">
          {info.packageManager}
        </span>
      </div>

      {failed ? (
        <div className="space-y-3">
          {/* Plain-English diagnosis ABOVE the raw log — friendlier summary, not
              a replacement. The real log stays one tap away below. */}
          {diagnosis && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5">
              <p className="text-red-300 text-sm font-semibold leading-snug">
                {diagnosis.headline}
              </p>
              <p className="text-ink-mut text-xs leading-relaxed mt-1.5">{diagnosis.advice}</p>
            </div>
          )}

          <details open className="group">
            <summary className="cursor-pointer select-none text-xs text-ink-mut hover:text-ink transition-colors">
              Build log
            </summary>
            <pre
              ref={logRef}
              className="mt-2 bg-black/60 border border-hairline rounded-xl p-3.5 text-[11px] leading-relaxed text-ink-mut font-mono overflow-auto max-h-72 whitespace-pre-wrap break-words"
            >
              {info.logs || info.error || 'The build failed before producing any output.'}
            </pre>
          </details>

          <div className="space-y-2 pt-1">
            {onRetry && (
              <Button className="w-full justify-center" onClick={onRetry}>
                Try again
              </Button>
            )}
            <Button variant="secondary" className="w-full justify-center" onClick={onReset}>
              Upload a different folder
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-ink-mut text-xs leading-relaxed mb-3">
            Cherri is building your app on the server — these are the real build logs.
            Building runs your project's own scripts, so it can take a minute.
          </p>

          <pre
            ref={logRef}
            className="bg-black/60 border border-hairline rounded-xl p-3.5 text-[11px] leading-relaxed text-ink-mut font-mono overflow-auto max-h-72 whitespace-pre-wrap break-words"
          >
            {info.logs || 'Starting…'}
          </pre>
        </>
      )}
    </Card>
  );
}
