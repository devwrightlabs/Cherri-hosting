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
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-surface-400">
        <span>Storage used</span>
        <span>
          {formatBytes(u)} / {l > 0 ? formatBytes(l) : '—'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-surface-500">{percent.toFixed(1)}% used</p>
    </div>
  );
}
