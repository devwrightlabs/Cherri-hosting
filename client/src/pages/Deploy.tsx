import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DropZone from '../components/deploy/DropZone';
import DeployReveal from '../components/deploy/DeployReveal';
import StagePanel from '../components/deploy/StagePanel';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { projectsApi } from '../lib/api';
import {
  stageDeploy,
  pinStaged,
  previewUrl,
  getDeployment,
  extractDeployError,
  DeployError,
  StageResult,
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

  // Phase 1 — staging (upload + validate + preview, no pin yet)
  const [isStaging, setIsStaging] = useState(false);
  const [stageProgress, setStageProgress] = useState(0);
  const [stageResult, setStageResult] = useState<StageResult | null>(null);

  // Phase 2 — pinning (the reveal sequence)
  const [isPinning, setIsPinning] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [liveDeployment, setLiveDeployment] = useState<Deployment | null>(null);
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null);

  const [deployError, setDeployError] = useState<DeployError | null>(null);
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
          // Keep the deployment on FAILED too so the reveal can show the real
          // failure reason, not a generic message.
          setLiveDeployment(d);
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

  // Phase 1 — upload + validate, then show a sandboxed preview (no pin yet).
  const handleStage = useCallback(async () => {
    if (!selectedProjectId || files.length === 0 || filePaths.length === 0) return;
    setIsStaging(true);
    setDeployError(null);
    setStageProgress(0);
    setStageResult(null);

    try {
      const result = await stageDeploy(selectedProjectId, files, filePaths, setStageProgress);
      setStageResult(result);
    } catch (err: unknown) {
      setDeployError(extractDeployError(err));
    } finally {
      setIsStaging(false);
    }
  }, [selectedProjectId, files, filePaths]);

  // Phase 2 — pin the staged upload to IPFS and run the reveal.
  const handlePin = useCallback(async () => {
    if (!stageResult?.stageId) return;
    setIsPinning(true);
    setDeployError(null);
    setDeploymentStatus('PENDING');
    setLiveDeployment(null);
    setDeployStartedAt(Date.now());

    try {
      const d = await pinStaged(stageResult.stageId);
      setDeploymentStatus(d.status as DeploymentStatus);
      pollStatus(d.id);
    } catch (err: unknown) {
      setDeployError(extractDeployError(err));
      setDeploymentStatus(null);
    } finally {
      setIsPinning(false);
    }
  }, [stageResult, pollStatus]);

  // Discard the staged upload and return to the drop zone (keeps selection).
  const resetStage = () => {
    setStageResult(null);
    setStageProgress(0);
    setDeployError(null);
  };

  // Full reset — clear files and start over.
  const reset = () => {
    setFiles([]);
    setFilePaths([]);
    setStageResult(null);
    setStageProgress(0);
    setDeploymentStatus(null);
    setLiveDeployment(null);
    setDeployError(null);
    setDeployStartedAt(null);
  };

  const showUpload = deploymentStatus === null && stageResult === null;
  const showStage = deploymentStatus === null && stageResult !== null;
  const canStage =
    !!selectedProjectId && files.length > 0 && filePaths.length > 0 && !isStaging;
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
            disabled={!showUpload}
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
      {showUpload && (
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

      {/* Validate & preview button */}
      {showUpload && (
        <Button
          size="lg"
          className="w-full justify-center"
          disabled={!canStage}
          isLoading={isStaging}
          onClick={() => void handleStage()}
        >
          {isStaging && stageProgress > 0
            ? `Uploading… ${stageProgress}%`
            : 'Validate & preview'}
        </Button>
      )}

      {/* Staged preview / halt-with-guidance */}
      {showStage && stageResult && (
        <StagePanel
          result={stageResult}
          previewSrc={stageResult.previewPath ? previewUrl(stageResult.previewPath) : null}
          isPinning={isPinning}
          onPin={() => void handlePin()}
          onCancel={resetStage}
        />
      )}

      {/* The reveal sequence */}
      {deploymentStatus && (
        <DeployReveal
          status={deploymentStatus}
          isUploading={false}
          uploadProgress={100}
          deployment={liveDeployment}
          startedAt={deployStartedAt}
          onRetry={() => void handlePin()}
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
