import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DropZone from '../components/deploy/DropZone';
import DeployReveal from '../components/deploy/DeployReveal';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { projectsApi } from '../lib/api';
import {
  deployFiles,
  getDeployment,
  extractDeployError,
  DeployError,
} from '../api/deployApi';
import { Project, Deployment, DeploymentStatus } from '../types';

export default function Deploy() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    searchParams.get('projectId') ?? '',
  );
  const [files, setFiles] = useState<File[]>([]);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [liveDeployment, setLiveDeployment] = useState<Deployment | null>(null);
  const [deployError, setDeployError] = useState<DeployError | null>(null);
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    projectsApi
      .list()
      .then((res) => {
        const p = (res.data as { projects: Project[] }).projects;
        setProjects(p);
        setSelectedProjectId((prev) => prev || (p.length > 0 ? p[0].id : ''));
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current !== null) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const pollStatus = useCallback((id: string) => {
    if (pollTimeoutRef.current !== null) clearTimeout(pollTimeoutRef.current);

    const poll = async () => {
      try {
        const d = await getDeployment(id);
        setDeploymentStatus(d.status);
        if (d.status === 'ACTIVE' || d.status === 'FAILED') {
          if (d.status === 'ACTIVE') setLiveDeployment(d);
          if (pollTimeoutRef.current !== null) clearTimeout(pollTimeoutRef.current);
          return;
        }
      } catch {
        // ignore transient polling errors
      }
      pollTimeoutRef.current = setTimeout(() => void poll(), 2000);
    };

    void poll();
  }, []);

  const handleDeploy = useCallback(async () => {
    if (!selectedProjectId || files.length === 0 || filePaths.length === 0) return;
    setIsDeploying(true);
    setDeployError(null);
    setUploadProgress(0);
    setDeploymentStatus('PENDING');
    setLiveDeployment(null);
    setDeployStartedAt(Date.now());

    try {
      const d = await deployFiles(selectedProjectId, files, filePaths, setUploadProgress);
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
    setDeploymentStatus(null);
    setLiveDeployment(null);
    setDeployError(null);
    setUploadProgress(0);
    setDeployStartedAt(null);
  };

  const canDeploy =
    !!selectedProjectId && files.length > 0 && filePaths.length > 0 && !isDeploying;
  const isUpgradeError = (kind: DeployError['kind']) =>
    kind === 'storage_limit' || kind === 'upload_too_large';

  return (
    <AppShell>
      <div>
        <h1 className="text-xl font-bold text-ink font-display tracking-tight">Deploy</h1>
        <p className="text-ink-mut text-sm mt-0.5">Upload your static site to IPFS.</p>
      </div>

      {/* Project selector */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3">Project</h2>
        {projects.length === 0 ? (
          <p className="text-ink-mut text-sm">
            You have no projects yet.{' '}
            <button onClick={() => navigate('/projects')} className="text-gold underline">
              Create one first.
            </button>
          </p>
        ) : (
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            disabled={deploymentStatus !== null}
            className="w-full bg-surface-800 border border-hairline rounded-lg px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-gold disabled:opacity-50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </Card>

      {/* Drop zone */}
      {deploymentStatus === null && (
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-3">Files</h2>
          <DropZone
            onFilesAccepted={(acceptedFiles, acceptedPaths) => {
              setFiles(acceptedFiles);
              setFilePaths(acceptedPaths);
            }}
          />
        </Card>
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
          className={`p-4 rounded-lg border text-sm ${
            isUpgradeError(deployError.kind)
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          <p>{deployError.message}</p>
          {isUpgradeError(deployError.kind) && (
            <Link to="/account" className="inline-block mt-2 text-xs font-medium underline">
              See plans →
            </Link>
          )}
        </div>
      )}
    </AppShell>
  );
}
