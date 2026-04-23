interface StorageBarProps {
  used: number;
  limit: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function StorageBar({ used, limit }: StorageBarProps) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
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
          {formatBytes(used)} / {formatBytes(limit)}
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
