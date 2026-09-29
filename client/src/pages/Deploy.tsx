import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import DropZone from '../components/deploy/DropZone';
import DeployReveal from '../components/deploy/DeployReveal';
import StagePanel from '../components/deploy/StagePanel';
import DeployDomainPanel from '../components/deploy/DeployDomainPanel';

import BuildLogPanel from '../components/deploy/BuildLogPanel';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import Input from '../components/ui/Input';
import { projectsApi, extractApiError } from '../lib/api';
import {
  buildStage,
  getBuild,
  importGitHub,
  pinStaged,
  previewUrl,
  getDeployment,
  extractDeployError,
  isBuildGoneError,
  DeployError,
  StageResult,
  BuildJobInfo,
  BuildStageResult,
} from '../api/deployApi';
import {
  loadActiveBuild,
  saveActiveBuild,
  clearActiveBuild,
  ACTIVE_BUILD_MAX_AGE_MS,
} from '../lib/activeBuild';
import { Project, Deployment, DeploymentStatus } from '../types';

type PillTone = 'mut' | 'live' | 'amber' | 'red' | 'cherry';

const PILL_TONES: Record<PillTone, string> = {
  mut: 'bg-surface-800 text-ink-mut border-hairline',
  live: 'bg-live/15 text-live border-live/30',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  red: 'bg-red-500/10 text-red-400 border-red-500/30',
  cherry: 'bg-cherry-500/10 text-cherry-300 border-cherry-500/30',
};

function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function StageCard({
  n,
  title,
  subtitle,
  pill,
  locked = false,
  active = false,
  children,
}: {
  n: number;
  title: string;
  subtitle: string;
  pill: ReactNode;
  locked?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 transition-colors ${
        locked
          ? 'border-hairline bg-surface-900/40'
          : active
            ? 'border-cherry-500/30 bg-surface-900 ring-1 ring-cherry-500/10'
            : 'border-hairline bg-surface-900'
      }`}
    >
      <header className="flex items-start gap-3 mb-4">
        <span
          className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-xl text-sm font-bold ${
            locked
              ? 'bg-surface-800 text-ink-mut border border-hairline'
              : 'bg-cherry-gradient text-surface-950'
          }`}
        >
          {n}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink font-display">{title}</h2>
            {pill}
          </div>
          <p className="text-ink-mut text-xs mt-0.5 leading-relaxed">{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export default function Deploy() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
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

  // Stage 1 — staging (upload + validate + preview, no pin yet)
  const [isStaging, setIsStaging] = useState(false);
  const [stageProgress, setStageProgress] = useState(0);
  const [stageResult, setStageResult] = useState<StageResult | null>(null);

  // Stage 1b — server-side build (when the upload needs building first)
  const [buildInfo, setBuildInfo] = useState<BuildJobInfo | null>(null);
  const buildPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // True while we reconnect to a build the user started before leaving the page.
  const [isResuming, setIsResuming] = useState(false);

  // The validation key pasted via the Stage 1 helper THIS session — kept so the


  // Stage 2 — pinning (the reveal sequence)
  const [isPinning, setIsPinning] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus | null>(null);
  const [liveDeployment, setLiveDeployment] = useState<Deployment | null>(null);
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null);

  const [deployError, setDeployError] = useState<DeployError | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Remember the last submission so "Try again" (after a build failure) and
  // "Build anyway" (past an overridable shape warning) can replay it. The
  // chosen files / repo URL stay in state, so a replay just re-sends them.
  const lastSubmitRef = useRef<{ kind: 'upload' | 'import'; acknowledge: boolean } | null>(null);
  // Whether a replay is actually possible THIS session. False after a resumed
  // build (the original File objects are gone), so we don't offer a dead button.
  const [canReplay, setCanReplay] = useState(false);

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
      })
      .finally(() => setProjectsLoading(false));
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
    // Bounded extra polls after ACTIVE while the server's post-pin live-link
    // verification is still running (liveCheckStatus === 'UNCHECKED').
    let liveCheckPolls = 0;

    const poll = async () => {
      try {
        const d = await getDeployment(id);
        setDeploymentStatus(d.status);
        if (d.status === 'FAILED') {
          // Keep the deployment on FAILED too so the reveal can show the real
          // failure reason, not a generic message.
          setLiveDeployment(d);
          if (pollTimeoutRef.current !== null) clearTimeout(pollTimeoutRef.current);
          return;
        }
        if (d.status === 'ACTIVE') {
          setLiveDeployment(d);
          const checked = d.liveCheckStatus && d.liveCheckStatus !== 'UNCHECKED';
          liveCheckPolls += 1;
          if (checked || liveCheckPolls > 20) {
            if (pollTimeoutRef.current !== null) clearTimeout(pollTimeoutRef.current);
            return;
          }
        }
      } catch {
        // ignore transient polling errors
      }
      pollTimeoutRef.current = setTimeout(() => void poll(), 2000);
    };

    void poll();
  }, []);

  // Poll a server-side build for streamed logs. On success, convert its stage so
  // the existing preview + verify panel takes over; on failure the BuildLogPanel
  // keeps the real error + log on screen.
  const pollBuild = useCallback((jobId: string) => {
    if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);

    const poll = async () => {
      try {
        const info = await getBuild(jobId);
        // First successful response — we're reconnected, drop the resume banner.
        setIsResuming(false);
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
          // Keep the persisted record until the stage is consumed (pin/reset) so
          // a finished-but-unpinned build also survives navigating away.
          if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
          return;
        }
        if (info.status === 'FAILED') {
          // Keep persisted so returning still shows the real failure until reset.
          if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
          return;
        }
      } catch (err: unknown) {
        // A vanished/expired job (404) is terminal: clear persistence and return
        // to a clean page instead of polling a dead job forever. Transient
        // network errors fall through and are retried.
        if (isBuildGoneError(err)) {
          clearActiveBuild();
          if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
          setIsResuming(false);
          setBuildInfo(null);
          setStageResult(null);
          setDeployError({
            kind: 'generic',
            message:
              'That build is no longer available — it may have expired. Please start a new one.',
          });
          return;
        }
        // ignore transient polling errors
      }
      buildPollRef.current = setTimeout(() => void poll(), 1500);
    };

    void poll();
  }, []);

  // Reconnect to a build the user started before leaving the page (navigating
  // away, backgrounding the app, or switching to the Pi Browser and returning).
  // The job runs server-side under a persisted jobId — we resume polling and let
  // the real status decide where to land, instead of forcing a fresh restart.
  useEffect(() => {
    const record = loadActiveBuild();
    if (!record) return;
    // Stale beyond any window the server could still answer — drop it cleanly.
    if (Date.now() - record.startedAt > ACTIVE_BUILD_MAX_AGE_MS) {
      clearActiveBuild();
      return;
    }
    setSelectedProjectId(record.projectId);
    setIsResuming(true);
    pollBuild(record.jobId);
  }, [pollBuild]);

  // Route a stage-or-build response into the right phase: a queued build streams
  // its logs; an immediate stage drops straight into the preview + verify panel.
  const applyBuildResult = useCallback(
    (result: BuildStageResult, projectId: string) => {
      if (result.needsBuild) {
        setBuildInfo({ status: 'QUEUED', packageManager: result.packageManager, logs: '' });
        // Persist the job so the build survives navigation / app-switching and
        // can be reconnected on return (the job runs server-side under jobId).
        saveActiveBuild({
          jobId: result.jobId,
          projectId,
          stage: 'building',
          startedAt: Date.now(),
        });
        pollBuild(result.jobId);
      } else {
        setStageResult(result);
      }
    },
    [pollBuild],
  );

  // Stage 1 — upload + validate. If the project needs building, run a REAL
  // server-side build first; otherwise show a sandboxed preview (no pin yet).
  const handleStage = useCallback(
    async (acknowledge = false) => {
      if (!selectedProjectId || files.length === 0 || filePaths.length === 0) return;
      lastSubmitRef.current = { kind: 'upload', acknowledge };
      setCanReplay(true);
      setIsStaging(true);
      setDeployError(null);
      setStageProgress(0);
      setStageResult(null);
      setBuildInfo(null);

      try {
        applyBuildResult(
          await buildStage(selectedProjectId, files, filePaths, setStageProgress, acknowledge),
          selectedProjectId,
        );
      } catch (err: unknown) {
        setDeployError(extractDeployError(err));
      } finally {
        setIsStaging(false);
      }
    },
    [selectedProjectId, files, filePaths, applyBuildResult],
  );

  // Stage 1 (GitHub) — import a public repo, then the same stage-or-build flow.
  const handleImport = useCallback(
    async (acknowledge = false) => {
      if (!selectedProjectId || !repoUrl.trim()) return;
      lastSubmitRef.current = { kind: 'import', acknowledge };
      setCanReplay(true);
      setIsImporting(true);
      setDeployError(null);
      setStageResult(null);
      setBuildInfo(null);

      try {
        applyBuildResult(
          await importGitHub(selectedProjectId, repoUrl.trim(), branch, acknowledge),
          selectedProjectId,
        );
      } catch (err: unknown) {
        setDeployError(extractDeployError(err));
      } finally {
        setIsImporting(false);
      }
    },
    [selectedProjectId, repoUrl, branch, applyBuildResult],
  );

  // Replay the last submission as-is — used by "Try again" after a build failure.
  const retryLast = useCallback(() => {
    const last = lastSubmitRef.current;
    if (!last) return;
    if (last.kind === 'upload') void handleStage(last.acknowledge);
    else void handleImport(last.acknowledge);
  }, [handleStage, handleImport]);

  // Replay the last submission, this time acknowledging an overridable shape
  // warning (e.g. a monorepo) so the server proceeds to build.
  const proceedAnyway = useCallback(() => {
    const last = lastSubmitRef.current;
    if (!last) return;
    if (last.kind === 'import') void handleImport(true);
    else void handleStage(true);
  }, [handleStage, handleImport]);

  // Stage 2 — pin the staged upload to IPFS and run the reveal.
  const handlePin = useCallback(async () => {
    if (!stageResult?.stageId) return;
    // The build is now consumed — moving to Stage 2 means it should no longer
    // resurrect as an "in-progress build" on a future visit.
    clearActiveBuild();
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

  // Discard the staged upload AND the chosen files, returning to a clean drop
  // zone. Clearing files matters: otherwise the old upload stays silently armed
  // and "Build & verify" could re-submit it before the user picks new files.
  const resetStage = () => {
    clearActiveBuild();
    lastSubmitRef.current = null;
    setCanReplay(false);
    setFiles([]);
    setFilePaths([]);
    setStageResult(null);
    setStageProgress(0);
    setDeployError(null);
    setBuildInfo(null);
    setIsResuming(false);    if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
  };

  // Full reset — clear files and start over.
  const reset = () => {
    clearActiveBuild();
    lastSubmitRef.current = null;
    setCanReplay(false);
    setFiles([]);
    setFilePaths([]);
    setStageResult(null);
    setStageProgress(0);
    setDeploymentStatus(null);
    setLiveDeployment(null);
    setDeployError(null);
    setDeployStartedAt(null);
    setBuildInfo(null);
    setIsResuming(false);    if (buildPollRef.current !== null) clearTimeout(buildPollRef.current);
  };

  // ── Derived flow state ───────────────────────────────────────────────────────
  const isDeploying = deploymentStatus !== null;
  const inUploadState = !stageResult && buildInfo === null && !isDeploying && !isResuming;
  const isBuilding = !stageResult && buildInfo !== null && !isDeploying;
  const hasVerifiedStage = !!(stageResult?.deployable && stageResult.stageId);
  const canStage =
    !!selectedProjectId && files.length > 0 && filePaths.length > 0 && !isStaging;
  const isUpgradeError = (kind: DeployError['kind']) =>
    kind === 'storage_limit' || kind === 'upload_too_large';

  // ── Per-stage status pills ───────────────────────────────────────────────────
  const stage1Pill: ReactNode = (() => {
    if (stageResult?.deployable) return <Pill tone="live">Verified</Pill>;
    if (stageResult && !stageResult.deployable) return <Pill tone="amber">Action needed</Pill>;
    if (buildInfo?.status === 'FAILED') return <Pill tone="red">Build failed</Pill>;
    if (isBuilding) return <Pill tone="amber">Building…</Pill>;
    return <Pill tone="mut">Start here</Pill>;
  })();

  const stage2Pill: ReactNode = (() => {
    if (deploymentStatus === 'ACTIVE') return <Pill tone="live">Live</Pill>;
    if (deploymentStatus === 'FAILED') return <Pill tone="red">Failed</Pill>;
    if (isDeploying) return <Pill tone="amber">Deploying…</Pill>;
    if (hasVerifiedStage) return <Pill tone="cherry">Ready</Pill>;
    return <Pill tone="mut">Locked</Pill>;
  })();

  return (
    <AppShell>
      <PageHeader
        title="Deploy"
        subtitle="Upload your files, verify, and publish to IPFS."
      />

      {/* Project selector */}
      <Card className="animate-fade-in" style={{ animationDelay: '50ms' }}>
        <label className="block text-xs font-semibold tracking-wide uppercase text-ink-mut mb-2">Project</label>
        {projectsLoadError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-red-400 text-sm">{projectsLoadError}</p>
            <button
              className="shrink-0 inline-flex items-center min-h-[44px] px-2 text-xs underline text-red-400"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        ) : projectsLoading ? (
          // Skeleton while projects load — never claim "no projects" prematurely.
          <div className="h-12 rounded-xl bg-surface-800 border border-hairline animate-pulse" />
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
            disabled={!inUploadState}
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

      {/* ─── STAGE 1 — Build & Verify ───────────────────────────────────────── */}
      <StageCard
        n={1}
        title="Build & Verify"
        subtitle="Upload your site, let Cherri build it if needed, then preview and check it before going live."
        pill={stage1Pill}
        active={inUploadState || isBuilding || isResuming || (!!stageResult && !isDeploying)}
      >
        {/* Resuming — reconnecting to a build started before leaving the page */}
        {isResuming && !buildInfo && !stageResult && !isDeploying && (
          <div className="rounded-xl bg-surface-800 border border-hairline p-5 flex items-center gap-3">
            <span className="w-5 h-5 border-2 border-cherry-300 border-t-transparent rounded-full animate-spin shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Resuming your build…</p>
              <p className="text-ink-mut text-xs mt-0.5 leading-relaxed">
                Reconnecting to a build you started earlier — you'll land right where it is.
              </p>
            </div>
          </div>
        )}

        {/* Built & verified — compact summary once we've moved on to deploying */}
        {isDeploying && stageResult?.deployable && (
          <div className="rounded-xl bg-surface-800 border border-live/30 p-4">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-live/15 text-live">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <p className="text-sm font-medium text-ink">Built &amp; verified</p>
            </div>
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-mut">Entry</span>
                <span className="font-mono text-ink truncate">{stageResult.entryPoint}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-mut">Files</span>
                <span className="text-ink">
                  {stageResult.fileCount}{' '}
                  <span className="text-ink-mut">· {formatBytes(stageResult.totalBytes)}</span>
                </span>
              </div>

            </div>
          </div>
        )}

        {/* Verified / halt — the preview + verification panel */}
        {!isDeploying && stageResult && (
          <StagePanel
            result={stageResult}
            previewSrc={stageResult.previewPath ? previewUrl(stageResult.previewPath) : null}
            onCancel={resetStage}
            onProceed={proceedAnyway}
            onHelperUpdate={(patch) =>
              setStageResult((prev) => (prev ? { ...prev, ...patch } : prev))
            }
          />
        )}

        {/* Building — real streamed build logs */}
        {isBuilding && buildInfo && (
          <BuildLogPanel
            info={buildInfo}
            onRetry={canReplay ? retryLast : undefined}
            onReset={reset}
          />
        )}

        {/* Upload — drop zone, build button, GitHub import */}
        {inUploadState && (
          <div className="space-y-4">
            <DropZone
              onFilesAccepted={(acceptedFiles, acceptedPaths) => {
                setFiles(acceptedFiles);
                setFilePaths(acceptedPaths);
              }}
            />

            <Button
              size="lg"
              className="w-full justify-center"
              disabled={!canStage}
              isLoading={isStaging}
              onClick={() => void handleStage()}
            >
              {isStaging && stageProgress > 0 ? `Uploading… ${stageProgress}%` : 'Build & verify'}
            </Button>

            {/* GitHub import — an alternate path into the same build/stage pipeline */}
            <div className="pt-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="h-px flex-1 bg-hairline" />
                <span className="text-[10px] uppercase tracking-wider text-ink-mut">or</span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
              <h3 className="text-sm font-semibold text-ink mb-1">Import from GitHub</h3>
              <p className="text-ink-mut text-xs mb-3 leading-relaxed">
                Paste a public repository URL. Cherri downloads it, builds it if needed, then stages
                it for preview — no faked steps.
              </p>
              <div className="space-y-2.5 mb-3">
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
            </div>
          </div>
        )}
      </StageCard>

      {/* ─── STAGE 2 — Deploy & Go Live ─────────────────────────────────────── */}
      <StageCard
        n={2}
        title="Deploy & Go Live"
        subtitle="Pin your verified site to IPFS, then optionally point a .pi domain at it."
        pill={stage2Pill}
        locked={!hasVerifiedStage && !isDeploying}
        active={(hasVerifiedStage && !isDeploying) || isDeploying}
      >
        {/* Locked — Stage 1 not finished */}
        {!hasVerifiedStage && !isDeploying && (
          <div className="rounded-xl bg-surface-800/60 border border-dashed border-hairline p-6 text-center">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-surface-800 text-ink-mut">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <p className="text-ink text-sm font-medium mt-3">Finish step 1 first</p>
            <p className="text-ink-mut text-xs mt-1 leading-relaxed">
              Build &amp; verify your site above. Once it previews cleanly, deploying unlocks here.
            </p>
          </div>
        )}

        {/* Ready — verified stage, not yet pinned */}
        {hasVerifiedStage && !isDeploying && (
          <div className="space-y-3">
            <div className="rounded-xl bg-surface-800 border border-hairline p-4">
              <p className="text-ink-mut text-xs leading-relaxed">
                Pinning publishes your site to IPFS permanently — once it's live, it can't be taken
                down. You'll get a content address (CID) and a shareable gateway link.
              </p>
            </div>
            <Button
              size="lg"
              className="w-full justify-center"
              isLoading={isPinning}
              onClick={() => void handlePin()}
            >
              Deploy to IPFS
            </Button>
          </div>
        )}

        {/* Deploying / live — the reveal sequence, then the .pi domain panel */}
        {isDeploying && deploymentStatus && (
          <div className="space-y-4">
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

            {deploymentStatus === 'ACTIVE' && liveDeployment && (
              <DeployDomainPanel deployment={liveDeployment} />
            )}
          </div>
        )}
      </StageCard>

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
