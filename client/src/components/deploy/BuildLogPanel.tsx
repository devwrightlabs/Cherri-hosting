import { useEffect, useRef } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { BuildJobInfo, BuildStatus } from '../../api/deployApi';

interface BuildLogPanelProps {
  info: BuildJobInfo;
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

export default function BuildLogPanel({ info, onReset }: BuildLogPanelProps) {
  const logRef = useRef<HTMLPreElement | null>(null);
  const failed = info.status === 'FAILED';
  const running =
    info.status === 'QUEUED' ||
    info.status === 'INSTALLING' ||
    info.status === 'BUILDING' ||
    info.status === 'COLLECTING';

  // Keep the log scrolled to the newest line as it streams in.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [info.logs]);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {running && (
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse flex-shrink-0" />
          )}
          {failed && <span className="text-red-400 flex-shrink-0">✖</span>}
          {info.status === 'DONE' && (
            <span className="text-emerald-400 flex-shrink-0">✓</span>
          )}
          <h2 className="text-sm font-semibold text-ink truncate">
            {STATUS_LABEL[info.status]}
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-ink-mut font-mono flex-shrink-0">
          {info.packageManager}
        </span>
      </div>

      <p className="text-ink-mut text-xs leading-relaxed mb-3">
        Cherri is building your app on the server — these are the real build logs.
        Building runs your project's own scripts, so it can take a minute.
      </p>

      <pre
        ref={logRef}
        className="bg-black/60 border border-hairline rounded-lg p-3 text-[11px] leading-relaxed text-surface-300 font-mono overflow-auto max-h-72 whitespace-pre-wrap break-words"
      >
        {info.logs || 'Starting…'}
      </pre>

      {failed && (
        <div className="mt-3 space-y-3">
          <p className="text-red-400 text-xs">
            {info.error ?? 'The build failed. Check the log above for the real error.'}
          </p>
          <Button size="sm" className="w-full justify-center" onClick={onReset}>
            Start over
          </Button>
        </div>
      )}
    </Card>
  );
}
