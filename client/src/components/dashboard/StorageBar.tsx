import { formatBytes } from '../../lib/format';

interface StorageBarProps {
  used?: number | null;
  limit?: number | null;
}

export default function StorageBar({ used, limit }: StorageBarProps) {
  const u = Number.isFinite(used) ? (used as number) : 0;
  const l = Number.isFinite(limit) ? (limit as number) : 0;
  const percent = l > 0 ? Math.min((u / l) * 100, 100) : 0;
  const isWarning = percent > 80;
  const isDanger = percent > 95;

  const barColor = isDanger
    ? 'bg-red-500'
    : isWarning
    ? 'bg-amber-500'
    : 'bg-cherry-gradient';

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-ink-mut">Storage</span>
        <span className="text-sm font-mono text-ink">
          {formatBytes(u)} <span className="text-ink-mut">/ {l > 0 ? formatBytes(l) : '—'}</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-surface-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-ink-mut">{percent.toFixed(1)}% used</p>
    </div>
  );
}
