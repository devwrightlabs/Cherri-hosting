import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import DropZone from '../components/deploy/DropZone';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import { projectsApi, deploymentsApi } from '../lib/api';
import { Project, Deployment, DeploymentStatus } from '../types';

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

export default function Deploy() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(
    searchParams.get('projectId') ?? '',
  );
  const [files, setFiles] = useState<File[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentId, setDeploymentId] = useState('');
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [liveDeployment, setLiveDeployment] = useState<Deployment | null>(null);
  const [error, setError] = useState('');

  // Load projects for the selector (run once on mount; selectedProjectId is only
  // read to skip auto-selection when a ?projectId= param was already provided)
  useEffect(() => {
    projectsApi
      .list()
      .then((res) => {
        const p = (res.data as { projects: Project[] }).projects;
        setProjects(p);
        setSelectedProjectId((prev) => (prev || (p.length > 0 ? p[0].id : '')));
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll deployment status
  useEffect(() => {
    if (!deploymentId || deploymentStatus === 'ACTIVE' || deploymentStatus === 'FAILED') return;

    const interval = setInterval(async () => {
      try {
        const res = await deploymentsApi.get(deploymentId);
        const d = (res.data as { deployment: Deployment }).deployment;
        setDeploymentStatus(d.status);
        if (d.status === 'ACTIVE' || d.status === 'FAILED') {
          setLiveDeployment(d);
          clearInterval(interval);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [deploymentId, deploymentStatus]);

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
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Deployment failed. Please try again.';
      setError(msg);
      setDeploymentStatus(null);
    } finally {
      setIsDeploying(false);
    }
  }, [selectedProjectId, files]);

  const reset = () => {
    setFiles([]);
    setDeploymentId('');
    setDeploymentStatus(null);
    setLiveDeployment(null);
    setError('');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Deploy</h1>
            <p className="text-surface-400 text-sm mt-1">
              Upload your static site files to IPFS.
            </p>
          </div>

          {/* Project selector */}
          <Card>
            <h2 className="text-sm font-medium text-white mb-3">Select Project</h2>
            {projects.length === 0 ? (
              <p className="text-surface-400 text-sm">
                No projects found.{' '}
                <button
                  onClick={() => navigate('/projects')}
                  className="text-cherry-400 hover:text-cherry-300 underline"
                >
                  Create one first.
                </button>
              </p>
            ) : (
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cherry-500"
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
          <Card>
            <h2 className="text-sm font-medium text-white mb-4">Files</h2>
            <DropZone onFilesAccepted={setFiles} />
          </Card>

          {/* Deploy button */}
          {deploymentStatus === null && (
            <Button
              size="lg"
              className="w-full justify-center"
              disabled={!selectedProjectId || files.length === 0}
              isLoading={isDeploying}
              onClick={handleDeploy}
            >
              🚀 Deploy to IPFS
            </Button>
          )}

          {/* Progress */}
          {deploymentStatus && (
            <Card>
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
                  <p className="text-surface-400 text-sm mt-1">
                    {STATUS_LABELS[deploymentStatus]}
                  </p>
                </div>
              </div>

              {liveDeployment?.status === 'ACTIVE' && (
                <div className="mt-4 pt-4 border-t border-surface-700/50 space-y-2 font-mono text-xs">
                  <p>
                    <span className="text-surface-500">CID: </span>
                    <span className="text-cherry-400">{liveDeployment.cid}</span>
                  </p>
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
                  <Button size="sm" onClick={handleDeploy} isLoading={isDeploying}>
                    Retry
                  </Button>
                  <Button size="sm" variant="secondary" onClick={reset}>
                    Reset
                  </Button>
                </div>
              )}
            </Card>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
