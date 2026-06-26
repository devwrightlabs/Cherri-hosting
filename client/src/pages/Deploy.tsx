import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DropZone from '../components/deploy/DropZone';
import DeployReveal from '../components/deploy/DeployReveal';
import StagePanel from '../components/deploy/StagePanel';
import BuildLogPanel from '../components/deploy/BuildLogPanel';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import Input from '../components/ui/Input';
import DeployStepper from '../components/deploy/DeployStepper';
import { projectsApi, extractApiError } from '../lib/api';
import {
  buildStage,
  getBuild,
  importGitHub,
  pinStaged,
  previewUrl,
  getDeployment,
  extractDeployError,
  DeployError,
  StageResult,
  BuildJobInfo,
  BuildStageResult,
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
  const [projectsLoadError, setProjectsLoadError] = useState('');

  // GitHub import inputs (an alternate ingestion path into the same pipeline)
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Phase 1 — staging (upload + validate + preview, no pin yet)
  const [isStaging, setIsStaging] = useState(false);
  const [stageProgress, setStageProgress] = useState(0);
  const [stageResult, setStageResult] = useState<StageResult | null>(null);

  // Phase 1b — server-side build (when the upload needs building first)
  const [buildInfo, setBuildInfo] = useState<BuildJobInfo | null>(null);
  const buildPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      .catch((err) => {
        setProjectsLoadError(extractApiError(err, 'Could not load your projects. Please refresh.'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current !== null) clearTimeout(pollTimeoutRef.current);
      if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
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

  // Poll a server-side build for streamed logs. On success, convert its stage so
  // the existing preview + pin panel takes over; on failure the BuildLogPanel
  // keeps the real error + log on screen.
  const pollBuild = useCallback((jobId: string) => {
    if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);

    const poll = async () => {
      try {
        const info = await getBuild(jobId);
        setBuildInfo(info);
        if (info.status === 'DONE' && info.stage) {
          setStageResult({
            deployable: true,
            stageId: info.stage.stageId,
            projectType: info.stage.projectType,
            entryPoint: info.stage.entryPoint,
            fileCount: info.stage.fileCount,
            totalBytes: info.stage.totalBytes,
            fileTree: [],
            sdk: info.stage.sdk,
            previewPath: info.stage.previewPath,
          });
          if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
          return;
        }
        if (info.status === 'FAILED') {
          if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
          return;
        }
      } catch {
        // ignore transient polling errors
      }
      buildPollRef.current = setTimeout(() => void poll(), 1500);
    };

    void poll();
  }, []);

  // Route a stage-or-build response into the right phase: a queued build streams
  // its logs; an immediate stage drops straight into the preview + pin panel.
  const applyBuildResult = useCallback(
    (result: BuildStageResult) => {
      if (result.needsBuild) {
        setBuildInfo({ status: 'QUEUED', packageManager: result.packageManager, logs: '' });
        pollBuild(result.jobId);
      } else {
        setStageResult(result);
      }
    },
    [pollBuild],
  );

  // Phase 1 — upload + validate. If the project needs building, run a REAL
  // server-side build first; otherwise show a sandboxed preview (no pin yet).
  const handleStage = useCallback(async () => {
    if (!selectedProjectId || files.length === 0 || filePaths.length === 0) return;
    setIsStaging(true);
    setDeployError(null);
    setStageProgress(0);
    setStageResult(null);
    setBuildInfo(null);

    try {
      applyBuildResult(
        await buildStage(selectedProjectId, files, filePaths, setStageProgress),
      );
    } catch (err: unknown) {
      setDeployError(extractDeployError(err));
    } finally {
      setIsStaging(false);
    }
  }, [selectedProjectId, files, filePaths, applyBuildResult]);

  // Phase 1 (GitHub) — import a public repo, then the same stage-or-build flow.
  const handleImport = useCallback(async () => {
    if (!selectedProjectId || !repoUrl.trim()) return;
    setIsImporting(true);
    setDeployError(null);
    setStageResult(null);
    setBuildInfo(null);

    try {
      applyBuildResult(await importGitHub(selectedProjectId, repoUrl.trim(), branch));
    } catch (err: unknown) {
      setDeployError(extractDeployError(err));
    } finally {
      setIsImporting(false);
    }
  }, [selectedProjectId, repoUrl, branch, applyBuildResult]);

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
    setBuildInfo(null);
    if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
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
    setBuildInfo(null);
    if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
  };

  const showBuild =
    deploymentStatus === null && stageResult === null && buildInfo !== null;
  const showUpload =
    deploymentStatus === null && stageResult === null && buildInfo === null;
  const showStage = deploymentStatus === null && stageResult !== null;
  const canStage =
    !!selectedProjectId && files.length > 0 && filePaths.length > 0 && !isStaging;
  const isUpgradeError = (kind: DeployError['kind']) =>
    kind === 'storage_limit' || kind === 'upload_too_large';

  const currentStep =
    deploymentStatus !== null
      ? 3
      : showStage
        ? 2
        : showBuild || isStaging || isImporting
          ? 1
          : 0;
  const flowComplete = deploymentStatus === 'ACTIVE';

  return (
    <AppShell>
      <PageHeader
        title="Deploy"
        subtitle="Upload a static site, or an app Cherri builds for you — then publish to IPFS."
      />

      <DeployStepper
        steps={['Upload files', 'Build & validate', 'Preview', 'Publish to IPFS']}
        current={currentStep}
        complete={flowComplete}
      />

      {/* Project selector */}
      <Card>
        <label className="block text-xs font-medium text-ink-mut mb-2">Project</label>
        {projectsLoadError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-red-400 text-sm">{projectsLoadError}</p>
            <button
              className="shrink-0 text-xs underline text-red-400"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <p className="text-ink-mut text-sm">
            You have no projects yet.{' '}
            <button onClick={() => navigate('/projects')} className="text-cherry-300 underline">
              Create one first.
            </button>
          </p>
        ) : (
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            disabled={!showUpload}
            className="w-full min-h-[48px] bg-surface-800 border border-surface-600 rounded-xl px-4 text-ink text-sm focus:outline-none focus:border-cherry-500/50 focus:ring-2 focus:ring-cherry-500 focus:ring-offset-2 focus:ring-offset-surface-950 disabled:opacity-50 transition-colors"
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

      {/* GitHub import — an alternate path into the same build/stage pipeline */}
      {showUpload && (
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-[10px] uppercase tracking-wider text-ink-mut">or</span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
          <h2 className="text-base font-semibold text-ink font-display mb-1">Import from GitHub</h2>
          <p className="text-ink-mut text-xs mb-4 leading-relaxed">
            Paste a public repository URL. Cherri downloads it, builds it if needed,
            then stages it for preview — no faked steps.
          </p>
          <div className="space-y-3 mb-4">
            <Input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
            />
            <Input
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="branch, tag, or commit (optional)"
            />
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={!selectedProjectId || !repoUrl.trim() || isImporting}
            isLoading={isImporting}
            onClick={() => void handleImport()}
          >
            {isImporting ? 'Importing…' : 'Import from GitHub'}
          </Button>
        </Card>
      )}

      {/* Server-side build console (real streamed logs) */}
      {showBuild && buildInfo && <BuildLogPanel info={buildInfo} onReset={reset} />}

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
          customDomain={projects.find((p) => p.id === selectedProjectId)?.customDomain}
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
            <Link to="/account" className="inline-block mt-2 text-xs font-medium underline">
              See plans →
            </Link>
          )}
        </div>
      )}
    </AppShell>
  );
}
