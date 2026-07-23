import { Deployment } from '../../types';
import Badge from '../ui/Badge';
import Card from '../ui/Card';

interface DeploymentCardProps {
  deployment: Deployment;
}

const statusVariant: Record<
  string,
  'success' | 'warning' | 'error' | 'info' | 'default'
> = {
  ACTIVE: 'success',
  PENDING: 'warning',
  UPLOADING: 'info',
  PINNING: 'info',
  FAILED: 'error',
};

/** Plain-language status labels — never show raw enum values to users. */
const statusLabel: Record<string, string> = {
  ACTIVE: 'Published',
  PENDING: 'Queued',
  UPLOADING: 'Uploading',
  PINNING: 'Publishing',
  FAILED: 'Failed',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function DeploymentCard({ deployment }: DeploymentCardProps) {
  const variant = statusVariant[deployment.status] ?? 'default';

  return (
    <Card className="animate-fade-in">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={variant} dot>
            {statusLabel[deployment.status] ?? deployment.status}
          </Badge>
          <span className="text-ink-mut text-xs">
            {new Date(deployment.createdAt).toLocaleDateString()}
          </span>
        </div>
        <span className="text-ink-mut text-xs font-mono shrink-0">
          {formatBytes(deployment.size)}
        </span>
      </div>

      {deployment.cid && (
        <p className="text-xs text-ink-mut truncate mb-3">
          Permanent address: <span className="font-mono">{deployment.cid}</span>
        </p>
      )}

      {deployment.gateway && (
        <a
          href={deployment.gateway}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-cherry-300 hover:text-cherry-200 transition-colors max-w-full"
        >
          <span className="truncate">{deployment.gateway}</span>
          <span className="shrink-0">↗</span>
        </a>
      )}
    </Card>
  );
}
