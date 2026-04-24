import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import DropZone from '../deploy/DropZone';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { deploymentsApi } from '../../lib/api';
import { Deployment, DeploymentStatus, Project } from '../../types';

interface QuickDeployProps {
  projects: Project[];
  onDeploySuccess: (deployment: Deployment) => void;
}

const STATUS_LABELS: Record<DeploymentStatus, string> = {
  PENDING: 'Preparing upload…',
  UPLOADING: 'Uploading to IPFS…',
  PINNING: 'Pinning on IPFS network…',
  ACTIVE: 'Deployment live! 🎉',
  FAILED: 'Deployment failed',
};

const STATUS_VARIANTS: Record<DeploymentStatus, 'default' | 'warning' | 'info' | 'success' | 'error'> = {
  PENDING: 'warning',
  UPLOADING: 'info',
  PINNING: 'info',
  ACTIVE: 'success',
  FAILED: 'error',
};

export default function QuickDeploy({ projects, onDeploySuccess }: QuickDeployProps) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    projects.length > 0 ? projects[0].id : '',
  );
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentId, setDeploymentId] = useState('');
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [liveDeployment, setLiveDeployment] = useState<Deployment | null>(null);
  const [error, setError] = useState('');
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear polling timeout when component unmounts
  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current !== null) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, []);

  // Poll deployment status until terminal
  const pollStatus = useCallback((id: string) => {
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }

    const poll = async () => {
      try {
        const res = await deploymentsApi.get(id);
        const d = (res.data as { deployment: Deployment }).deployment;
        setDeploymentStatus(d.status);

        if (d.status === 'ACTIVE' || d.status === 'FAILED') {
          if (pollTimeoutRef.current !== null) {
            clearTimeout(pollTimeoutRef.current);
            pollTimeoutRef.current = null;
          }
          if (d.status === 'ACTIVE') {
            setLiveDeployment(d);
            onDeploySuccess(d);
          }
          return;
        }
      } catch {
        // ignore transient polling errors
      }

      pollTimeoutRef.current = setTimeout(() => {
        void poll();
      }, 2000);
    };

    void poll();
  }, [onDeploySuccess]);

  const handleDeploy = useCallback(async () => {
    if (!selectedProjectId || files.length === 0) return;
    setIsDeploying(true);
    setError('');
    setDeploymentStatus('PENDING');
    setLiveDeployment(null);
    setDeploymentId('');

    try {
      const formData = new FormData();
      formData.append('projectId', selectedProjectId);
      files.forEach((f) => formData.append('files', f, f.name));

      const res = await deploymentsApi.deploy(formData);
      const d = (res.data as { deployment: { id: string; status: DeploymentStatus } }).deployment;
      setDeploymentId(d.id);
      setDeploymentStatus(d.status);
      pollStatus(d.id);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Deployment failed. Please try again.';
      setError(msg);
      setDeploymentStatus(null);
    } finally {
      setIsDeploying(false);
    }
  }, [selectedProjectId, files, pollStatus]);

  const reset = () => {
    setFiles([]);
    setDeploymentId('');
    setDeploymentStatus(null);
    setLiveDeployment(null);
    setError('');
  };

  const canDeploy = selectedProjectId && files.length > 0 && !isDeploying && deploymentStatus === null;

  return (
    <div className="space-y-5">
      {/* Project selector */}
      {projects.length === 0 ? (
        <div className="p-4 bg-surface-800/60 rounded-lg border border-surface-700/50 text-center">
          <p className="text-surface-400 text-sm mb-3">
            You need a project before you can deploy.
          </p>
          <Button size="sm" onClick={() => navigate('/projects')}>
            Create a project
          </Button>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-surface-400 mb-1.5 uppercase tracking-wider">
            Project
          </label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            disabled={deploymentStatus !== null}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cherry-500 disabled:opacity-50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Drop zone — the centerpiece */}
      {deploymentStatus === null && (
        <DropZone
          onFilesAccepted={setFiles}
          accept={{ 'application/zip': ['.zip'], 'application/octet-stream': [] }}
        />
      )}

      {/* Deploy button */}
      {deploymentStatus === null && (
        <Button
          size="lg"
          className="w-full justify-center"
          disabled={!canDeploy}
          isLoading={isDeploying}
          onClick={() => void handleDeploy()}
        >
          🚀 Deploy to IPFS
        </Button>
      )}

      {/* Progress / result */}
      {deploymentStatus && (
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-3">
            {deploymentStatus !== 'ACTIVE' && deploymentStatus !== 'FAILED' ? (
              <Spinner size="sm" />
            ) : deploymentStatus === 'ACTIVE' ? (
              <span className="text-xl">✅</span>
            ) : (
              <span className="text-xl">❌</span>
            )}
            <div>
              <Badge variant={STATUS_VARIANTS[deploymentStatus]}>
                {deploymentStatus}
              </Badge>
              <p className="text-surface-400 text-sm mt-0.5">
                {STATUS_LABELS[deploymentStatus]}
              </p>
            </div>
          </div>

          {liveDeployment?.status === 'ACTIVE' && (
            <div className="mt-4 pt-4 border-t border-surface-700/50 space-y-1.5 font-mono text-xs">
              <p>
                <span className="text-surface-500">CID: </span>
                <span className="text-cherry-400">{liveDeployment.cid}</span>
              </p>
              {liveDeployment.gateway && (
                <p>
                  <span className="text-surface-500">URL: </span>
                  <a
                    href={liveDeployment.gateway}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cherry-400 hover:text-cherry-300 underline"
                  >
                    {liveDeployment.gateway}
                  </a>
                </p>
              )}
              <div className="flex gap-2 pt-2 font-sans">
                <a href={liveDeployment.gateway} target="_blank" rel="noopener noreferrer">
                  <Button size="sm">Open site ↗</Button>
                </a>
                <Button size="sm" variant="secondary" onClick={reset}>
                  Deploy another
                </Button>
              </div>
            </div>
          )}

          {deploymentStatus === 'FAILED' && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => void handleDeploy()} isLoading={isDeploying}>
                Retry
              </Button>
              <Button size="sm" variant="secondary" onClick={reset}>
                Reset
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* ID badge for debugging */}
      {import.meta.env.DEV &&
        deploymentId &&
        deploymentStatus !== 'ACTIVE' &&
        deploymentStatus !== 'FAILED' && (
          <p className="text-xs text-surface-600 font-mono text-center">
            id: {deploymentId}
          </p>
        )}
    </div>
  );
}
