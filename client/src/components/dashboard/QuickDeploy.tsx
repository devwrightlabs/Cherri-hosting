import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DropZone from '../deploy/DropZone';
import DeployReveal from '../deploy/DeployReveal';
import Button from '../ui/Button';
import { deployFiles, getDeployment, extractDeployError, DeployError } from '../../api/deployApi';
import { Deployment, DeploymentStatus, Project } from '../../types';

interface QuickDeployProps {
  projects: Project[];
  onDeploySuccess: (deployment: Deployment) => void;
}

export default function QuickDeploy({ projects, onDeploySuccess }: QuickDeployProps) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<File[]>([]);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    projects.length > 0 ? projects[0].id : '',
  );
  const [isDeploying, setIsDeploying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deploymentId, setDeploymentId] = useState('');
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [liveDeployment, setLiveDeployment] = useState<Deployment | null>(null);
  const [deployError, setDeployError] = useState<DeployError | null>(null);
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null);
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
        const d = await getDeployment(id);
        setDeploymentStatus(d.status);

        if (d.status === 'ACTIVE' || d.status === 'FAILED') {
          if (pollTimeoutRef.current !== null) {
            clearTimeout(pollTimeoutRef.current);
            pollTimeoutRef.current = null;
          }
          // Keep the deployment on FAILED too so the reveal can show the real
          // Pinata failure reason (failureReason) rather than a generic message.
          setLiveDeployment(d);
          if (d.status === 'ACTIVE') {
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
    setDeployError(null);
    setUploadProgress(0);
    setDeploymentStatus('PENDING');
    setLiveDeployment(null);
    setDeploymentId('');
    setDeployStartedAt(Date.now());

    try {
      const d = await deployFiles(selectedProjectId, files, filePaths, setUploadProgress);
      setDeploymentId(d.id);
      setDeploymentStatus(d.status as DeploymentStatus);
      pollStatus(d.id);
    } catch (err: unknown) {
      setDeployError(extractDeployError(err));
      setDeploymentStatus(null);
    } finally {
      setIsDeploying(false);
    }
  }, [selectedProjectId, files, filePaths, pollStatus]);

  const reset = () => {
    setFiles([]);
    setFilePaths([]);
    setDeploymentId('');
    setDeploymentStatus(null);
    setLiveDeployment(null);
    setDeployError(null);
    setUploadProgress(0);
    setDeployStartedAt(null);
  };

  const canDeploy =
    !!selectedProjectId &&
    files.length > 0 &&
    filePaths.length > 0 &&
    !isDeploying &&
    deploymentStatus === null;

  /** Whether this error kind should show a tier-upgrade call-to-action. */
  const isUpgradeError = (kind: DeployError['kind']) =>
    kind === 'storage_limit' || kind === 'upload_too_large';

  return (
    <div className="space-y-5">
      {/* Project selector */}
      {projects.length === 0 ? (
        <div className="p-5 bg-surface-800 rounded-xl border border-hairline text-center">
          <p className="text-ink-mut text-sm mb-4">
            You need a project before you can deploy.
          </p>
          <Button size="sm" onClick={() => navigate('/projects')}>
            Create a project
          </Button>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-ink-mut mb-2">Project</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            disabled={deploymentStatus !== null}
            className="w-full min-h-[48px] bg-surface-800 border border-surface-600 rounded-xl px-4 text-ink text-sm focus:outline-none focus:border-cherry-500/50 focus:ring-2 focus:ring-cherry-500 focus:ring-offset-2 focus:ring-offset-surface-950 disabled:opacity-50 transition-colors"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Drop zone — folder / ZIP aware */}
      {deploymentStatus === null && (
        <DropZone
          onFilesAccepted={(acceptedFiles, acceptedPaths) => {
            setFiles(acceptedFiles);
            setFilePaths(acceptedPaths);
          }}
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
          Deploy to IPFS
        </Button>
      )}

      {/* The reveal sequence */}
      {deploymentStatus && (
        <DeployReveal
          status={deploymentStatus}
          isUploading={isDeploying}
          uploadProgress={uploadProgress}
          deployment={liveDeployment}
          startedAt={deployStartedAt}
          onRetry={() => void handleDeploy()}
          onReset={reset}
        />
      )}

      {deployError && (
        <div
          className={`p-4 rounded-xl border text-sm ${
            isUpgradeError(deployError.kind)
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          <p>{deployError.message}</p>
          {isUpgradeError(deployError.kind) && (
            <Link
              to="/account"
              className="inline-block mt-2 text-xs font-medium underline hover:opacity-80"
            >
              See plans →
            </Link>
          )}
        </div>
      )}

      {/* ID badge for debugging */}
      {import.meta.env.DEV &&
        deploymentId &&
        deploymentStatus !== 'ACTIVE' &&
        deploymentStatus !== 'FAILED' && (
          <p className="text-xs text-ink-mut font-mono text-center">id: {deploymentId}</p>
        )}
    </div>
  );
}
