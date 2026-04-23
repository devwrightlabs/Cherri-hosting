
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={variant}>{deployment.status}</Badge>
            <span className="text-surface-500 text-xs">
              {new Date(deployment.createdAt).toLocaleDateString()}
            </span>
          </div>

          {deployment.cid && (
            <p className="font-mono text-xs text-surface-400 truncate mb-2">
              ipfs://{deployment.cid}
            </p>
          )}

          {deployment.gateway && (
            <a
              href={deployment.gateway}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cherry-400 hover:text-cherry-300 text-sm truncate block transition-colors"
            >
              {deployment.gateway}
            </a>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-surface-400 text-xs">{formatBytes(deployment.size)}</p>
          {deployment.status === 'ACTIVE' && deployment.gateway && (
            <a
              href={deployment.gateway}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-cherry-500 hover:text-cherry-400 transition-colors"
            >
              Visit ↗
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}
